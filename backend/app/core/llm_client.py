"""LLM 统一客户端 — 基于 LangChain

支持 OpenAI 和火山引擎 Ark（通过 OpenAI 兼容 API）
"""

from langchain_openai import ChatOpenAI
from loguru import logger

from backend.app.config import settings, LLMConfig, LLMProfileConfig


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
        self._profile_cache: dict[str, ChatOpenAI] = {}
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

    def get_model(self) -> ChatOpenAI:
        """获取底层 LangChain ChatModel 实例（主模型）
        
        用于 create_agent() 等需要直接使用模型的场景。
        """
        return self.model

    def get_model_for_profile(self, profile_name: str) -> ChatOpenAI | None:
        """获取指定 profile 的模型实例（带缓存）。

        Returns:
            ChatOpenAI 实例，如果 profile 不存在或未配置则返回 None
        """
        if profile_name in self._profile_cache:
            return self._profile_cache[profile_name]

        profile = settings.llm_profiles.get(profile_name)
        if not profile or not profile.is_configured:
            return None

        model = ChatOpenAI(
            model=profile.model or None,
            api_key=profile.api_key,
            base_url=profile.base_url or None,
            max_retries=3,
            request_timeout=180,
        )
        self._profile_cache[profile_name] = model
        logger.info(f"已创建 LLM profile '{profile_name}' 模型实例 ({profile.model})")
        return model

    def get_available_profiles(self) -> list[str]:
        """返回所有已配置的 profile 名称列表"""
        return [
            name for name, cfg in settings.llm_profiles.items()
            if cfg.is_configured
        ]

