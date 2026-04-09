"""Sessions API 路由

提供 Agent 会话的创建、查询、对话接口。
对话接口使用 SSE（Server-Sent Events）流式返回 Agent 回复。
"""

from __future__ import annotations

from loguru import logger
import asyncio
import json

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from backend.app.models.session import Session, SessionCreate


router = APIRouter(prefix="/api/sessions", tags=["sessions"])


# ── Request / Response models ─────────────────────────────────────────

class MessageRequest(BaseModel):
    content: str = Field(..., description="用户消息内容")


class SessionResponse(BaseModel):
    id: str
    type: str
    external_ref: str | None
    workflow_id: str | None
    execution_id: str | None
    visible: bool
    status: str
    artifact_count: int
    created_at: str
    updated_at: str

    @classmethod
    def from_session(cls, s: Session) -> "SessionResponse":
        return cls(
            id=s.id,
            type=s.type.value,
            external_ref=s.external_ref,
            workflow_id=s.workflow_id,
            execution_id=s.execution_id,
            visible=s.visible,
            status=s.status,
            artifact_count=len(s.artifacts),
            created_at=s.created_at.isoformat() + 'Z',
            updated_at=s.updated_at.isoformat() + 'Z',
        )


# ── Endpoints ─────────────────────────────────────────────────────────

@router.post("/", response_model=SessionResponse, status_code=201)
async def create_session(request: Request, data: SessionCreate):
    """创建新 Session。

    - interactive（默认）：用户在前台对话，visible=True
    - batch：API 触发的自动化执行，通常 visible=False，可携带 external_ref
    """
    session_manager = request.app.state.session_manager
    session = await session_manager.create_session(
        session_type=data.type,
        external_ref=data.external_ref,
        workflow_id=data.workflow_id,
        visible=data.visible,
    )
    return SessionResponse.from_session(session)


@router.get("/", response_model=list[SessionResponse])
async def list_sessions(request: Request, all: bool = False):
    """列出 Session。

    - 默认只返回 visible=True 的 Session（前台面板用）
    - all=true 返回所有（包括批量 Session）
    """
    session_manager = request.app.state.session_manager
    if all:
        sessions = session_manager.list_all_sessions()
    else:
        sessions = session_manager.list_visible_sessions()
    return [SessionResponse.from_session(s) for s in sessions]


@router.get("/by-ref/{external_ref}", response_model=list[SessionResponse])
async def find_sessions_by_ref(request: Request, external_ref: str):
    """通过 external_ref（如视频 ID）反向查找关联的 Session 列表。"""
    session_manager = request.app.state.session_manager
    sessions = session_manager.find_sessions_by_ref(external_ref)
    return [SessionResponse.from_session(s) for s in sessions]


@router.get("/batch/status")
async def batch_status(request: Request):
    """获取批量执行的队列/并发状态。"""
    session_manager = request.app.state.session_manager
    return session_manager.get_batch_status()


@router.get("/{session_id}", response_model=SessionResponse)
async def get_session(request: Request, session_id: str):
    """获取指定 Session 的详情。"""
    session_manager = request.app.state.session_manager
    session = session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' 不存在")
    return SessionResponse.from_session(session)


