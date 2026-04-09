"""Orchestrator Agent — 统一的 AI 编排大脑

一个有状态的 ReAct Agent，通过 session 隔离记忆，支持：
- 对话式需求理解与 skill 编排
- Workflow 模版执行（含 execution_policy 和 quality_gate）
- 动态质检与回退
- 流式回复

Skill 发现通过 SkillMiddleware 动态注入到 system prompt（progressive disclosure）。
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, AsyncGenerator

from langchain.agents import create_agent
from langchain_core.messages import AIMessageChunk
from langgraph.store.memory import InMemoryStore
from loguru import logger

from backend.app.middleware.skill_middleware import SkillMiddleware
from backend.app.tools import build_system_tools, SessionContext
from backend.app.models.workflow import Workflow
from backend.app.config import TMP_DIR

if TYPE_CHECKING:
    from langgraph.checkpoint.base import BaseCheckpointSaver
    from backend.app.core.skill_registry import SkillRegistry
    from backend.app.core.llm_client import LLMClient
    from backend.app.models.session import Session


# ── System Prompt ─────────────────────────────────────────────────────

def _build_system_prompt() -> str:
    tmp_dir = str(TMP_DIR)
    return f"""你是一个专业的任务执行助手，擅长协调和执行各类处理任务。你拥有一套工具和多个 skills 来完成具体的工作。

## 工作方式

### 发现与执行
- 阅读文档，按照文档指引使用可用工具完成任务
- 执行完成后，调用 `mark_skill_done(skill_id)` 标记完成

### 执行策略
当执行工作流节点时，遵守每个节点的 execution_policy：
- `always`：直接执行，无需判断
- `agent_decides`：先用工具评估是否需要执行，参考 condition_hint 的指引，再决定是否调用 skill
- `skip`：跳过该节点

### 质检策略（quality_gate）
若节点有 quality_gate，执行完毕后**必须**进行质检，流程如下：

#### strategy = self_review（AI 自检）
1. 根据 criteria 描述的标准，结合 skill 输出与日志，自主判断执行结果是否达标
2. 判断维度：输出文件是否存在、内容是否完整、是否符合 criteria 中的具体约束
3. 如果不达标 → 调整参数后重试，最多 max_retries 次

#### strategy = metric_check（指标量化检查）
1. 使用 `run_bash` 执行检测命令（如 ffprobe 读取分辨率/码率/时长、wc 统计行数等），获取量化指标
2. 将实际指标与 criteria 中声明的阈值对比，严格按数值判定是否达标
3. 如果不达标 → 调整参数后重试，最多 max_retries 次

#### 重试耗尽后的 fallback 处理
- `use_original`：放弃处理结果，使用原始输入继续后续节点
- `skip`：跳过该节点，继续后续流程
- `fail`：标记该节点失败并停止整个工作流

#### 质检报告
每次质检完成后，简要说明：检查了哪些指标、实际值是什么、是否通过、如果重试了几次。

### 执行计划上报
理解用户需求并确定所需 skill 后，**在执行任何 skill 之前**，先调用 `report_execution_plan` 上报完整计划（包含每个步骤的 skill_id 和可读标签）。
这让用户能在画布上预览完整的执行流程，然后再开始执行。
示例：`report_execution_plan(steps='[{{"skill_id":"download","label":"下载视频"}},{{"skill_id":"volcengine-asr","label":"语音识别"}}]')`

### Sub-agent 委托
当一个 skill 配置了 `preferred_model`（推荐模型）时，可以使用 `delegate_to_subagent` 委托给独立的 sub-agent 执行（自动标记完成，无需调 `mark_skill_done`）。

委托时注意：
- **instruction 必须包含完整上下文**：sub-agent 看不到你的对话历史，所以你需要把所有必要信息（输入文件路径、参数、期望输出等）都写在 instruction 里
- Sub-agent 执行完会返回结果文本，你需要解读并继续后续流程

### 通用工具
除 skill 工具外，你还可以使用：
- `run_bash`：执行 shell 命令（如 ffprobe 获取视频信息）
- `read_file`：读取本地文件
- `write_file`：写入本地文件
- `download_file`：从 URL 下载文件

## 沟通风格
- 用自然、友好的中文与用户交流，像同事之间对话
- 执行过程中简洁告知进展，不要输出原始日志或 JSON 块
- 遇到问题时解释原因并提出建议
- 执行完毕后用简洁的语言总结结果

## 重要原则
- 执行 skill 前，**必须**先用 `load_skill` 加载文档
- **所有中间产物必须保存到 `{tmp_dir}` 目录**，包括：下载的视频、提取的音频、ASR JSON、字幕文件、处理后的视频等
  - `download_file` 的 `save_path` 使用 `{tmp_dir}/<filename>`
  - skill 的 `output` / `output_path` 参数使用 `{tmp_dir}/<filename>`
  - `write_file` 的路径使用 `{tmp_dir}/<filename>`
  - 文件名使用有意义的名称，例如 `downloaded_video.mp4`、`audio.mp3`、`asr_result.json`
