"""Workflow 数据模型定义"""

from typing import Literal
from pydantic import BaseModel, Field
from datetime import datetime
import uuid

__all__ = [
    "Position",
    "QualityGate",
    "WorkflowNode",
    "WorkflowEdge",
    "Workflow",
    "WorkflowCreate",
    "WorkflowUpdate",
]


class Position(BaseModel):
    """节点在画布上的位置"""
    x: float = 0
    y: float = 0


class QualityGate(BaseModel):
    """节点执行后的质检策略"""
    strategy: Literal["self_review", "metric_check", "none"] = "none"
    criteria: str = ""
    max_retries: int = 2
    fallback: Literal["use_original", "skip", "fail"] = "use_original"


class WorkflowNode(BaseModel):
    """工作流节点"""
    node_id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8])
    skill_id: str                    # 对应 skills/ 目录下的 Skill ID
    position: Position = Field(default_factory=Position)  # 画布上的位置
    params: dict = Field(default_factory=dict)            # 用户配置的参数
    label: str = ""                  # 显示标签（可覆盖 Skill 默认名称）
    execution_policy: Literal["always", "agent_decides", "skip"] = "always"
    condition_hint: str | None = None   # agent_decides 时的自然语言判断指引
    quality_gate: QualityGate | None = None  # 执行后质检策略


class WorkflowEdge(BaseModel):
    """工作流边（节点连接）"""
    id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8])
    source_node_id: str
    target_node_id: str
    source_handle: str = "output"    # 输出端口名
    target_handle: str = "input"     # 输入端口名


class Workflow(BaseModel):
    """工作流定义"""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str = "未命名工作流"
    description: str = ""
    nodes: list[WorkflowNode] = Field(default_factory=list)
    edges: list[WorkflowEdge] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)
    # True = auto-saved as part of execution, not shown in load list
    is_draft: bool = False
    # True = published as a callable API preset
    is_published: bool = False

    model_config = {
        "json_encoders": {
            datetime: lambda v: v.isoformat()
        }
    }


class WorkflowCreate(BaseModel):
    """创建工作流的请求体"""
    name: str = "未命名工作流"
    description: str = ""
    nodes: list[WorkflowNode] = Field(default_factory=list)
    edges: list[WorkflowEdge] = Field(default_factory=list)
    is_draft: bool = False


class WorkflowUpdate(BaseModel):
    """更新工作流的请求体"""
    name: str | None = None
    description: str | None = None
    nodes: list[WorkflowNode] | None = None
    edges: list[WorkflowEdge] | None = None
    is_draft: bool | None = None
    is_published: bool | None = None
