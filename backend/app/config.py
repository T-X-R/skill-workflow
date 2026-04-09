"""Application configuration management."""

from __future__ import annotations

from loguru import logger
import json
from dataclasses import dataclass, field
from pathlib import Path
from dotenv import load_dotenv
import os



# Load .env from project root
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
load_dotenv(PROJECT_ROOT / ".env")


# Path constants
SKILLS_DIR = PROJECT_ROOT / "skills"
DATA_DIR = PROJECT_ROOT / "backend" / "data"
TMP_DIR = PROJECT_ROOT / "tmp"
CHECKPOINTS_DB = DATA_DIR / "checkpoints.sqlite"

# Concurrency
MAX_CONCURRENT_BATCH = int(os.getenv("MAX_CONCURRENT_BATCH", "10"))
SESSION_TTL_HOURS = int(os.getenv("SESSION_TTL_HOURS", "72"))


@dataclass
class VolcengineASRConfig:
    """火山引擎 ASR 配置"""
    app_id: str = field(default_factory=lambda: os.getenv("VOLCENGINE_APP_ID", ""))
    access_key: str = field(default_factory=lambda: os.getenv("VOLCENGINE_ACCESS_KEY", ""))
    api_resource_id: str = field(default_factory=lambda: os.getenv("VOLCENGINE_API_RESOURCE_ID", ""))

    @property
    def is_configured(self) -> bool:
        return bool(self.app_id and self.access_key)


@dataclass
class VolcengineWorkflowConfig:
    """火山引擎工作流通用配置（云端视频处理）"""
    access_key: str = field(default_factory=lambda: os.getenv("VOLCENGINE_WORKFLOW_ACCESS_KEY", ""))
    secret_key: str = field(default_factory=lambda: os.getenv("VOLCENGINE_WORKFLOW_SECRET_KEY", ""))
    region: str = field(default_factory=lambda: os.getenv("VOLCENGINE_WORKFLOW_REGION", "cn-north-1"))
    space_name: str = field(default_factory=lambda: os.getenv("VOLCENGINE_WORKFLOW_SPACE_NAME", ""))
    transcoding_template_id: str = field(default_factory=lambda: os.getenv("VOLCENGINE_TRANSCODING_TEMPLATE_ID", ""))
    sdr_template_id: str = field(default_factory=lambda: os.getenv("VOLCENGINE_SDR_TEMPLATE_ID", ""))
    filter_project_id: str = field(default_factory=lambda: os.getenv("VOLCENGINE_FILTER_PROJECT_ID", ""))
    filter_group_id: str = field(default_factory=lambda: os.getenv("VOLCENGINE_FILTER_GROUP_ID", ""))

    @property
    def is_configured(self) -> bool:
        return bool(self.access_key and self.secret_key)


@dataclass
class AliyunOSSConfig:
    """阿里云 OSS 配置"""
    access_key: str = field(default_factory=lambda: os.getenv("ALIYUN_OSS_ACCESS_KEY", ""))
    access_secret: str = field(default_factory=lambda: os.getenv("ALIYUN_OSS_ACCESS_SECRET", ""))
    bucket: str = field(default_factory=lambda: os.getenv("ALIYUN_OSS_BUCKET", ""))
    endpoint: str = field(default_factory=lambda: os.getenv("ALIYUN_OSS_ENDPOINT", ""))

    @property
    def is_configured(self) -> bool:
        return bool(self.access_key and self.access_secret and self.bucket)


@dataclass
class AliyunICEConfig:
    """阿里云 ICE 美颜服务配置"""
    access_key: str = field(default_factory=lambda: os.getenv("ALIYUN_ICE_ACCESS_KEY", ""))
    access_secret: str = field(default_factory=lambda: os.getenv("ALIYUN_ICE_ACCESS_SECRET", ""))
    endpoint: str = field(default_factory=lambda: os.getenv("ALIYUN_ICE_ENDPOINT", "ice.cn-hangzhou.aliyuncs.com"))

    @property
    def is_configured(self) -> bool:
        return bool(self.access_key and self.access_secret)


@dataclass
class LLMConfig:
    """LLM API 配置"""
    # OpenAI-compatible API
    api_key: str = field(default_factory=lambda: os.getenv("API_KEY", ""))
    base_url: str = field(default_factory=lambda: os.getenv("BASE_URL", ""))
    model: str = field(default_factory=lambda: os.getenv("MODEL", "gpt-4o"))
    
    # 火山引擎 Ark（可选）
    ark_api_key: str = field(default_factory=lambda: os.getenv("ARK_API_KEY", ""))
    ark_endpoint_id: str = field(default_factory=lambda: os.getenv("ARK_ENDPOINT_ID", ""))

    @property
    def is_openai_configured(self) -> bool:
        return bool(self.api_key and self.base_url)

    @property
    def is_ark_configured(self) -> bool:
        return bool(self.ark_api_key and self.ark_endpoint_id)

    @property
    def is_configured(self) -> bool:
        return self.is_openai_configured or self.is_ark_configured


@dataclass
class LLMProfileConfig:
    """单个 LLM Sub-agent Profile 配置"""
    api_key: str = ""
    base_url: str = ""
    model: str = ""

    @property
    def is_configured(self) -> bool:
        return bool(self.api_key)


def _parse_llm_profiles() -> dict[str, LLMProfileConfig]:
    """从 LLM_PROFILES 环境变量解析多模型配置。

    格式: JSON object, key=profile 名称, value={"api_key", "base_url", "model"}
    示例: LLM_PROFILES='{"gemini-3.1":{"api_key":"xxx","base_url":"https://...","model":"gemini-3.1-pro"}}'
    """
    raw = os.getenv("LLM_PROFILES", "")
    if not raw:
        return {}

    try:
        profiles_data = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("LLM_PROFILES 环境变量 JSON 解析失败，忽略")
        return {}

    profiles: dict[str, LLMProfileConfig] = {}
    for name, cfg in profiles_data.items():
        if isinstance(cfg, dict):
            profiles[name] = LLMProfileConfig(
                api_key=cfg.get("api_key", ""),
                base_url=cfg.get("base_url", ""),
                model=cfg.get("model", ""),
            )
    return profiles


@dataclass
class Settings:
    """应用配置集合"""
    volcengine_asr: VolcengineASRConfig = field(default_factory=VolcengineASRConfig)
    volcengine_workflow: VolcengineWorkflowConfig = field(default_factory=VolcengineWorkflowConfig)
    aliyun_oss: AliyunOSSConfig = field(default_factory=AliyunOSSConfig)
    aliyun_ice: AliyunICEConfig = field(default_factory=AliyunICEConfig)
    llm: LLMConfig = field(default_factory=LLMConfig)
    llm_profiles: dict[str, LLMProfileConfig] = field(default_factory=_parse_llm_profiles)


# 全局单例
settings = Settings()
