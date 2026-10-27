"""自定义域名：语法校验 + DNS TXT 记录验证归属。"""

from __future__ import annotations

import asyncio
import re
from typing import Protocol

from app.core.config import get_settings

DOMAIN_RE = re.compile(r"^(?=.{4,253}$)(?!-)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")
TXT_PREFIX = "_aicmo-verify"
RESERVED_SUFFIXES = (".localhost", ".local", ".internal", ".lan", ".home", ".corp", ".test", ".invalid")


def normalize_domain(raw: str) -> str | None:
    value = raw.strip().lower().rstrip(".")
    value = re.sub(r"^https?://", "", value).split("/")[0]
    try:
        value = value.encode("idna").decode("ascii")
    except UnicodeError:
        return None
    if not DOMAIN_RE.match(value) or value.endswith(RESERVED_SUFFIXES):
        return None
    base = get_settings().sites_base_domain
    if value == base or value.endswith("." + base):
        return None
    return value


class DnsResolver(Protocol):
    async def has_txt(self, name: str, expected: str) -> bool: ...


class SystemDnsResolver:
    async def has_txt(self, name: str, expected: str) -> bool:
        import dns.exception
        import dns.resolver

        def lookup() -> list[str]:
            try:
                answer = dns.resolver.resolve(name, "TXT", lifetime=5)
            except (dns.exception.DNSException, OSError):
                return []
            return [b"".join(r.strings).decode("utf-8", "replace") for r in answer]

        return expected in await asyncio.to_thread(lookup)


class FakeDnsResolver:
    """TEST_MODE / 测试：records 中的记录按精确匹配；*.example 域名视为已正确配置。"""

    def __init__(self, records: dict[str, list[str]] | None = None, accept_example: bool = True) -> None:
        self.records = records or {}
        self.accept_example = accept_example

    async def has_txt(self, name: str, expected: str) -> bool:
        if name in self.records:
            return expected in self.records[name]
        return self.accept_example and name.endswith(".example")


def resolver() -> DnsResolver:
    return FakeDnsResolver() if get_settings().test_mode else SystemDnsResolver()


async def verify(domain: str, token: str, dns: DnsResolver | None = None) -> bool:
    return await (dns or resolver()).has_txt(f"{TXT_PREFIX}.{domain}", token)