@router.post("/{session_id}/messages")
async def send_message(
    request: Request,
    session_id: str,
    body: MessageRequest,
):
    """向 Session 发送消息，SSE 流式返回 Agent 回复。

    响应格式（text/event-stream）：
        data: {"content": "回复文本片段"}
        data: [DONE]
    """
    session_manager = request.app.state.session_manager
    session = session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' 不存在")

    if not body.content.strip():
        raise HTTPException(status_code=400, detail="消息内容不能为空")

    # Events that should be forwarded to the frontend via SSE
    _FORWARDED_EVENT_TYPES = frozenset({
        "execution_plan", "skill_start", "skill_end", "skill_error", "dynamic_skill",
    })

    async def generate():
        # Queue to multiplex agent text chunks and session events into one SSE stream.
        # Sentinel value None signals the stream has ended.
        queue: asyncio.Queue[str | None] = asyncio.Queue()

        def _on_event(sid: str, event) -> None:
            if event.event_type not in _FORWARDED_EVENT_TYPES:
                return
            payload: dict = {"type": event.event_type}
            if event.skill_id:
                payload["skill_id"] = event.skill_id
            if event.detail:
                payload["detail"] = event.detail
            if event.extra:
                payload.update(event.extra)
            queue.put_nowait(json.dumps(payload, ensure_ascii=False))

        session_manager.subscribe(session_id, _on_event)

        async def _stream_agent():
            try:
                async for chunk in session_manager.send_message_stream(session_id, body.content):
                    text_payload = json.dumps({"content": chunk}, ensure_ascii=False)
                    queue.put_nowait(text_payload)
            except Exception as e:
                logger.exception(f"[session={session_id}] SSE agent 流出错: {e}")
                err_payload = json.dumps({"error": str(e)}, ensure_ascii=False)
                queue.put_nowait(err_payload)
            finally:
                queue.put_nowait(None)  # sentinel: agent done

        agent_task = asyncio.create_task(_stream_agent())

        try:
            while True:
                item = await queue.get()
                if item is None:
                    break
                yield f"data: {item}\n\n"
        except Exception as e:
            logger.exception(f"[session={session_id}] SSE 队列消费出错: {e}")
        finally:
            session_manager.unsubscribe(session_id, _on_event)
            if not agent_task.done():
                agent_task.cancel()
                try:
                    await agent_task
                except (asyncio.CancelledError, Exception):
                    pass
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/{session_id}/artifacts")
async def get_artifacts(request: Request, session_id: str):
    """列出 Session 的所有中间产物。"""
    session_manager = request.app.state.session_manager
    session = session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' 不存在")
    return {
        "session_id": session_id,
        "artifacts": {k: v.model_dump() for k, v in session.artifacts.items()},
    }


@router.get("/{session_id}/execution-log")
async def get_execution_log(request: Request, session_id: str):
    """获取 Session 的执行事件日志（Agent 做了什么、何时做的）。"""
    session_manager = request.app.state.session_manager
    session = session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' 不存在")
    return {
        "session_id": session_id,
        "events": [e.model_dump() for e in session.execution_log],
    }


@router.get("/{session_id}/messages")
async def get_messages(request: Request, session_id: str):
    """从 LangGraph checkpointer 中提取 Session 的完整对话历史。"""
    from langchain_core.messages import HumanMessage, AIMessage, SystemMessage, ToolMessage

    session_manager = request.app.state.session_manager
    session = session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' 不存在")

    checkpointer = request.app.state.checkpointer
    config = {"configurable": {"thread_id": session_id}}

    try:
        checkpoint = await checkpointer.aget(config)
    except Exception as e:
        logger.warning(f"读取 checkpoint 失败 session={session_id}: {e}")
        return {"session_id": session_id, "messages": []}

    if not checkpoint:
        return {"session_id": session_id, "messages": []}

    raw_messages = checkpoint.get("channel_values", {}).get("messages", [])

    TYPE_MAP = {
        HumanMessage: "user",
        AIMessage: "agent",
        SystemMessage: "system",
        ToolMessage: "tool",
    }

    messages = []
    for msg in raw_messages:
        msg_type = TYPE_MAP.get(type(msg))
        if not msg_type:
            continue
        content = msg.content if isinstance(msg.content, str) else str(msg.content)
        if msg_type == "tool" or not content.strip():
            continue
        messages.append({
            "id": getattr(msg, "id", None) or "",
            "type": msg_type,
            "content": content,
        })

    return {"session_id": session_id, "messages": messages}


@router.delete("/{session_id}")
async def delete_session(request: Request, session_id: str):
    """删除 Session。"""
    session_manager = request.app.state.session_manager
    session = session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' 不存在")

    store = request.app.state.store
    store.delete_session(session_id)
    session_manager._sessions.pop(session_id, None)
    return {"message": f"Session '{session_id}' 已删除"}
