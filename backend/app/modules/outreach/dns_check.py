"""发信域名的 SPF / DMARC 检查（只做提示，不阻断发送）。DKIM 选择器因服务商而异，无法通用检测，界面给出说明。"""

from __future__ import annotations

import asyncio
from typing import Any, Protocol


class MailDns(Protocol):
    async def txt(self, name: str) -> list[str]: ...


class SystemMailDns:
    async def txt(self, name: str) -> list[str]:
        import dns.exception
        import dns.resolver

        def lookup() -> list[str]:
            try:
                answer = dns.resolver.resolve(name, "TXT", lifetime=5)
            except (dns.exception.DNSException, OSError):
                return []
            return [b"".join(r.strings).decode("utf-8", "replace") for r in answer]

        return await asyncio.to_thread(lookup)


class FakeMailDns:
    """*.example 域名视为已正确配置 SPF 与 DMARC；records 可覆盖。"""

    def __init__(self, records: dict[str, list[str]] | None = None) -> None:
        self.records = records or {}

    async def txt(self, name: str) -> list[str]:
        if name in self.records:
            return self.records[name]
        if name.endswith(".example") or name.endswith(".example.com"):
            return ["v=DMARC1; p=none"] if name.startswith("_dmarc.") else ["v=spf1 include:_spf.example ~all"]
        return []


async def check_domain(domain: str, dns: MailDns) -> dict[str, Any]:
    spf = any(r.lower().startswith("v=spf1") for r in await dns.txt(domain))
    dmarc = any(r.lower().startswith("v=dmarc1") for r in await dns.txt(f"_dmarc.{domain}"))
    hints = []
    if not spf:
        hints.append("发信域名未配置 SPF 记录，邮件容易进入垃圾箱。请在域名解析中添加邮箱服务商提供的 SPF 记录。")
    if not dmarc:
        hints.append("发信域名未配置 DMARC 记录，建议添加 _dmarc TXT 记录（例如 v=DMARC1; p=none）。")
    hints.append("请在邮箱服务商后台确认已开启 DKIM 签名。")
    return {"domain": domain, "spf": spf, "dmarc": dmarc, "hints": hints}
