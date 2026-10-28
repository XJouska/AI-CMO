"""外部服务提供者注册表。

业务代码通过 `providers.llm()` 等获取实现：
- TEST_MODE 或测试中使用假实现
- 生产环境按配置创建真实实现；未配置时抛出 ServiceUnavailableError（界面给出明确提示）

测试中用 `providers.override(llm=FakeLLM())` 临时替换。
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from app.core.config import get_settings
from app.services.fetcher import FakeFetcher, Fetcher, SafeFetcher
from app.services.llm import LLMClient, OpenAICompatLLM
from app.services.storage import LocalStorage, Storage


class _Providers:
    def __init__(self) -> None:
        self._overrides: dict[str, Any] = {}
        self._cache: dict[str, Any] = {}

    def _get(self, name: str, factory_real: Any, factory_fake: Any) -> Any:
        if name in self._overrides:
            return self._overrides[name]
        if name not in self._cache:
            self._cache[name] = factory_fake() if get_settings().test_mode else factory_real()
        return self._cache[name]

    def llm(self) -> LLMClient:
        """LLM 客户端，统一包一层用量计量（见 app/services/metering.py）。"""
        from app.services.fakes import FakeLLM
        from app.services.metering import MeteredLLM

        inner = self._get("llm", OpenAICompatLLM, FakeLLM)
        cached = self._cache.get("llm_metered")
        if cached is None or cached.inner is not inner:
            cached = MeteredLLM(inner)
            self._cache["llm_metered"] = cached
        return cached  # type: ignore[return-value]

    def fetcher(self) -> Fetcher:
        return self._get("fetcher", SafeFetcher, FakeFetcher)

    def webhook(self) -> Any:
        from app.services.fetcher import FakeWebhook, SafeWebhook

        return self._get("webhook", SafeWebhook, FakeWebhook)

    def mailer(self) -> Any:
        from app.services.mailer import FakeMailer, SmtpMailer

        return self._get("mailer", SmtpMailer, FakeMailer)

    def mail_dns(self) -> Any:
        from app.modules.outreach.dns_check import FakeMailDns, SystemMailDns

        return self._get("mail_dns", SystemMailDns, FakeMailDns)

    def lead_sources(self) -> dict[str, Any]:
        from app.modules.sources.connectors import build_connectors, build_fake_connectors

        return self._get("lead_sources", build_connectors, build_fake_connectors)

    def storage(self) -> Storage:
        return self._get(
            "storage",
            lambda: LocalStorage(get_settings().storage_dir),
            lambda: LocalStorage(get_settings().storage_dir),
        )

    def set(self, **kwargs: Any) -> None:
        self._overrides.update(kwargs)

    def reset(self) -> None:
        self._overrides.clear()
        self._cache.clear()

    @contextmanager
    def override(self, **kwargs: Any) -> Iterator[None]:
        previous = dict(self._overrides)
        self._overrides.update(kwargs)
        try:
            yield
        finally:
            self._overrides = previous


providers = _Providers()
