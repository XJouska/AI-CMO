"""应用配置。所有密钥从环境变量读取，缺少必填项时启动失败。"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

APP_VERSION = "0.1.0"


class Settings(BaseSettings):
    # env_ignore_empty：.env 中留空的变量（如 SEARCH_API_KEY=）按未设置处理，使用默认值
    model_config = SettingsConfigDict(env_file=None, extra="ignore", case_sensitive=False, env_ignore_empty=True)

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
    max_upload_bytes: int = 20 * 1024 * 1024

    session_ttl_days: int = 7
    # 登录限流：单 IP 15 分钟内最多尝试次数；单账号连续失败次数达到上限后锁定。
    login_ip_limit: int = 20
    register_ip_limit_per_hour: int = 10
    login_fail_lock_threshold: int = 5
    login_lock_minutes: int = 15
    invite_ttl_hours: int = 72

    # 客户官网
    sites_output_dir: str = "/data/sites"
    # 平台子域名的根域名，例如 sites.aicmo.site → {slug}.sites.aicmo.site
    sites_base_domain: str = "sites.localhost"
    sites_scheme: Literal["http", "https"] = "https"
    turnstile_secret: SecretStr | None = None
    pagespeed_api_key: SecretStr | None = None

    # 商机情报
    search_api_provider: Literal["bing", "serpapi", "none"] = "none"
    search_api_key: SecretStr | None = None
    # 额外的 RSS 数据源（JSON 数组：[{"key": "...", "url": "...", "kind": "tender|news"}]）
    rss_sources: list[dict[str, str]] = Field(default_factory=list)
    # 单企业单次监控运行的成本上限
    leads_max_queries: int = 12
    leads_max_fetches: int = 40
    leads_max_llm_calls: int = 30
    # 高于该分数且置信度高的商机自动通过复核；为空表示全部人工复核（试点期）
    leads_auto_approve_score: int | None = None

    # 触达与跟进
    # 发信邮箱凭据加密密钥（Fernet，逗号分隔支持轮换；第一个用于加密）。生产环境必填
    mail_encryption_key: SecretStr | None = None
    # 每个绑定邮箱每日发送上限（企业可在此范围内调低）
    mail_daily_limit_max: int = 50
    # 退订链接签名有效期（天）
    unsubscribe_link_days: int = 365

    # 测试模式：外部服务（LLM、抓取、短信等）全部使用假实现。生产环境禁止开启。
    test_mode: bool = False

    @model_validator(mode="after")
    def _no_test_mode_in_production(self) -> Settings:
        if self.test_mode and self.app_env == "production":
            raise ValueError("生产环境不允许开启 TEST_MODE")
        if self.app_env == "production" and not self.mail_encryption_key:
            raise ValueError("生产环境必须配置 MAIL_ENCRYPTION_KEY")
        if self.mail_encryption_key:
            from cryptography.fernet import Fernet

            try:
                for key in self.mail_encryption_key.get_secret_value().split(","):
                    if key.strip():
                        Fernet(key.strip())
            except ValueError as exc:
                raise ValueError("MAIL_ENCRYPTION_KEY 格式不正确（应为 Fernet 密钥）") from exc
        return self

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
