"""Executions API 路由

向后兼容：保留原有执行接口签名，内部通过 Session + Orchestrator 实现。
新代码推荐直接使用 /api/sessions 接口。
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from backend.app.models.session import SessionType

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/executions", tags=["executions"])


class ExecutionCreateRequest(BaseModel):
    workflow_id: str
    param_overrides: dict[str, dict] = Field(default_factory=dict)
    external_ref: str | None = None


class ExecutionResponse(BaseModel):
    """向后兼容的执行响应格式"""
    id: str           # 现在是 session_id
    session_id: str
    workflow_id: str
    status: str
    message: str


@router.post("/", response_model=ExecutionResponse, status_code=201)
async def start_execution(request: Request, data: ExecutionCreateRequest):
    """启动工作流执行（向后兼容接口）

    内部创建 Session 并后台执行 Workflow。
    """
    store = request.app.state.store
    session_manager = request.app.state.session_manager

    workflow = store.load_workflow(data.workflow_id)
    if not workflow:
        raise HTTPException(
            status_code=404,
            detail=f"工作流 '{data.workflow_id}' 不存在"
        )

    try:
        session = await session_manager.create_session(
            session_type=SessionType.INTERACTIVE,
            external_ref=data.external_ref,
            workflow_id=data.workflow_id,
            visible=True,
        )

        await session_manager.start_workflow_background(
            session_id=session.id,
            workflow=workflow,
            param_overrides=data.param_overrides,
        )

        logger.info(f"已启动执行 session={session.id}，workflow={data.workflow_id}")

        return ExecutionResponse(
            id=session.id,
            session_id=session.id,
            workflow_id=data.workflow_id,
            status="running",
            message="工作流执行已启动",
        )

    except Exception as e:
        logger.exception(f"启动执行失败: {e}")
        raise HTTPException(status_code=500, detail=f"启动执行失败: {str(e)}")


@router.get("/", response_model=list[ExecutionResponse])
async def list_executions(request: Request, workflow_id: str | None = None):
    """列出执行记录（映射到可见 Session 列表）"""
    session_manager = request.app.state.session_manager
    sessions = session_manager.list_visible_sessions()

    if workflow_id:
        sessions = [s for s in sessions if s.workflow_id == workflow_id]

    return [
        ExecutionResponse(
            id=s.id,
            session_id=s.id,
            workflow_id=s.workflow_id or "",
            status=s.status,
            message="",
        )
        for s in sessions
    ]


@router.get("/{execution_id}", response_model=ExecutionResponse)
async def get_execution(request: Request, execution_id: str):
    """获取执行状态（映射到 Session）"""
    session_manager = request.app.state.session_manager
    session = session_manager.get_session(execution_id)

    if not session:
        raise HTTPException(
            status_code=404,
            detail=f"执行记录 '{execution_id}' 不存在"
        )

    return ExecutionResponse(
        id=session.id,
        session_id=session.id,
        workflow_id=session.workflow_id or "",
        status=session.status,
        message="",
    )


@router.post("/{execution_id}/pause", response_model=ExecutionResponse)
async def pause_execution(request: Request, execution_id: str):
    """暂停执行（向 Agent 发送暂停指令）"""
    session_manager = request.app.state.session_manager
    session = session_manager.get_session(execution_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"执行记录 '{execution_id}' 不存在")

    import asyncio
    asyncio.create_task(
        _consume_stream(session_manager, execution_id, "请暂停当前执行，等待我的进一步指令。")
    )

    session.status = "paused"
    session_manager._save_session(session)

    return ExecutionResponse(
        id=session.id, session_id=session.id,
        workflow_id=session.workflow_id or "", status="paused", message="已请求暂停"
    )


@router.post("/{execution_id}/resume", response_model=ExecutionResponse)
async def resume_execution(request: Request, execution_id: str):
    """恢复执行（向 Agent 发送继续指令）"""
    session_manager = request.app.state.session_manager
    session = session_manager.get_session(execution_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"执行记录 '{execution_id}' 不存在")

    session.status = "active"
    session_manager._save_session(session)

    import asyncio
    asyncio.create_task(
        _consume_stream(session_manager, execution_id, "请继续执行之前暂停的任务。")
    )

    return ExecutionResponse(
        id=session.id, session_id=session.id,
        workflow_id=session.workflow_id or "", status="running", message="已恢复执行"
    )


class RerunRequest(BaseModel):
    feedback: str = Field(default="", description="用户对当前结果的反馈意见")


@router.post("/{execution_id}/resume-from/{node_id}", response_model=ExecutionResponse)
async def resume_from_node(
    request: Request,
    execution_id: str,
    node_id: str,
    body: RerunRequest | None = None,
):
    """从指定节点重跑（通过向 Agent 发送对话消息实现）

    可附带用户反馈，Agent 会根据反馈调整执行策略。
    """
    session_manager = request.app.state.session_manager
    session = session_manager.get_session(execution_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"执行记录 '{execution_id}' 不存在")

    feedback = (body.feedback.strip() if body and body.feedback else "")

    if feedback:
        rerun_message = (
            f"用户对节点 '{node_id}' 的执行结果不满意，反馈如下：\n"
            f"「{feedback}」\n\n"
            f"请根据用户反馈，从节点 '{node_id}' 开始重新执行，"
            f"保留该节点之前的执行结果不变。"
        )
    else:
        rerun_message = (
            f"请从节点 '{node_id}' 开始重新执行，保留该节点之前的执行结果不变。"
        )

    from backend.app.models.session import ExecutionEvent
    session_manager.emit_event(execution_id, ExecutionEvent(
        event_type="rerun",
        node_id=node_id,
        detail=f"用户请求从 {node_id} 重跑" + (f": {feedback}" if feedback else ""),
    ))

    import asyncio
    asyncio.create_task(
        _consume_stream(session_manager, execution_id, rerun_message)
    )

    session.status = "running"
    session_manager._save_session(session)

    logger.info(f"已请求从节点 {node_id} 重跑，session={execution_id}, feedback={feedback[:100]}")
    return ExecutionResponse(
        id=session.id, session_id=session.id,
        workflow_id=session.workflow_id or "",
        status="running",
        message=f"已请求从节点 '{node_id}' 重新执行",
    )


@router.post("/{execution_id}/cancel", response_model=ExecutionResponse)
async def cancel_execution(request: Request, execution_id: str):
    """取消执行"""
    session_manager = request.app.state.session_manager
    session = session_manager.get_session(execution_id)
    if not session:
        raise HTTPException(status_code=404, detail=f"执行记录 '{execution_id}' 不存在")

    task = session_manager._active_tasks.get(execution_id)
    if task and not task.done():
        task.cancel()

    session.status = "failed"
    session_manager._save_session(session)

    return ExecutionResponse(
        id=session.id, session_id=session.id,
        workflow_id=session.workflow_id or "", status="failed", message="执行已取消"
    )


async def _consume_stream(session_manager, session_id: str, message: str):
    """后台消费 stream，不向客户端输出。"""
    try:
        async for _ in session_manager.send_message_stream(session_id, message):
            pass
    except Exception as e:
        logger.error(f"[session={session_id}] 后台消息消费失败: {e}")
