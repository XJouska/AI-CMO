"""浏览器出网规则（不依赖 playwright，api 与 worker 均可导入和测试）。"""

from app.core.config import get_settings
from app.core.security.ssrf import SsrfBlockedError, resolve_and_check, validate_url

BLOCKED_PAGE_DOMAINS = ("linkedin.com", "lnkd.in")


async def check_target(url: str) -> None:
    """页面级校验：协议、端口、IP 字面量、DNS 解析结果、禁止平台。"""
    parsed = validate_url(url, allow_hosts=get_settings().ssrf_allow_hosts)
    if any(parsed.host == d or parsed.host.endswith("." + d) for d in BLOCKED_PAGE_DOMAINS):
        raise SsrfBlockedError("blocked_ip", parsed.host)
    await resolve_and_check(parsed, allow_hosts=get_settings().ssrf_allow_hosts)


async def guard_route(route) -> None:  # type: ignore[no-untyped-def]
    """拦截页面中的每个请求（含重定向、iframe、图片、XHR）：不符合出网规则的请求直接中止。

    data: / blob: 子资源（内联图片等）不会访问网络，允许；data: 文档导航不允许。
    """
    request = route.request
    url = request.url
    if url.startswith(("data:", "blob:")) and request.resource_type != "document":
        await route.continue_()
        return
    try:
        await check_target(url)
    except SsrfBlockedError:
        await route.abort("blockedbyclient")
        return
    await route.continue_()
