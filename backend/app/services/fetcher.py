"""网页抓取抽象。真实实现经过 safe_fetch（SSRF 防护）；假实现返回预置页面，但仍执行 URL 校验。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from app.core.security.ssrf import SsrfBlockedError, safe_fetch, validate_url


@dataclass
class FetchedPage:
    url: str
    status: int
    content_type: str
    text: str


class Fetcher(Protocol):
    async def fetch(self, url: str) -> FetchedPage: ...


class SafeFetcher:
    def __init__(self, max_bytes: int = 2 * 1024 * 1024) -> None:
        self.max_bytes = max_bytes

    async def fetch(self, url: str) -> FetchedPage:
        result = await safe_fetch(url, max_bytes=self.max_bytes, headers={"Accept": "text/html,*/*;q=0.5"})
        return FetchedPage(
            url=result.url,
            status=result.status_code,
            content_type=result.headers.get("content-type", ""),
            text=result.text,
        )


DEMO_SITE = """<!doctype html><html><head><title>Demo Valve Manufacturing Co., Ltd.</title>
<meta name="description"
 content="Stainless steel ball valves and gate valves manufacturer since 2008."></head>
<body><h1>Demo Valve Manufacturing</h1>
<p>Founded in 2008, 120 employees, 15000 square meters factory. Annual capacity 500,000 valves.</p>
<p>Certifications: ISO 9001, CE. Export markets: Germany, United States, Brazil.</p>
<a href="/products">Products</a><a href="/about">About</a>
<p>Contact: sales@demo-valve.example</p></body></html>"""


class FakeFetcher:
    """TEST_MODE / 测试使用：任何通过校验的公开地址都返回预置页面；pages 可覆盖特定地址。"""

    def __init__(self, pages: dict[str, str] | None = None) -> None:
        self.pages = pages or {}
        self.requested: list[str] = []

    async def fetch(self, url: str) -> FetchedPage:
        parsed = validate_url(url, allow_hosts=())
        if parsed.ip_literal is not None:
            from app.core.security.ssrf import is_blocked_ip

            if is_blocked_ip(parsed.ip_literal):
                raise SsrfBlockedError("blocked_ip", str(parsed.ip_literal))
        if parsed.host in {"localhost", "localhost.localdomain"} or parsed.host.endswith(".internal"):
            raise SsrfBlockedError("blocked_ip", parsed.host)
        self.requested.append(parsed.url)
        html = self.pages.get(parsed.url, DEMO_SITE)
        return FetchedPage(url=parsed.url, status=200, content_type="text/html; charset=utf-8", text=html)


# ── Webhook 发送（企业微信群机器人等）─────────────────────────────────


@dataclass
class WebhookResult:
    status_code: int
    body: bytes


class SafeWebhook:
    """经 safe_fetch 发出 POST（不允许内网地址、限制跳转与响应大小）。"""

    async def post(self, url: str, payload: bytes) -> WebhookResult:
        result = await safe_fetch(
            url,
            method="POST",
            content=payload,
            headers={"Content-Type": "application/json"},
            max_redirects=0,
            max_bytes=64_000,
            timeout=10.0,
        )
        return WebhookResult(result.status_code, result.content)


@dataclass
class FakeWebhook:
    sent: list[tuple[str, bytes]] = field(default_factory=list)
    status_code: int = 200

    async def post(self, url: str, payload: bytes) -> WebhookResult:
        validate_url(url)
        self.sent.append((url, payload))
        return WebhookResult(self.status_code, b'{"errcode":0}')
