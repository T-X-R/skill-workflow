"""Session Manager — 管理 Agent 会话的完整生命周期

负责：
- 创建/查询/列举 Session
- 转发用户消息到 Orchestrator（流式）
- 在 session 中启动 Workflow 执行（含并发控制）
- 追踪中间产物（artifacts）与执行事件（execution_log）
- 事件总线：供 WebSocket 等下游实时消费
- 过期 Session 自动清理
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from collections import defaultdict
from datetime import datetime, timedelta
from typing import TYPE_CHECKING, Any, AsyncGenerator, Callable

from backend.app.config import MAX_CONCURRENT_BATCH, SESSION_TTL_HOURS
from backend.app.models.session import (
    Session, SessionCreate, SessionType, Artifact, ExecutionEvent,
)

if TYPE_CHECKING:
    from backend.app.core.orchestrator import Orchestrator
    from backend.app.models.workflow import Workflow
    from backend.app.storage.local_store import LocalStore

logger = logging.getLogger(__name__)

EventCallback = Callable[[str, ExecutionEvent], Any]  # (session_id, event) -> ...


class SessionManager:
    """管理 Agent 会话的生命周期。"""

    def __init__(self, store: LocalStore, orchestrator: Orchestrator):
        self.store = store
        self.orchestrator = orchestrator

        # 内存缓存：session_id → Session
        self._sessions: dict[str, Session] = {}
        # 活跃的批量执行任务：session_id → Task
        self._active_tasks: dict[str, asyncio.Task] = {}

        # P2: 并发控制 — 限制同时运行的 batch workflow 数量
        self._batch_semaphore = asyncio.Semaphore(MAX_CONCURRENT_BATCH)
        self._batch_queue_size = 0

        # P4: 事件总线 — session_id → list[callback]
        self._event_subscribers: dict[str, list[EventCallback]] = defaultdict(list)
        # 全局订阅（用于监控/日志）
        self._global_subscribers: list[EventCallback] = []

        # TTL 清理任务
        self._cleanup_task: asyncio.Task | None = None

    def start_background_tasks(self) -> None:
        """启动后台定时任务（在 lifespan 中调用）。"""
        self._cleanup_task = asyncio.create_task(self._periodic_cleanup())

    # ── Session CRUD ──────────────────────────────────────────────────

    async def create_session(
        self,
        session_type: SessionType = SessionType.INTERACTIVE,
        external_ref: str | None = None,
        workflow_id: str | None = None,
        visible: bool = True,
    ) -> Session:
        session = Session(
            id=str(uuid.uuid4()),
            type=session_type,
            external_ref=external_ref,
            workflow_id=workflow_id,
            visible=visible,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        self._sessions[session.id] = session
        self.store.save_session(session)
        logger.info(f"创建 Session: {session.id} type={session_type.value}")
        return session

    def get_session(self, session_id: str) -> Session | None:
        if session_id in self._sessions:
            return self._sessions[session_id]
        session = self.store.load_session(session_id)
        if session:
            self._sessions[session.id] = session
        return session

    def list_visible_sessions(self) -> list[Session]:
        sessions = self.store.list_sessions(visible_only=True)
        for s in sessions:
            self._sessions[s.id] = s
        return sessions

    def list_all_sessions(self) -> list[Session]:
        sessions = self.store.list_sessions(visible_only=False)
        for s in sessions:
            self._sessions[s.id] = s
        return sessions

    def find_sessions_by_ref(self, external_ref: str) -> list[Session]:
        return self.store.find_sessions_by_ref(external_ref)

    def _save_session(self, session: Session) -> None:
        session.updated_at = datetime.utcnow()
        self._sessions[session.id] = session
        self.store.save_session(session)

    # ── Event Bus ─────────────────────────────────────────────────────

    def subscribe(self, session_id: str, callback: EventCallback) -> None:
        """订阅某个 session 的执行事件（WebSocket 用）。"""
        self._event_subscribers[session_id].append(callback)

    def unsubscribe(self, session_id: str, callback: EventCallback) -> None:
        cbs = self._event_subscribers.get(session_id, [])
        if callback in cbs:
            cbs.remove(callback)
        if not cbs:
            self._event_subscribers.pop(session_id, None)

    def subscribe_global(self, callback: EventCallback) -> None:
        self._global_subscribers.append(callback)

    def broadcast_transient_event(self, session_id: str, event: ExecutionEvent) -> None:
        """广播瞬态事件：仅通知订阅者，不写入 execution_log（用于高频文本流）。"""
        for cb in self._event_subscribers.get(session_id, []):
            try:
                cb(session_id, event)
            except Exception as e:
                logger.warning(f"瞬态事件回调异常: {e}")

        for cb in self._global_subscribers:
            try:
                cb(session_id, event)
            except Exception as e:
                logger.warning(f"全局瞬态事件回调异常: {e}")

    def emit_event(self, session_id: str, event: ExecutionEvent) -> None:
        """发布执行事件：写入 session.execution_log 并通知订阅者。"""
        session = self.get_session(session_id)
        if session:
            session.execution_log.append(event)
            self._save_session(session)

        for cb in self._event_subscribers.get(session_id, []):
            try:
                cb(session_id, event)
            except Exception as e:
                logger.warning(f"事件回调异常: {e}")

        for cb in self._global_subscribers:
            try:
                cb(session_id, event)
            except Exception as e:
                logger.warning(f"全局事件回调异常: {e}")

    # ── Messaging ─────────────────────────────────────────────────────

    async def send_message_stream(
        self,
        session_id: str,
        user_message: str,
    ) -> AsyncGenerator[str, None]:
        """将用户消息发给 Orchestrator，流式 yield Agent 回复。"""
        session = self.get_session(session_id)
        if not session:
            yield f"Session '{session_id}' 不存在"
            return

        try:
            async for chunk in self.orchestrator.chat_stream(session, user_message):
                yield chunk
        except Exception as e:
            logger.error(f"[session={session_id}] send_message_stream 失败: {e}")
            yield f"\n抱歉，出现了错误：{str(e)}"
        finally:
            self._save_session(session)

    # ── Workflow Execution ────────────────────────────────────────────

    async def run_workflow_in_session(
        self,
        session_id: str,
        workflow: Workflow,
        param_overrides: dict | None = None,
    ) -> AsyncGenerator[str, None]:
        """在指定 session 中执行 workflow，流式 yield 进展。"""
        if param_overrides is None:
            param_overrides = {}
        session = self.get_session(session_id)
        if not session:
            yield f"Session '{session_id}' 不存在"
            return

        session.workflow_id = workflow.id
        self._save_session(session)

        self.emit_event(session_id, ExecutionEvent(
            event_type="workflow_start",
            detail=f"开始执行工作流: {workflow.name}",
            extra={"workflow_id": workflow.id},
        ))

        try:
            async for chunk in self.orchestrator.run_workflow(session, workflow, param_overrides):
                yield chunk

            session.status = "success"
            self.emit_event(session_id, ExecutionEvent(
                event_type="workflow_end",
                detail="工作流执行完成",
                extra={"status": "success"},
            ))
        except Exception as e:
            logger.error(f"[session={session_id}] workflow 执行失败: {e}")
            session.status = "failed"
            self.emit_event(session_id, ExecutionEvent(
                event_type="workflow_end",
                detail=f"工作流执行失败: {e}",
                extra={"status": "failed", "error": str(e)},
            ))
            yield f"\n执行失败：{str(e)}"
        finally:
            self._save_session(session)

    async def start_workflow_background(
        self,
        session_id: str,
        workflow: Workflow,
        param_overrides: dict | None = None,
        on_chunk: Callable[[str], Any] | None = None,
    ) -> None:
        """后台启动 workflow 执行。

        batch session 受 semaphore 限制并发数；
        interactive session 直接启动不排队。
        """
        session = self.get_session(session_id)
        is_batch = session and session.type == SessionType.BATCH

        def _make_chunk_handler() -> Callable[[str], None]:
            """Build an on_chunk callback that broadcasts agent text via the event bus."""
            outer_on_chunk = on_chunk

            def _handle(chunk: str) -> None:
                self.broadcast_transient_event(session_id, ExecutionEvent(
                    event_type="agent_chunk",
                    detail=chunk,
                ))
                if outer_on_chunk:
                    try:
                        outer_on_chunk(chunk)
                    except Exception:
                        pass

            return _handle

        async def _run():
            chunk_handler = _make_chunk_handler()
            if is_batch:
                self._batch_queue_size += 1
                logger.info(
                    f"[batch] session={session_id} 排队中 "
                    f"(队列={self._batch_queue_size}, 并发上限={MAX_CONCURRENT_BATCH})"
                )
                async with self._batch_semaphore:
                    self._batch_queue_size -= 1
                    await self._execute_workflow(session_id, workflow, param_overrides, chunk_handler)
            else:
                await self._execute_workflow(session_id, workflow, param_overrides, chunk_handler)

        task = asyncio.create_task(_run())
        self._active_tasks[session_id] = task

        def _cleanup(t: asyncio.Task):
            self._active_tasks.pop(session_id, None)

        task.add_done_callback(_cleanup)

    async def _execute_workflow(
        self,
        session_id: str,
        workflow: Workflow,
        param_overrides: dict | None,
        on_chunk: Callable[[str], Any] | None,
    ) -> None:
        async for chunk in self.run_workflow_in_session(
            session_id, workflow, param_overrides
        ):
            if on_chunk:
                try:
                    on_chunk(chunk)
                except Exception:
                    pass

    # ── Artifact Management ───────────────────────────────────────────

    def register_artifact(
        self,
        session_id: str,
        key: str,
        file_path: str,
        media_type: str = "",
        node_id: str | None = None,
        skill_id: str | None = None,
    ) -> Artifact | None:
        session = self.get_session(session_id)
        if not session:
            return None

        existing = session.artifacts.get(key)
        version = (existing.version + 1) if existing else 1

        artifact = Artifact(
            key=key,
            file_path=file_path,
            media_type=media_type,
            node_id=node_id,
            skill_id=skill_id,
            version=version,
        )
        session.artifacts[key] = artifact

        self.emit_event(session_id, ExecutionEvent(
            event_type="artifact_registered",
            node_id=node_id,
            skill_id=skill_id,
            detail=f"产物已注册: {key} (v{version})",
            extra={"file_path": file_path, "media_type": media_type, "version": version},
        ))

        self._save_session(session)
        return artifact

    def get_artifacts(self, session_id: str) -> dict[str, Artifact]:
        session = self.get_session(session_id)
        if not session:
            return {}
        return session.artifacts

    # ── Batch Status ─────────────────────────────────────────────────

    def get_batch_status(self) -> dict:
        """返回批量执行的队列/并发状态。"""
        active_count = sum(1 for t in self._active_tasks.values() if not t.done())
        return {
            "max_concurrent": MAX_CONCURRENT_BATCH,
            "active_tasks": active_count,
            "queued": self._batch_queue_size,
        }

    # ── TTL Cleanup ──────────────────────────────────────────────────

    async def _periodic_cleanup(self) -> None:
        """定时清理过期的 Session 内存缓存和 checkpointer 数据。"""
        while True:
            try:
                await asyncio.sleep(3600)  # 每小时检查一次
                cutoff = datetime.utcnow() - timedelta(hours=SESSION_TTL_HOURS)
                expired_ids = [
                    sid for sid, s in self._sessions.items()
                    if s.status in ("success", "failed", "cancelled")
                    and s.updated_at < cutoff
                    and sid not in self._active_tasks
                ]
                for sid in expired_ids:
                    self._sessions.pop(sid, None)

                if expired_ids:
                    logger.info(f"已从内存缓存清理 {len(expired_ids)} 个过期 Session")

                    checkpointer = self.orchestrator.checkpointer
                    if hasattr(checkpointer, "adelete_thread"):
                        for sid in expired_ids:
                            try:
                                await checkpointer.adelete_thread(sid)
                            except Exception:
                                pass
                        logger.info(f"已从 checkpointer 清理 {len(expired_ids)} 个过期线程")

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"定时清理异常: {e}")

    # ── Lifecycle ─────────────────────────────────────────────────────

    async def cleanup(self):
        """关闭时取消所有活跃任务。"""
        if self._cleanup_task and not self._cleanup_task.done():
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass

        for session_id, task in list(self._active_tasks.items()):
            if not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
        self._active_tasks.clear()

    def is_active(self, session_id: str) -> bool:
        task = self._active_tasks.get(session_id)
        return task is not None and not task.done()
