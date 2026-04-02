"""FastAPI 应用入口

提供：
- REST API 路由 (skills, workflows, executions, sessions)
- WebSocket 路由 (session 状态推送)
- 应用启动时初始化所有核心组件
"""

import logging
from contextlib import asynccontextmanager

import aiosqlite
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from backend.app.config import DATA_DIR, TMP_DIR, CHECKPOINTS_DB
from backend.app.storage.local_store import LocalStore
from backend.app.core.skill_registry import SkillRegistry
from backend.app.core.llm_client import LLMClient
from backend.app.core.orchestrator import Orchestrator
from backend.app.core.session_manager import SessionManager
from backend.app.tools import inject_session_manager

from backend.app.api import skills, workflows, executions
from backend.app.api.sessions import router as sessions_router
from backend.app.ws.execution_ws import execution_websocket

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理

    启动时：
    - 初始化 LocalStore
    - 初始化 SkillRegistry 并加载所有 Skills
    - 初始化 LLMClient
    - 初始化 AsyncSqliteSaver（持久化 Agent 对话历史）
    - 初始化 Orchestrator（统一 Agent）
    - 初始化 SessionManager（含并发控制 + TTL 清理）

    关闭时：
    - 清理 SessionManager 中的活跃任务
    - 关闭 SQLite 连接
    """
    logger.info("正在初始化应用...")

    # 确保 tmp 目录存在
    TMP_DIR.mkdir(parents=True, exist_ok=True)
    logger.info(f"中间产物目录: {TMP_DIR}")

    # LocalStore
    store = LocalStore(data_dir=str(DATA_DIR))
    app.state.store = store
    logger.info(f"LocalStore 初始化完成，数据目录: {DATA_DIR}")

    # SkillRegistry
    registry = SkillRegistry()
    registry.reload()
    app.state.skill_registry = registry
    logger.info(f"SkillRegistry 初始化完成，已加载 {len(registry)} 个 Skills")

    # LLMClient
    llm_client = LLMClient()
    app.state.llm_client = llm_client
    logger.info(f"LLMClient 初始化完成，使用 {llm_client.provider_name}")

    # Persistent Checkpointer（SQLite，替代 InMemorySaver）
    CHECKPOINTS_DB.parent.mkdir(parents=True, exist_ok=True)
    sqlite_conn = aiosqlite.connect(str(CHECKPOINTS_DB))
    await sqlite_conn.__aenter__()
    checkpointer = AsyncSqliteSaver(conn=sqlite_conn)
    await checkpointer.setup()
    app.state.checkpointer = checkpointer
    logger.info(f"AsyncSqliteSaver 初始化完成，数据库: {CHECKPOINTS_DB}")

    # Orchestrator（统一 Agent）
    orchestrator = Orchestrator(
        registry=registry,
        llm_client=llm_client,
        checkpointer=checkpointer,
    )
    app.state.orchestrator = orchestrator
    logger.info("Orchestrator 初始化完成")

    # SessionManager（含并发控制 + 事件总线 + TTL 清理）
    session_manager = SessionManager(store=store, orchestrator=orchestrator)
    session_manager.start_background_tasks()
    app.state.session_manager = session_manager
    inject_session_manager(session_manager)
    logger.info("SessionManager 初始化完成")

    logger.info("应用初始化完成！")

    yield  # 应用运行中

    # 关闭时清理
    logger.info("正在清理资源...")
    await session_manager.cleanup()
    await sqlite_conn.__aexit__(None, None, None)
    logger.info("资源清理完成")


app = FastAPI(
    title="Video Skills Platform API",
    description="视频处理 Skill 自动化平台 API",
    version="2.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API 路由
app.include_router(skills.router)
app.include_router(workflows.router)
app.include_router(executions.router)
app.include_router(sessions_router)


# WebSocket — session 状态推送（兼容旧 execution_id 参数名）
@app.websocket("/ws/execution/{execution_id}")
async def websocket_execution(websocket: WebSocket, execution_id: str):
    """WebSocket 端点，实时推送 Session 状态。"""
    await execution_websocket(websocket, execution_id)


@app.get("/health")
async def health_check():
    return {"status": "healthy", "version": "2.0.0"}


@app.get("/")
async def root():
    return {
        "message": "Video Skills Platform API",
        "version": "2.0.0",
        "docs": "/docs",
        "health": "/health",
    }
