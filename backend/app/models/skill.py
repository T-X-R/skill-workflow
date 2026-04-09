"""Skill data models using Pydantic v2."""

from typing import Any
from pydantic import BaseModel, Field


class SkillParam(BaseModel):
    """Skill 参数定义"""
    name: str
    type: str = "string"  # "string", "number", "boolean", "select"
    description: str = ""
    required: bool = False
    default: Any = None
    options: list[str] | None = None  # for select type


class SkillIO(BaseModel):
    """Skill 输入/输出定义"""
    name: str
    type: str = "string"
    description: str = ""


class SkillMeta(BaseModel):
    """完整的 Skill 元数据"""
    id: str = Field(..., description="目录名，如 'volcengine-asr'")
    name: str = Field(..., description="显示名称")
    description: str = Field(default="", description="简短描述")
    category: str = Field(default="通用", description="分类")
    inputs: list[SkillIO] = Field(default_factory=list)
    outputs: list[SkillIO] = Field(default_factory=list)
    params: list[SkillParam] = Field(default_factory=list)
    has_script: bool = Field(default=False, description="是否有可执行脚本")
    script_path: str | None = Field(default=None, description="脚本路径")
    preferred_model: str | None = Field(default=None, description="推荐使用的 LLM profile 名称，设置后可委托给 sub-agent 执行")
    skill_md_content: str = Field(default="", description="完整 SKILL.md 原文")


class SkillSummary(BaseModel):
    """精简信息，用于列表展示"""
    id: str
    name: str
    description: str
    category: str
    has_script: bool = False
    preferred_model: str | None = None

    @classmethod
    def from_meta(cls, meta: SkillMeta) -> "SkillSummary":
        """从完整元数据创建摘要"""
        return cls(
            id=meta.id,
            name=meta.name,
            description=meta.description,
            category=meta.category,
            has_script=meta.has_script,
            preferred_model=meta.preferred_model,
        )
