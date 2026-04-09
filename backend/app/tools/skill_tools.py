"""Skill 相关 Tools — 供 Orchestrator Agent 使用

Progressive disclosure 模式（通过 SkillMiddleware 实现）：
1. SkillMiddleware         — 动态注入 skill 摘要到 system prompt（省去 list 工具调用）
2. load_skill              — 按需加载指定 skill 的完整 SKILL.md，同时标记画布节点为执行中
3. report_execution_plan   — 上报执行计划到画布
4. mark_skill_done         — 标记 skill 执行完成/失败
5. delegate_to_subagent    — 委托 sub-agent 执行特定 skill
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING

from langchain.tools import tool, ToolRuntime
from loguru import logger

from backend.app.config import TMP_DIR

if TYPE_CHECKING:
    from backend.app.core.skill_registry import SkillRegistry
    from backend.app.core.session_manager import SessionManager
    from backend.app.core.subagent import SubAgentExecutor


@dataclass
class SessionContext:
    """注入到每个 Tool 调用的 Session 上下文"""
    session_id: str
    session_type: str = "interactive"   # "interactive" | "batch"
    external_ref: str | None = None
    current_node_id: str | None = None  # 当前执行的 workflow 节点 ID
    workflow_skill_ids: list[str] = field(default_factory=list)


# ── 全局引用（在 build_skill_tools 中注入）──────────────────

_registry: SkillRegistry | None = None
_session_manager: SessionManager | None = None
_subagent_executor: SubAgentExecutor | None = None


def _get_registry() -> SkillRegistry:
    if _registry is None:
        raise RuntimeError("SkillRegistry 未初始化，请先调用 build_skill_tools(registry)")
    return _registry


# ── Tools ────────────────────────────────────────────────────────────

@tool
def load_skill(skill_id: str, runtime: ToolRuntime[SessionContext]) -> str:
    """Load a specialized skill prompt and context.

    Always call this before executing a skill. Returns the skill's full
    documentation (SKILL.md) including parameters, usage instructions, and
    expected behavior.

    Side effect: marks the skill as "running" on the canvas (blue highlight).

    Args:
        skill_id: The skill ID as shown in the Available Skills list in the system prompt
    """
    registry = _get_registry()
    skill = registry.get_skill(skill_id)

    if not skill:
        available = [s.id for s in registry.get_all_summaries()]
        logger.warning(f"[load_skill] NOT FOUND: {skill_id}")
        return (
            f"Skill '{skill_id}' 不存在。\n"
            f"可用的 Skill ID: {', '.join(available[:20])}"
        )

    session_id = runtime.context.session_id if runtime and runtime.context else "?"
    logger.info(f"[load_skill] {skill_id}  session={session_id}")
    _emit_skill_event(runtime, skill_id, "skill_start", f"开始执行: {skill_id}")

    parts = [
        f"# {skill.name} ({skill.id})",
        f"分类: {skill.category}",
        f"描述: {skill.description}",
    ]

    if skill.preferred_model:
        parts.append(f"推荐模型: {skill.preferred_model}（建议使用 delegate_to_subagent 委托执行）")

    parts.append("")

    if skill.skill_md_content:
        parts.append(skill.skill_md_content)

    return "\n".join(parts)


@tool
def report_execution_plan(
    steps: str,
    runtime: ToolRuntime[SessionContext],
) -> str:
    """Report the planned execution steps before starting execution.

    Call this IMMEDIATELY after understanding the user's request and determining
    which skills are needed. Report the full plan upfront so the user can see
    the execution flow on the canvas before any skill runs.

    Args:
        steps: JSON array of planned steps, e.g.
               '[{"skill_id": "volcengine-asr", "label": "语音识别"},
                 {"skill_id": "subtitle-burn", "label": "烧录字幕"}]'
               Each item must have "skill_id" and optionally "label".
    """
    if _session_manager is None or not runtime.context:
        return "计划已记录（无 session 上下文，不广播事件）"

    session_id = runtime.context.session_id
    if not session_id:
        return "计划已记录（session_id 为空，不广播事件）"

    try:
        parsed_steps = json.loads(steps)
        if not isinstance(parsed_steps, list):
            parsed_steps = [{"skill_id": str(steps), "label": str(steps)}]
    except (json.JSONDecodeError, ValueError):
        parsed_steps = [{"skill_id": steps.strip(), "label": steps.strip()}]

    normalized: list[dict] = []
    for item in parsed_steps:
        if isinstance(item, dict):
            skill_id = item.get("skill_id") or item.get("id") or str(item)
            label = item.get("label") or item.get("name") or skill_id
            normalized.append({"skill_id": str(skill_id), "label": str(label)})
        else:
            normalized.append({"skill_id": str(item), "label": str(item)})

    from backend.app.models.session import ExecutionEvent

    _session_manager.emit_event(session_id, ExecutionEvent(
        event_type="execution_plan",
        detail=f"执行计划: {len(normalized)} 个步骤",
        extra={"steps": normalized},
    ))

    step_names = ", ".join(s["label"] for s in normalized)
    logger.info(f"[plan] {len(normalized)} steps: {step_names}  session={session_id}")
    return f"执行计划已上报，共 {len(normalized)} 个步骤：{step_names}。现在开始逐步执行。"


@tool
def mark_skill_done(
    skill_id: str,
    success: bool = True,
    detail: str = "",
    runtime: ToolRuntime[SessionContext] = None,
) -> str:
    """Mark a skill as completed on the canvas.

    Call this after you finish executing a skill. The canvas node will update
    to show a green checkmark (success) or red cross (failure).

    Args:
        skill_id: The skill ID that finished executing
        success: Whether the execution was successful (default True)
        detail: Optional short summary of the result
    """
    if success:
        logger.info(f"[skill] ✓ {skill_id}{('  ' + detail) if detail else ''}")
        _emit_skill_event(runtime, skill_id, "skill_end", detail or f"执行完成: {skill_id}")
        return f"已标记 skill '{skill_id}' 完成。"
    else:
        logger.warning(f"[skill] ✗ {skill_id}{('  ' + detail) if detail else ''}")
        _emit_skill_event(runtime, skill_id, "skill_error", detail or f"执行失败: {skill_id}")
        return f"已标记 skill '{skill_id}' 失败。"


@tool
async def delegate_to_subagent(
    skill_id: str,
    instruction: str,
    model_profile: str = "",
    runtime: ToolRuntime[SessionContext] = None,
) -> str:
    """Delegate a skill to a sub-agent that uses a different LLM model.

    Use this when a skill has a preferred_model configured, or when you want
    to leverage a specific model's strengths for a particular task. The
    sub-agent runs independently with its own model and returns the result.

    This automatically marks the skill as completed on the canvas.

    Args:
        skill_id: The skill ID to delegate (must exist in the registry)
        instruction: Detailed instruction for the sub-agent — include all
                     context it needs: input file paths, expected output,
                     specific requirements. The sub-agent has NO access to
                     your conversation history.
        model_profile: LLM profile name to use. If empty, uses the skill's
                       preferred_model from its SKILL.md frontmatter.
    """
    if _subagent_executor is None:
        return json.dumps({"success": False, "error": "SubAgentExecutor 未初始化"})

    registry = _get_registry()
    skill = registry.get_skill(skill_id)
    if not skill:
        return json.dumps({"success": False, "error": f"Skill '{skill_id}' 不存在"})

    profile = model_profile.strip() if model_profile else None
    if not profile:
        profile = skill.preferred_model
    if not profile:
        return json.dumps({
            "success": False,
            "error": (
                f"未指定 model_profile，且 skill '{skill_id}' 没有配置 preferred_model。"
                "请通过 model_profile 参数指定，或自行推理执行。"
            ),
        })

    session_id = runtime.context.session_id if runtime and runtime.context else ""
    logger.info(f"[subagent] → {skill_id}  profile={profile}  session={session_id}")

    result_text = await _subagent_executor.execute(
        skill_id=skill_id,
        profile_name=profile,
        task_instruction=instruction,
        session_id=session_id,
    )

    _emit_skill_event(runtime, skill_id, "skill_end", f"Sub-agent 执行完成: {skill_id}")

    return json.dumps({
        "success": True,
        "skill_id": skill_id,
        "model_profile": profile,
        "result": result_text,
    }, ensure_ascii=False)


# ── Internal helpers ─────────────────────────────────────────────────

def _emit_skill_event(
    runtime: ToolRuntime[SessionContext] | None,
    skill_id: str,
    event_type: str,
    detail: str,
    extra: dict | None = None,
) -> None:
    """向 SessionManager 事件总线发布 skill 执行事件。"""
    if _session_manager is None or not runtime or not runtime.context:
        return
    session_id = runtime.context.session_id
    if not session_id:
        return

    from backend.app.models.session import ExecutionEvent

    node_id = runtime.context.current_node_id
    is_dynamic = (
        skill_id not in runtime.context.workflow_skill_ids
        if runtime.context.workflow_skill_ids
        else False
    )
    evt_extra = extra or {}
    if is_dynamic:
        evt_extra["dynamic_skill"] = True

    _session_manager.emit_event(session_id, ExecutionEvent(
        event_type="dynamic_skill" if (is_dynamic and event_type == "skill_start") else event_type,
        node_id=node_id,
        skill_id=skill_id,
        detail=detail,
        extra=evt_extra,
    ))


# ── Builder ──────────────────────────────────────────────────────────

def build_skill_tools(registry: SkillRegistry) -> list:
    """注入 registry 并返回所有 skill-related tools。

    注意：skill 发现（摘要列表）由 SkillMiddleware 动态注入到 system prompt，
    不再需要 list_available_skills 工具。
    """
    global _registry
    _registry = registry
    return [
        load_skill,
        report_execution_plan,
        mark_skill_done,
        delegate_to_subagent,
    ]


def inject_session_manager(session_manager: SessionManager) -> None:
    """后置注入 SessionManager（因为启动顺序晚于 Orchestrator）。"""
    global _session_manager
    _session_manager = session_manager


def inject_subagent_executor(executor: SubAgentExecutor) -> None:
    """后置注入 SubAgentExecutor。"""
    global _subagent_executor
    _subagent_executor = executor
