"""Session 数据模型定义"""

from enum import Enum
from pydantic import BaseModel, Field
from datetime import datetime
import uuid

__all__ = [
    "SessionType",
    "Artifact",
    "ExecutionEvent",
    "Session",
    "SessionCreate",
]


class SessionType(str, Enum):
    INTERACTIVE = "interactive"
    BATCH = "batch"


class Artifact(BaseModel):
    """执行过程中产生的中间产物"""
    key: str                # 唯一标识，如 "node_3_output_video"
    file_path: str          # 本地文件路径
    media_type: str = ""    # "video/mp4", "audio/wav", "text/srt" 等
    node_id: str | None = None
    skill_id: str | None = None
    version: int = 1        # 重跑时递增，支持产物版本对比
    created_at: datetime = Field(default_factory=datetime.utcnow)

    model_config = {
        "json_encoders": {datetime: lambda v: v.isoformat()}
    }


class ExecutionEvent(BaseModel):
    """Agent 执行过程中的可观测事件"""
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    event_type: str         # node_start / node_end / skill_call / rerun / dynamic_skill / error
    node_id: str | None = None
    skill_id: str | None = None
    detail: str = ""
    extra: dict = Field(default_factory=dict)

    model_config = {
        "json_encoders": {datetime: lambda v: v.isoformat()}
    }


class Session(BaseModel):
    """Agent 会话，承载对话历史、执行状态、中间产物"""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    type: SessionType = SessionType.INTERACTIVE
    external_ref: str | None = None     # 外部标识，如视频 ID，用于反向追溯
    workflow_id: str | None = None      # 关联的工作流 ID（若基于模版执行）
    execution_id: str | None = None     # 关联的执行记录 ID
    artifacts: dict[str, Artifact] = Field(default_factory=dict)
    execution_log: list[ExecutionEvent] = Field(default_factory=list)
    visible: bool = True                # 批量 session 设为 False，不在控制面板显示
    status: str = "active"              # active / success / failed / paused / cancelled
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    model_config = {
        "json_encoders": {datetime: lambda v: v.isoformat()}
    }


class SessionCreate(BaseModel):
    """创建 Session 的请求体"""
    type: SessionType = SessionType.INTERACTIVE
    external_ref: str | None = None
    workflow_id: str | None = None
    visible: bool = True
