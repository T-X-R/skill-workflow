"""Tools package — assembles all tools for the Orchestrator Agent.

Skill-related tools (load_skill, mark_skill_done, etc.) are registered via
SkillMiddleware.tools and are NOT included in build_system_tools(). The
middleware also injects skill descriptions into the system prompt, so the
deprecated list_available_skills tool has been removed.
"""

from __future__ import annotations

from .skill_tools import build_skill_tools, inject_session_manager, inject_subagent_executor, SessionContext
from .system_tools import build_system_tools

__all__ = [
    "build_system_tools",
    "build_skill_tools",
    "inject_session_manager",
    "inject_subagent_executor",
    "SessionContext",
]
