"""应用配置。所有密钥从环境变量读取，缺少必填项时启动失败。"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

APP_VERSION = "0.1.0"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore", case_sensitive=False)

    app_env: Literal["development", "test", "production"] = "development"
    log_level: str = "INFO"

    # 必填：缺失时 Settings() 抛出 ValidationError，进程启动失败。
    database_url: str = Field(min_length=1)
    secret_key: SecretStr

    cors_origins: list[str] = Field(default_factory=list)
    public_base_url: str = "http://localhost:5173"

    # LLM（OpenAI 兼容接口）。未配置时相关功能降级并提示。
    llm_api_key: SecretStr | None = None
    llm_api_base: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    llm_model: str = "qwen-plus"

    # 浏览器抓取（仅 worker 使用）
    browser_profile_dir: str = "/data/browser-profile"
    browser_headless: bool = True
    browser_proxy: str | None = None

    # SSRF：默认不允许任何内部域名；如需开放，必须经项目负责人确认后配置。
    ssrf_allow_hosts: list[str] = Field(default_factory=list)

    storage_dir: str = "/data/storage"

    @field_validator("secret_key")
    @classmethod
    def _secret_key_strength(cls, value: SecretStr) -> SecretStr:
        if len(value.get_secret_value()) < 32:
            raise ValueError("SECRET_KEY 至少 32 个字符")
        return value

    @field_validator("database_url")
    @classmethod
    def _normalize_db_url(cls, value: str) -> str:
        # 统一使用 psycopg 3 驱动。
        if value.startswith("postgresql://"):
            return "postgresql+psycopg://" + value.removeprefix("postgresql://")
        if value.startswith("postgres://"):
            return "postgresql+psycopg://" + value.removeprefix("postgres://")
        return value

    @property
    def llm_enabled(self) -> bool:
        return bool(self.llm_api_key and self.llm_api_key.get_secret_value())

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
