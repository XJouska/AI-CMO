import os
from pathlib import Path
from pydantic_settings import BaseSettings
from typing import Optional

# Find .env file: check project root (parent of backend/)
_env_file = Path(__file__).resolve().parent.parent.parent / ".env"
if not _env_file.exists():
    _env_file = ".env"


class Settings(BaseSettings):
    # Database
    database_url: str = "postgresql://ai_cmo:ai_cmo_pass@localhost:5432/ai_cmo"

    # Auth
    secret_key: str = "change_me"

    # Qwen LLM
    qwen_api_key: str = ""
    qwen_api_base: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    qwen_model: str = "qwen-max-latest"

    # Google OAuth
    google_client_id: str = ""

    # AgentGo
    agentgo_api_key: str = ""
    agentgo_api_url: str = "https://app.agentgo.live"

    # Payment - LemonSqueezy
    lemonsqueezy_api_key: str = ""
    lemonsqueezy_store_id: str = ""
    lemonsqueezy_webhook_secret: str = ""
    lemonsqueezy_product_id: str = ""
    lemonsqueezy_variant_id: str = ""

    # Payment - Alipay
    alipay_app_id: str = ""
    alipay_private_key_path: str = ""
    alipay_public_key_path: str = ""
    alipay_notify_url: str = ""
    alipay_return_url: str = ""
    alipay_sandbox: bool = False

    # App
    cors_origins: str = "http://localhost:5173,http://localhost:9000"
    log_level: str = "INFO"
    free_analysis_limit: int = 1
    premium_top_n: int = 10
    free_top_n: int = 3

    class Config:
        env_file = str(_env_file)
        extra = "ignore"


settings = Settings()
