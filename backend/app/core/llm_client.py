"""LLM 统一客户端 — 基于 LangChain

支持 OpenAI 和火山引擎 Ark（通过 OpenAI 兼容 API）
"""

import logging
from typing import AsyncGenerator

from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage

from backend.app.config import settings, LLMConfig

logger = logging.getLogger(__name__)


# === 自定义异常 ===

class LLMError(Exception):
    """LLM 调用基础异常"""
    pass


class LLMConfigError(LLMError):
    """LLM 配置错误"""
    pass


class LLMAPIError(LLMError):
    """LLM API 调用失败"""
    pass


# === LLM 客户端 ===

class LLMClient:
    """基于 LangChain 的统一 LLM 客户端
    
    支持 OpenAI API 和火山引擎 Ark（通过 base_url 兼容）。
    提供 chat()、chat_stream()、get_model() 三个核心接口。
    """

    def __init__(self, config: LLMConfig | None = None):
        if config is None:
            config = settings.llm
        self.config = config
        self.model = self._init_model(config)
        self.provider_name = self._get_provider_name(config)
        logger.info(f"LLMClient 初始化完成，使用 {self.provider_name}")

    def _init_model(self, config: LLMConfig) -> ChatOpenAI:
        """初始化 LangChain ChatModel
        
        优先使用 OpenAI API，降级到火山引擎 Ark。
        两者都通过 ChatOpenAI 类接入（Ark 兼容 OpenAI 协议）。
        """
        # 优先 OpenAI（需要 api_key 和 base_url）
        if config.is_openai_configured:
            return ChatOpenAI(
                model=config.model or None,
                api_key=config.api_key,
                base_url=config.base_url or None,
                max_retries=3,
                request_timeout=120,
            )
        
        raise LLMConfigError(
            "未配置 LLM API Key。请在 .env 中设置 API_KEY/BASE_URL 或 ARK_API_KEY/ARK_ENDPOINT_ID"
        )

    def _get_provider_name(self, config: LLMConfig) -> str:
        """获取当前使用的 Provider 名称"""
        if config.is_openai_configured:
            return f"OpenAI ({config.model or 'gpt-4o'})"
        return f"Volcengine Ark ({config.ark_endpoint_id})"

    async def chat(self, messages: list, **kwargs) -> str:
        """统一聊天接口
        
        Args:
            messages: 消息列表，支持两种格式：
                - LangChain Message 对象列表
                - OpenAI 格式 dict 列表 [{"role": "system", "content": "..."}]
            **kwargs: 传递给模型的额外参数
            
        Returns:
            LLM 回复的文本内容
        """
        try:
            lc_messages = self._normalize_messages(messages)
            response = await self.model.ainvoke(lc_messages, **kwargs)
            return response.content
        except Exception as e:
            logger.error(f"LLM 调用失败: {e}")
            raise LLMAPIError(f"LLM 调用失败: {e}") from e

    async def chat_stream(self, messages: list, **kwargs) -> AsyncGenerator[str, None]:
        """流式聊天接口
        
        Args:
            messages: 消息列表（同 chat()）
            **kwargs: 传递给模型的额外参数
            
        Yields:
            LLM 回复的文本 chunk
        """
        try:
            lc_messages = self._normalize_messages(messages)
            async for chunk in self.model.astream(lc_messages, **kwargs):
                if chunk.content:
                    yield chunk.content
        except Exception as e:
            logger.error(f"LLM 流式调用失败: {e}")
            raise LLMAPIError(f"LLM 流式调用失败: {e}") from e

    def get_model(self) -> ChatOpenAI:
        """获取底层 LangChain ChatModel 实例
        
        用于 create_agent() 等需要直接使用模型的场景。
        """
        return self.model

    def _normalize_messages(self, messages: list) -> list:
        """将消息标准化为 LangChain Message 对象
        
        支持两种输入格式：
        1. 已经是 LangChain Message 对象 → 直接返回
        2. OpenAI 格式 dict → 转换为 LangChain Message
        """
        if not messages:
            return []
        
        # 已经是 LangChain Message 对象
        if hasattr(messages[0], 'content') and not isinstance(messages[0], dict):
            return messages
        
        # OpenAI 格式 dict → LangChain Message
        result = []
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            if role == "system":
                result.append(SystemMessage(content=content))
            elif role == "assistant":
                result.append(AIMessage(content=content))
            else:
                result.append(HumanMessage(content=content))
        return result