- 保存重要的中间产物路径，后续节点可能需要引用
- 如果发现当前任务需要某个未预定义的 skill，直接使用可用工具组合完成
- 用户对结果不满意时，可以根据反馈重新执行相关步骤
"""

SYSTEM_PROMPT_LAYER1 = _build_system_prompt()


def _build_workflow_message(workflow: Workflow, param_overrides: dict | None = None) -> str:
    """将 Workflow 定义转换为发给 Agent 的结构化消息。"""
    from backend.app.core.workflow_engine import WorkflowEngine
    engine = WorkflowEngine()

    if param_overrides is None:
        param_overrides = {}

    is_valid, error = engine.validate_dag(workflow)
    if not is_valid:
        return f"工作流验证失败：{error}"

    execution_order = engine.topological_sort(workflow)
    node_map = {node.node_id: node for node in workflow.nodes}

    parts = [
        f"请按以下工作流执行任务：",
        f"工作流名称：{workflow.name}",
    ]
    if workflow.description:
        parts.append(f"说明：{workflow.description}")

    parts.append(f"\n节点执行顺序：{' → '.join(execution_order)}\n")

    for node_id in execution_order:
        node = node_map.get(node_id)
        if not node:
            continue

        params = {**node.params}
        if node_id in param_overrides:
            params.update(param_overrides[node_id])

        parts.append(f"【{node_id}】skill: {node.skill_id}")
        parts.append(f"  label: {node.label or node.skill_id}")
        parts.append(f"  policy: {node.execution_policy}")

        if params:
            parts.append(f"  params: {json.dumps(params, ensure_ascii=False)}")

        if node.condition_hint:
            parts.append(f"  condition_hint: {node.condition_hint}")

        if node.quality_gate and node.quality_gate.strategy != "none":
            qg = node.quality_gate
            parts.append(f"  quality_gate:")
            parts.append(f"    strategy: {qg.strategy}")
            parts.append(f"    criteria: {qg.criteria}")
            parts.append(f"    max_retries: {qg.max_retries}")
            parts.append(f"    fallback: {qg.fallback}")

        parts.append("")

    parts.append("请开始执行，完成后告知我最终结果。")
    return "\n".join(parts)


# ── Orchestrator ──────────────────────────────────────────────────────

class Orchestrator:
    """统一的 AI 编排 Agent。

    生命周期：应用启动时创建一个实例，所有 session 共享同一个 agent 实例，
    通过 thread_id（= session.id）隔离各自的对话历史。
    """

    def __init__(
        self,
        registry: SkillRegistry,
        llm_client: LLMClient,
        checkpointer: BaseCheckpointSaver | None = None,
    ):
        self.registry = registry
        self.checkpointer = checkpointer
        self.store = InMemoryStore()

        self._skill_middleware = SkillMiddleware(registry)
        self._system_tools = build_system_tools()

        self._agent = create_agent(
            model=llm_client.get_model(),
            tools=self._system_tools,
            system_prompt=SYSTEM_PROMPT_LAYER1,
            middleware=[self._skill_middleware],
            context_schema=SessionContext,
            checkpointer=self.checkpointer,
            store=self.store,
        )
        skill_tool_count = len(self._skill_middleware.tools)
        logger.info(
            f"Orchestrator 初始化完成，系统工具 {len(self._system_tools)} 个，"
            f"通过 SkillMiddleware 注入 skill {skill_tool_count} 个"
        )

    def _make_config(self, session: Session) -> dict:
        return {"configurable": {"thread_id": session.id}}

    def _make_context(
        self, session: Session, workflow_skill_ids: list[str] | None = None,
    ) -> SessionContext:
        return SessionContext(
            session_id=session.id,
            session_type=session.type.value,
            external_ref=session.external_ref,
            workflow_skill_ids=workflow_skill_ids or [],
        )

    async def chat_stream(
        self,
        session: Session,
        user_message: str,
    ) -> AsyncGenerator[str, None]:
        """发送用户消息，流式返回 Agent 回复 token。"""
        config = self._make_config(session)
        context = self._make_context(session)

        input_messages = {"messages": [{"role": "user", "content": user_message}]}

        try:
            async for chunk in self._agent.astream(
                input_messages,
                config=config,
                context=context,
                stream_mode="messages",
            ):
                # chunk 是 (message_chunk, metadata) 元组，或直接是 message_chunk
                msg_chunk = chunk[0] if isinstance(chunk, tuple) else chunk
                if isinstance(msg_chunk, AIMessageChunk):
                    content = msg_chunk.content
                    if isinstance(content, str) and content:
                        yield content

        except Exception as e:
            logger.error(f"[session={session.id}] chat_stream 失败: {e}")
            yield f"\n抱歉，执行过程中遇到了问题：{str(e)}"

    async def run_workflow(
        self,
        session: Session,
        workflow: Workflow,
        param_overrides: dict | None = None,
    ) -> AsyncGenerator[str, None]:
        """将 Workflow 定义注入为用户消息，Agent 自主执行整个流程。"""
        workflow_message = _build_workflow_message(workflow, param_overrides)
        workflow_skill_ids = [node.skill_id for node in workflow.nodes]

        config = self._make_config(session)
        context = self._make_context(session, workflow_skill_ids=workflow_skill_ids)

        input_messages = {"messages": [{"role": "user", "content": workflow_message}]}

        try:
            async for chunk in self._agent.astream(
                input_messages,
                config=config,
                context=context,
                stream_mode="messages",
            ):
                msg_chunk = chunk[0] if isinstance(chunk, tuple) else chunk
                if isinstance(msg_chunk, AIMessageChunk):
                    content = msg_chunk.content
                    if isinstance(content, str) and content:
                        yield content

        except Exception as e:
            logger.error(f"[session={session.id}] run_workflow 失败: {e}")
            yield f"\n抱歉，执行过程中遇到了问题：{str(e)}"

