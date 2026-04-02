"""Tools package — assembles all tools for the Orchestrator Agent."""

from __future__ import annotations

from typing import TYPE_CHECKING

from .skill_tools import build_skill_tools, inject_session_manager, SessionContext
from .system_tools import build_system_tools

if TYPE_CHECKING:
    from backend.app.core.skill_registry import SkillRegistry

__all__ = ["build_all_tools", "inject_session_manager", "SessionContext"]


def build_all_tools(registry: "SkillRegistry") -> list:
    """Build and return the complete tool list for the Orchestrator Agent."""
    return [
        *build_skill_tools(registry),
        *build_system_tools(),
    ]
