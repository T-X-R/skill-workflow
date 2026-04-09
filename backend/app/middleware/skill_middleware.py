"""SkillMiddleware — Progressive disclosure of skills via system prompt injection.

Follows the official LangChain AgentMiddleware pattern:
- Injects skill descriptions (摘要) into the system prompt on every model call
- Registers skill-related tools (load_skill, etc.) via `self.tools`
- Rebuilds prompt from registry on each call, so live reloads are reflected
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Awaitable, Callable

from langchain.agents.middleware import AgentMiddleware, ModelRequest, ModelResponse
from langchain_core.messages import SystemMessage

if TYPE_CHECKING:
    from backend.app.core.skill_registry import SkillRegistry


class SkillMiddleware(AgentMiddleware):
    """Middleware that injects skill descriptions into the system prompt.

    Follows the official LangChain progressive disclosure pattern.
    Skill summaries are dynamically injected into the system prompt on every
    model call, so registry reloads are reflected without restarting the agent.

    Skills tools (load_skill, mark_skill_done, report_execution_plan,
    delegate_to_subagent) are registered via self.tools so create_agent picks
    them up automatically alongside whatever tools= were passed directly.
    """

    def __init__(self, registry: SkillRegistry) -> None:
        from backend.app.tools.skill_tools import build_skill_tools
        self.registry = registry
        self.tools = build_skill_tools(registry)

    def _build_skills_prompt(self) -> str:
        """Build the skill listing from the current registry state."""
        summaries = self.registry.get_all_summaries()
        if not summaries:
            return ""

        by_category: dict[str, list] = {}
        for s in summaries:
            by_category.setdefault(s.category, []).append(s)

        lines: list[str] = []
        for category, skills in sorted(by_category.items()):
            lines.append(f"### {category}")
            for s in skills:
                model_tag = f" [推荐模型: {s.preferred_model}]" if s.preferred_model else ""
                lines.append(f"- **{s.id}**: {s.name}{model_tag} — {s.description}")
            lines.append("")

        return "\n".join(lines)

    def _inject_skills(self, request: ModelRequest) -> ModelRequest:
        """Return a modified request with skill descriptions appended to the system prompt."""
        skills_prompt = self._build_skills_prompt()
        if not skills_prompt:
            return request

        addendum = (
            f"\n\n## 可用 Skills\n\n{skills_prompt}\n"
            "需要执行某个 skill 时，先调用 `load_skill(skill_id)` 加载完整文档后再执行。"
        )
        new_content = list(request.system_message.content_blocks) + [
            {"type": "text", "text": addendum}
        ]
        new_system_message = SystemMessage(content=new_content)
        return request.override(system_message=new_system_message)

    def wrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], ModelResponse],
    ) -> ModelResponse:
        """Sync: inject skill descriptions before every LLM call."""
        return handler(self._inject_skills(request))

    async def awrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], Awaitable[ModelResponse]],
    ) -> ModelResponse:
        """Async: inject skill descriptions before every LLM call (for astream/ainvoke)."""
        return await handler(self._inject_skills(request))
