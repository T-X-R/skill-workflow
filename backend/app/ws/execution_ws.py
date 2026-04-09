"""WebSocket — Execution 状态推送

实时推送执行状态变化给前端画布。
基于 SessionManager 的事件总线，推送：
- execution_status: session 状态变化
- node_status: 节点级执行事件（skill_start / skill_end / skill_error / dynamic_skill）
- artifacts_updated: 产物注册通知
"""

from __future__ import annotations

from loguru import logger
import asyncio
import json

from fastapi import WebSocket, WebSocketDisconnect



async def execution_websocket(websocket: WebSocket, execution_id: str):
    """WebSocket 端点，推送 Execution 状态变化。

    execution_id 现在对应 session_id（向后兼容）。
    """
    await websocket.accept()

    app = websocket.app
    session_manager = getattr(app.state, "session_manager", None)

    if session_manager is None:
        await websocket.send_json({
            "type": "error",
            "data": {"message": "SessionManager 未初始化"}
        })
        await websocket.close(code=4000)
        return

    session = session_manager.get_session(execution_id)
    if not session:
        await websocket.send_json({
            "type": "error",
            "data": {"message": f"Session '{execution_id}' 不存在"}
        })
        await websocket.close(code=4004, reason="Session not found")
        return

    await websocket.send_json({
        "type": "connected",
        "data": {
            "session_id": execution_id,
            "status": session.status,
            "message": "已连接到状态推送"
        }
    })

    await _send_execution_status(websocket, session)

    # Replay historical skill events so clients that connect after execution
    # completes (race condition) still receive node status updates
    for event in session.execution_log:
        if event.event_type in ("skill_start", "skill_end", "skill_error", "dynamic_skill"):
            await _send_node_event(websocket, execution_id, event)

    event_queue: asyncio.Queue = asyncio.Queue()

    def on_event(session_id: str, event) -> None:
        try:
            event_queue.put_nowait(event)
        except asyncio.QueueFull:
            pass

    session_manager.subscribe(execution_id, on_event)

    last_status = session.status
    last_artifact_count = len(session.artifacts)

    try:
        while True:
            # Concurrently wait for: client messages, event bus, or timeout
            done, pending = await asyncio.wait(
                [
                    asyncio.ensure_future(_recv_or_timeout(websocket, 15.0)),
                    asyncio.ensure_future(event_queue.get()),
                ],
                return_when=asyncio.FIRST_COMPLETED,
            )

            for task in pending:
                task.cancel()

            for task in done:
                try:
                    result = task.result()
                except (asyncio.CancelledError, WebSocketDisconnect):
                    raise WebSocketDisconnect()
                except Exception:
                    continue

                if result is None:
                    # Timeout — send heartbeat
                    try:
                        await websocket.send_json({"type": "heartbeat"})
                    except Exception:
                        raise WebSocketDisconnect()

                elif isinstance(result, str):
                    # Client message
                    try:
                        message = json.loads(result)
                        if message.get("type") == "ping":
                            await websocket.send_json({"type": "pong"})
                        elif message.get("type") == "get_status":
                            current = session_manager.get_session(execution_id)
                            if current:
                                await _send_execution_status(websocket, current)
                    except json.JSONDecodeError:
                        pass

                else:
                    # ExecutionEvent from event bus
                    event = result
                    await _send_node_event(websocket, execution_id, event)

            # Check for status / artifact changes
            current = session_manager.get_session(execution_id)
            if current:
                if current.status != last_status:
                    await _send_execution_status(websocket, current)
                    last_status = current.status

                current_artifact_count = len(current.artifacts)
                if current_artifact_count != last_artifact_count:
                    await websocket.send_json({
                        "type": "artifacts_updated",
                        "data": {
                            "session_id": execution_id,
                            "artifact_count": current_artifact_count,
                        }
                    })
                    last_artifact_count = current_artifact_count

    except (WebSocketDisconnect, asyncio.CancelledError):
        logger.info(f"WebSocket 断开: session_id={execution_id}")
    except Exception as e:
        logger.error(f"WebSocket 错误: {e}")
    finally:
        session_manager.unsubscribe(execution_id, on_event)


async def _recv_or_timeout(websocket: WebSocket, timeout: float) -> str | None:
    """Receive a message from the websocket, or return None on timeout."""
    try:
        return await asyncio.wait_for(websocket.receive_text(), timeout=timeout)
    except asyncio.TimeoutError:
        return None


def _map_session_status(status: str) -> str:
    """Map backend session status to frontend ExecutionStatus vocabulary."""
    mapping = {
        "active": "running",
        "success": "success",
        "completed": "success",
        "failed": "failed",
        "cancelled": "failed",
        "paused": "paused",
    }
    return mapping.get(status, "pending")


async def _send_execution_status(websocket: WebSocket, session) -> None:
    """推送 execution_status，格式匹配前端 ExecutionStatusData。"""
    await websocket.send_json({
        "type": "execution_status",
        "data": {
            "execution_id": session.id,
            "workflow_id": session.workflow_id,
            "status": _map_session_status(session.status),
            "started_at": session.created_at.isoformat(),
            "finished_at": session.updated_at.isoformat() if session.status in ("success", "completed", "failed", "cancelled") else None,
        }
    })


async def _send_node_event(websocket: WebSocket, session_id: str, event) -> None:
    """Push node-level execution events to frontend."""
    # Agent text chunks — streamed to chat panel
    if event.event_type == "agent_chunk":
        await websocket.send_json({
            "type": "agent_chunk",
            "data": {"content": event.detail},
        })
        return

    event_type_map = {
        "skill_start": "running",
        "skill_end": "success",
        "skill_error": "failed",
        "dynamic_skill": "running",
    }

    status = event_type_map.get(event.event_type)
    if not status:
        return

    await websocket.send_json({
        "type": "node_status",
        "data": {
            "node_id": event.node_id or event.skill_id or "unknown",
            "skill_id": event.skill_id or "",
            "status": status,
            "started_at": event.timestamp.isoformat() if status == "running" else None,
            "finished_at": event.timestamp.isoformat() if status in ("success", "failed") else None,
            "output": event.extra if status == "success" else {},
            "error": event.detail if status == "failed" else None,
            "logs": [event.detail],
            "is_dynamic": event.extra.get("dynamic_skill", False),
        }
    })
