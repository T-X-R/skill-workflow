"""SubAgent Executor — 用指定模型执行特定 Skill 的临时 Agent

主 Agent 可以将特定 skill 委托给 sub-agent，sub-agent 使用独立的 LLM 模型
和精简的工具集完成任务后返回结果。Sub-agent 是临时的，不保留对话历史。
"""

from __future__ import annotations

from langchain.agents import create_agent
from langchain_core.messages import AIMessageChunk
from loguru import logger

from backend.app.config import TMP_DIR
from backend.app.tools.system_tools import build_system_tools

from backend.app.core.llm_client import LLMClient
from backend.app.core.skill_registry import SkillRegistry


def _build_subagent_prompt(skill_name: str, skill_md_content: str) -> str:
    tmp_dir = str(TMP_DIR)
    return f"""你是一个专注执行单一任务的 AI 助手。你被委派来执行特定的 skill: {skill_name}。

## Skill 文档

{skill_md_content}

## 可用工具

- `run_bash`：执行 shell 命令（ffmpeg、ffprobe 等）
- `read_file`：读取本地文件
- `write_file`：写入本地文件
- `download_file`：从 URL 下载文件

## 规则

- **所有中间产物保存到 `{tmp_dir}` 目录**
- 仔细阅读上方的 skill 文档，理解输入输出要求
- 完成后清晰总结执行结果，包括：是否成功、产出文件路径、关键信息
- 如果遇到错误，说明原因并尝试解决
- 不要执行与当前 skill 无关的操作
"""


class SubAgentExecutor:
    """临时 Sub-Agent 执行器。

    为指定 skill 创建一个使用独立 LLM 模型的临时 agent。
    执行完毕后 agent 即销毁，不保留对话历史。
    """

    def __init__(self, registry: SkillRegistry, llm_client: LLMClient):
        self.registry = registry
        self.llm_client = llm_client

    async def execute(
        self,
        skill_id: str,
        profile_name: str,
        task_instruction: str,
        session_id: str = "",
    ) -> str:
        """用指定模型的 sub-agent 执行 skill。

        Args:
            skill_id: 要执行的 skill ID
            profile_name: LLM profile 名称（对应 LLM_PROFILES 中的 key）
            task_instruction: 主 Agent 给 sub-agent 的具体指令
            session_id: 当前 session ID（用于工具上下文）

        Returns:
            Sub-agent 的完整回复文本
        """
        skill = self.registry.get_skill(skill_id)
        if not skill:
            return f"错误: Skill '{skill_id}' 不存在"

        model = self.llm_client.get_model_for_profile(profile_name)
        if model is None:
            available = self.llm_client.get_available_profiles()
            return (
                f"错误: LLM profile '{profile_name}' 未配置或不可用。"
                f"可用的 profiles: {', '.join(available) if available else '无'}"
            )

        tools = self._build_tools()
        system_prompt = _build_subagent_prompt(
            skill_name=skill.name,
            skill_md_content=skill.skill_md_content or f"{skill.name}\n{skill.description}",
        )

        from backend.app.tools.skill_tools import SessionContext

        agent = create_agent(
            model=model,
            tools=tools,
            system_prompt=system_prompt,
            context_schema=SessionContext,
        )

        logger.info(
            f"[SubAgent] skill='{skill_id}' profile='{profile_name}' "
            f"model='{model.model_name}' session='{session_id}'"
        )

        input_messages = {"messages": [{"role": "user", "content": task_instruction}]}
        context = SessionContext(session_id=session_id)
        config = {"configurable": {"thread_id": f"subagent-{session_id}-{skill_id}"}}

        chunks: list[str] = []
        try:
            async for chunk in agent.astream(
                input_messages,
                config=config,
                context=context,
                stream_mode="messages",
            ):
                msg_chunk = chunk[0] if isinstance(chunk, tuple) else chunk
                if isinstance(msg_chunk, AIMessageChunk):
                    content = msg_chunk.content
                    if isinstance(content, str) and content:
                        chunks.append(content)
        except Exception as e:
            logger.error(f"[SubAgent] 执行失败: {e}", exc_info=True)
            return f"Sub-agent 执行失败: {str(e)}"

        result = "".join(chunks)
        logger.info(f"[SubAgent] 执行完成，结果长度: {len(result)} 字符")
        return result

    def _build_tools(self) -> list:
        """Sub-agent 的工具集：通用系统工具"""
        return build_system_tools()
