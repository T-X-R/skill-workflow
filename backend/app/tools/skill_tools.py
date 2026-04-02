"""Skill 相关 Tools — 供 Orchestrator Agent 使用

Progressive disclosure 模式：
1. list_available_skills — 列出所有 skill 摘要（轻量，启动即可用）
2. load_skill_docs       — 按需加载指定 skill 的完整 SKILL.md
3. run_skill_script      — 执行指定 skill 的脚本（有脚本的 skill 才可用）
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING

from langchain.tools import tool, ToolRuntime

from backend.app.config import SKILLS_DIR, TMP_DIR

if TYPE_CHECKING:
    from backend.app.core.skill_registry import SkillRegistry
    from backend.app.core.session_manager import SessionManager

logger = logging.getLogger(__name__)

DEFAULT_SCRIPT_TIMEOUT = 300  # 秒


@dataclass
class SessionContext:
    """注入到每个 Tool 调用的 Session 上下文"""
    session_id: str
    session_type: str = "interactive"   # "interactive" | "batch"
    external_ref: str | None = None
    current_node_id: str | None = None  # 当前执行的 workflow 节点 ID
    workflow_skill_ids: list[str] = field(default_factory=list)  # 原始 workflow 中的 skill ID 列表


# ── 全局引用（在 build_skill_tools 中注入）──────────────────

_registry: SkillRegistry | None = None
_session_manager: SessionManager | None = None


def _get_registry() -> SkillRegistry:
    if _registry is None:
        raise RuntimeError("SkillRegistry 未初始化，请先调用 build_skill_tools(registry)")
    return _registry


# ── Tools ────────────────────────────────────────────────────────────

@tool
def list_available_skills(runtime: ToolRuntime[SessionContext]) -> str:
    """List all available skills with their ID, name, category and description.

    Call this first to discover what capabilities are available before planning
    how to accomplish a task.
    """
    registry = _get_registry()
    summaries = registry.get_all_summaries()

    if not summaries:
        return "当前没有可用的 Skill。"

    lines = ["可用 Skills 列表：\n"]
    by_category: dict[str, list] = {}
    for s in summaries:
        by_category.setdefault(s.category, []).append(s)

    for category, skills in sorted(by_category.items()):
        lines.append(f"【{category}】")
        for s in skills:
            script_tag = " [有脚本]" if s.has_script else " [纯推理]"
            lines.append(f"  - {s.id}: {s.name}{script_tag}")
            if s.description:
                lines.append(f"    {s.description}")
        lines.append("")

    return "\n".join(lines)


@tool
def load_skill_docs(skill_id: str, runtime: ToolRuntime[SessionContext]) -> str:
    """Load full documentation (SKILL.md) for a specific skill.

    Always call this before executing a skill to understand its parameters,
    inputs, outputs and expected behavior.

    Args:
        skill_id: The skill ID as returned by list_available_skills
    """
    registry = _get_registry()
    skill = registry.get_skill(skill_id)

    if not skill:
        available = [s.id for s in registry.get_all_summaries()]
        return (
            f"Skill '{skill_id}' 不存在。\n"
            f"可用的 Skill ID: {', '.join(available[:20])}"
        )

    parts = [
        f"# {skill.name} ({skill.id})",
        f"分类: {skill.category}",
        f"描述: {skill.description}",
        f"有脚本: {'是' if skill.has_script else '否'}",
        "",
    ]

    if skill.skill_md_content:
        parts.append("## 完整文档")
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

    # Normalize each step
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
    return f"执行计划已上报，共 {len(normalized)} 个步骤：{step_names}。现在开始逐步执行。"


@tool
async def run_skill_script(
    skill_id: str,
    arguments: str,
    runtime: ToolRuntime[SessionContext],
) -> str:
    """Execute a skill's processing script with JSON arguments.

    Only available for skills that have scripts (has_script=True).
    Always call load_skill_docs first to understand the required arguments.

    Args:
        skill_id: The skill ID to execute
        arguments: JSON string containing the parameters for the script.
                   Example: '{"input_path": "/path/to/video.mp4"}'
    """
    registry = _get_registry()
    skill = registry.get_skill(skill_id)

    if not skill:
        return json.dumps({"success": False, "error": f"Skill '{skill_id}' 不存在"})

    if not skill.has_script:
        return json.dumps({
            "success": False,
            "error": f"Skill '{skill_id}' 没有可执行脚本，请通过理解其 SKILL.md 文档直接推理执行。"
        })

    script_path = Path(skill.script_path) if skill.script_path else (
        SKILLS_DIR / skill_id / "scripts" / "run.py"
    )

    if not script_path.exists():
        return json.dumps({
            "success": False,
            "error": f"脚本文件不存在: {script_path}"
        })

    # 解析参数
    try:
        args_dict = json.loads(arguments) if arguments.strip() else {}
    except json.JSONDecodeError:
        args_dict = {"input": arguments}

    # 构建命令
    cmd = [sys.executable, str(script_path)]
    env = os.environ.copy()
    env["SKILL_ARGUMENTS"] = json.dumps(args_dict)
    env["SESSION_ID"] = runtime.context.session_id if runtime.context else ""
    env["SKILL_TMP_DIR"] = str(TMP_DIR)

    for key, value in args_dict.items():
        if isinstance(value, (str, int, float, bool)):
            cmd.extend([f"--{key}", str(value)])

    logger.info(f"[{skill_id}] 执行脚本: {script_path}")
    logger.info(f"[{skill_id}] 参数: {arguments[:200]}")

    _emit_skill_event(runtime, skill_id, "skill_start", f"开始执行: {skill_id}")

    try:
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
            cwd=str(script_path.parent),
        )

        try:
            stdout, stderr = await asyncio.wait_for(
                process.communicate(),
                timeout=DEFAULT_SCRIPT_TIMEOUT,
            )
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()
            _emit_skill_event(runtime, skill_id, "skill_error", f"脚本执行超时（>{DEFAULT_SCRIPT_TIMEOUT}s）")
            return json.dumps({
                "success": False,
                "error": f"脚本执行超时（>{DEFAULT_SCRIPT_TIMEOUT}s）: {script_path}"
            })

        stdout_text = stdout.decode("utf-8", errors="replace").strip()
        stderr_text = stderr.decode("utf-8", errors="replace").strip()

        if process.returncode != 0:
            _emit_skill_event(runtime, skill_id, "skill_error", f"脚本退出码 {process.returncode}")
            return json.dumps({
                "success": False,
                "error": f"脚本退出码 {process.returncode}",
                "stderr": stderr_text[:2000],
            })

        try:
            result = json.loads(stdout_text)
        except json.JSONDecodeError:
            result = {
                "success": True,
                "output": stdout_text[:5000],
                "stderr": stderr_text[:1000] if stderr_text else None,
            }

        _try_register_artifacts(result, skill_id, runtime)
        _emit_skill_event(runtime, skill_id, "skill_end", f"执行完成: {skill_id}")
        return json.dumps(result, ensure_ascii=False)

    except FileNotFoundError:
        _emit_skill_event(runtime, skill_id, "skill_error", "Python 解释器或脚本未找到")
        return json.dumps({"success": False, "error": "Python 解释器或脚本未找到"})
    except Exception as e:
        _emit_skill_event(runtime, skill_id, "skill_error", str(e))
        return json.dumps({"success": False, "error": str(e)})


_ARTIFACT_PATH_KEYS = {"output_path", "result_path", "video_path", "audio_path", "srt_path", "image_path", "file_path"}
_MEDIA_EXT_MAP = {
    ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm",
    ".mp3": "audio/mpeg", ".wav": "audio/wav", ".aac": "audio/aac",
    ".srt": "text/srt", ".json": "application/json",
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
}


def _try_register_artifacts(result: dict, skill_id: str, runtime: ToolRuntime[SessionContext]) -> None:
    """Inspect script result for file paths and register them as session artifacts."""
    if _session_manager is None or not runtime.context:
        return
    session_id = runtime.context.session_id
    if not session_id:
        return

    node_id = runtime.context.current_node_id

    for key, value in result.items():
        if key not in _ARTIFACT_PATH_KEYS or not isinstance(value, str):
            continue
        path = Path(value)
        if not path.exists():
            continue
        ext = path.suffix.lower()
        media_type = _MEDIA_EXT_MAP.get(ext, "")
        artifact_key = f"{skill_id}_{key}" if not node_id else f"{node_id}_{skill_id}_{key}"
        try:
            _session_manager.register_artifact(
                session_id=session_id,
                key=artifact_key,
                file_path=str(path),
                media_type=media_type,
                node_id=node_id,
                skill_id=skill_id,
            )
            logger.info(f"[{skill_id}] 已注册产物: {artifact_key} -> {path}")
        except Exception as e:
            logger.warning(f"[{skill_id}] 注册产物失败: {e}")


def _emit_skill_event(
    runtime: ToolRuntime[SessionContext],
    skill_id: str,
    event_type: str,
    detail: str,
    extra: dict | None = None,
) -> None:
    """向 SessionManager 事件总线发布 skill 执行事件。"""
    if _session_manager is None or not runtime.context:
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
    """注入 registry 并返回所有 skill-related tools。"""
    global _registry
    _registry = registry
    return [list_available_skills, load_skill_docs, run_skill_script, report_execution_plan]


def inject_session_manager(session_manager: SessionManager) -> None:
    """后置注入 SessionManager（因为启动顺序晚于 Orchestrator）。"""
    global _session_manager
    _session_manager = session_manager
