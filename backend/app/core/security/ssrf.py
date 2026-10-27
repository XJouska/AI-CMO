"""SSRF 防护：所有服务端出网请求必须经过本模块。

规则（见 plans/00-overview.md 第 5 节）：
- 只允许 http / https，只允许端口 80 / 443，URL 中不允许携带账号密码
- IP 字面量只接受标准点分十进制 IPv4 和标准 IPv6；十进制整数、八进制、十六进制、缩写等写法一律拒绝
- 解析域名的全部 A / AAAA 记录，任一地址落在禁止范围即拒绝
- 禁止范围：非全局地址（回环、私有、链路本地、CGNAT、保留、文档、基准测试等）、组播、
  IPv6 ULA / 链路本地 / 站点本地，以及额外的 9/8、10/8、11/8、21/8、30/8；
  IPv4 映射、6to4、NAT64、IPv4 兼容等内嵌 IPv4 的 IPv6 地址按内嵌地址判断
- safe_fetch 禁用自动跳转，手动跟随最多 5 次，每一跳重新校验；
  连接时使用已校验的 IP（防 DNS 重绑定），TLS SNI 和 Host 头仍为原域名
"""

from __future__ import annotations

import asyncio
import ipaddress
import socket
import ssl
from collections.abc import Awaitable, Callable, Iterable, Mapping
from dataclasses import dataclass, field
from typing import Literal
from urllib.parse import urljoin, urlsplit, urlunsplit

import httpcore
import httpx

from app.core.errors import AppError

IPAddress = ipaddress.IPv4Address | ipaddress.IPv6Address
Resolver = Callable[[str, int], Awaitable[list[str]]]

ALLOWED_SCHEMES = frozenset({"http", "https"})
ALLOWED_PORTS = frozenset({80, 443})
DEFAULT_PORTS = {"http": 80, "https": 443}
MAX_REDIRECTS = 5
REDIRECT_STATUSES = frozenset({301, 302, 303, 307, 308})

# 除「非全局地址」外，额外禁止的网段。
EXTRA_BLOCKED_NETWORKS: tuple[ipaddress.IPv4Network | ipaddress.IPv6Network, ...] = (
    ipaddress.ip_network("0.0.0.0/8"),
    ipaddress.ip_network("9.0.0.0/8"),
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("11.0.0.0/8"),
    ipaddress.ip_network("21.0.0.0/8"),
    ipaddress.ip_network("30.0.0.0/8"),
    ipaddress.ip_network("100.64.0.0/10"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("fe80::/10"),
    ipaddress.ip_network("fec0::/10"),
)
_NAT64 = ipaddress.ip_network("64:ff9b::/96")
_NAT64_LOCAL = ipaddress.ip_network("64:ff9b:1::/48")
_IPV4_COMPAT = ipaddress.ip_network("::/96")

BlockReason = Literal[
    "invalid_url",
    "scheme_not_allowed",
    "port_not_allowed",
    "credentials_in_url",
    "non_canonical_ip",
    "blocked_ip",
    "dns_failed",
    "too_many_redirects",
    "response_too_large",
]


class SsrfBlockedError(AppError):
    """目标地址被安全策略拒绝。message 面向用户，reason 用于日志和测试。"""

    status_code = 400
    code = "url_blocked"

    def __init__(self, reason: BlockReason, detail: str = "") -> None:
        super().__init__("该网址无法访问，请检查是否为公开的网站地址")
        self.reason: BlockReason = reason
        self.detail = detail

    def __str__(self) -> str:
        return f"{self.reason}: {self.detail}" if self.detail else self.reason


@dataclass(frozen=True)
class ParsedUrl:
    url: str
    scheme: str
    host: str  # 小写、去掉末尾点、IDN 已转 ASCII；IPv6 不带方括号
    port: int
    ip_literal: IPAddress | None


# ── IP 判断 ────────────────────────────────────────────────────────────


def _embedded_ipv4(ip: ipaddress.IPv6Address) -> ipaddress.IPv4Address | None:
    if ip.ipv4_mapped is not None:
        return ip.ipv4_mapped
    if ip.sixtofour is not None:
        return ip.sixtofour
    if ip in _NAT64 or ip in _NAT64_LOCAL:
        return ipaddress.IPv4Address(int(ip) & 0xFFFFFFFF)
    if ip in _IPV4_COMPAT and int(ip) > 1:
        return ipaddress.IPv4Address(int(ip) & 0xFFFFFFFF)
    return None


def is_blocked_ip(ip: IPAddress) -> bool:
    """True 表示禁止访问。"""
    if isinstance(ip, ipaddress.IPv6Address):
        if ip.teredo is not None:
            return True
        embedded = _embedded_ipv4(ip)
        if embedded is not None:
            return is_blocked_ip(embedded)
    if ip.is_multicast or not ip.is_global:
        return True
    return any(ip.version == net.version and ip in net for net in EXTRA_BLOCKED_NETWORKS)


def _parse_ip_literal(host: str) -> IPAddress | None:
    """严格解析 IP 字面量；非标准写法抛出 non_canonical_ip，不是 IP 时返回 None。"""
    if ":" in host:
        try:
            return ipaddress.IPv6Address(host)
        except ValueError as exc:  # pragma: no cover - urlsplit 已拒绝非法的方括号地址，这里是纵深防御
            raise SsrfBlockedError("invalid_url", host) from exc
    try:
        return ipaddress.IPv4Address(host)
    except ValueError:
        pass
    # 「看起来像数字地址」的主机名：纯数字、0x 开头的十六进制段、点分但不标准。
    # inet_aton 能解析即说明某些客户端会把它当作 IP（如 2130706433、0177.0.0.1、0x7f.1、127.1）。
    labels = host.split(".")
    numeric_like = all(label.isdigit() or label.lower().startswith("0x") for label in labels if label)
    if numeric_like:
        raise SsrfBlockedError("non_canonical_ip", host)
    try:
        socket.inet_aton(host)
    except OSError:
        return None
    raise SsrfBlockedError("non_canonical_ip", host)  # pragma: no cover - 纵深防御：上面的规则已覆盖已知写法


def _normalize_host(raw: str) -> str:
    host = raw.strip().rstrip(".").lower()
    if not host:
        raise SsrfBlockedError("invalid_url", "empty host")
    if ":" in host:
        return host
    try:
        return host.encode("idna").decode("ascii")
    except UnicodeError as exc:
        raise SsrfBlockedError("invalid_url", raw) from exc


# ── URL 校验 ───────────────────────────────────────────────────────────


def validate_url(url: str, *, allow_hosts: Iterable[str] = ()) -> ParsedUrl:
    """语法层面的校验（不做 DNS）。允许列表中的主机跳过 IP 范围检查，但协议和端口规则仍然适用。"""
    if not isinstance(url, str) or len(url) > 2048 or any(ch in url for ch in "\r\n\t\x00 "):
        raise SsrfBlockedError("invalid_url", "malformed")
    try:
        parts = urlsplit(url)
        port_value = parts.port
    except ValueError as exc:
        raise SsrfBlockedError("invalid_url", str(exc)) from exc

    scheme = parts.scheme.lower()
    if scheme not in ALLOWED_SCHEMES:
        raise SsrfBlockedError("scheme_not_allowed", scheme)
    if parts.username is not None or parts.password is not None or "@" in parts.netloc:
        raise SsrfBlockedError("credentials_in_url")
    if not parts.hostname:
        raise SsrfBlockedError("invalid_url", "missing host")

    port = port_value if port_value is not None else DEFAULT_PORTS[scheme]
    if port not in ALLOWED_PORTS:
        raise SsrfBlockedError("port_not_allowed", str(port))

    host = _normalize_host(parts.hostname)
    ip_literal = _parse_ip_literal(host)
    allowed = {h.lower().rstrip(".") for h in allow_hosts}
    if ip_literal is not None and host not in allowed and is_blocked_ip(ip_literal):
        raise SsrfBlockedError("blocked_ip", str(ip_literal))

    netloc = f"[{host}]" if ":" in host else host
    if port_value is not None:
        netloc = f"{netloc}:{port}"
    normalized = urlunsplit((scheme, netloc, parts.path or "/", parts.query, ""))
    return ParsedUrl(url=normalized, scheme=scheme, host=host, port=port, ip_literal=ip_literal)


SMTP_PORTS = frozenset({465, 587})


async def check_smtp_host(
    host: str, port: int, *, resolver: Resolver | None = None, allow_hosts: Iterable[str] = ()
) -> tuple[str, list[IPAddress]]:
    """SMTP 服务器地址校验：端口只允许 465（SMTPS）/ 587（STARTTLS），主机解析结果不得为内网地址。

    返回规范化主机名与已校验的地址（连接时固定到这些地址，防止 DNS 重绑定）。
    """
    if port not in SMTP_PORTS:
        raise SsrfBlockedError("port_not_allowed", str(port))
    if not isinstance(host, str) or len(host) > 253 or any(ch in host for ch in "/@:?#[]\r\n\t\x00 "):
        raise SsrfBlockedError("invalid_url", "malformed host")
    normalized = _normalize_host(host)
    ip_literal = _parse_ip_literal(normalized)
    allowed = {h.lower().rstrip(".") for h in allow_hosts}
    if ip_literal is not None and normalized not in allowed and is_blocked_ip(ip_literal):
        raise SsrfBlockedError("blocked_ip", str(ip_literal))
    parsed = ParsedUrl(url="", scheme="smtp", host=normalized, port=port, ip_literal=ip_literal)
    return normalized, await resolve_and_check(parsed, resolver=resolver, allow_hosts=allow_hosts)


async def system_resolver(host: str, port: int) -> list[str]:
    loop = asyncio.get_running_loop()
    infos = await loop.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    return [str(info[4][0]) for info in infos]


async def resolve_and_check(
    parsed: ParsedUrl, *, resolver: Resolver | None = None, allow_hosts: Iterable[str] = ()
) -> list[IPAddress]:
    """解析全部地址；任一地址被禁止即拒绝。返回去重后的地址列表（保持解析顺序）。"""
    if parsed.ip_literal is not None:
        return [parsed.ip_literal]
    try:
        raw = await (resolver or system_resolver)(parsed.host, parsed.port)
    except (OSError, UnicodeError) as exc:
        raise SsrfBlockedError("dns_failed", parsed.host) from exc
    addresses: list[IPAddress] = []
    for item in raw:
        try:
            ip = ipaddress.ip_address(item.split("%", 1)[0])
        except ValueError as exc:
            raise SsrfBlockedError("dns_failed", item) from exc
        if ip not in addresses:
            addresses.append(ip)
    if not addresses:
        raise SsrfBlockedError("dns_failed", parsed.host)
    allowed = {h.lower().rstrip(".") for h in allow_hosts}
    if parsed.host not in allowed:
        for ip in addresses:
            if is_blocked_ip(ip):
                raise SsrfBlockedError("blocked_ip", f"{parsed.host} -> {ip}")
    return addresses


# ── 固定 IP 的连接层 ───────────────────────────────────────────────────


class PinnedNetworkBackend(httpcore.AsyncNetworkBackend):
    """只允许连接到已校验的「主机名 → IP」映射。TLS SNI 仍使用原主机名（由 httpcore 处理）。"""

    def __init__(self, pins: Mapping[str, str], inner: httpcore.AsyncNetworkBackend | None = None) -> None:
        self._pins = pins
        self._inner = inner or httpcore.AnyIOBackend()

    async def connect_tcp(
        self,
        host: str,
        port: int,
        timeout: float | None = None,
        local_address: str | None = None,
        socket_options: Iterable[object] | None = None,
    ) -> httpcore.AsyncNetworkStream:
        pinned = self._pins.get(host.lower())
        if pinned is None:
            raise httpcore.ConnectError(f"host not pinned: {host}")
        return await self._inner.connect_tcp(
            pinned, port, timeout=timeout, local_address=local_address, socket_options=socket_options
        )  # type: ignore[arg-type]

    async def connect_unix_socket(
        self, path: str, timeout: float | None = None, socket_options: Iterable[object] | None = None
    ) -> httpcore.AsyncNetworkStream:
        raise httpcore.ConnectError("unix sockets are not allowed")

    async def sleep(self, seconds: float) -> None:
        await self._inner.sleep(seconds)


class PinnedTransport(httpx.AsyncHTTPTransport):
    def __init__(
        self,
        pins: Mapping[str, str],
        *,
        inner_backend: httpcore.AsyncNetworkBackend | None = None,
        ssl_context: ssl.SSLContext | None = None,
    ) -> None:
        super().__init__(trust_env=False)
        self._pool = httpcore.AsyncConnectionPool(
            ssl_context=ssl_context or httpx.create_ssl_context(trust_env=False),
            max_connections=10,
            max_keepalive_connections=5,
            keepalive_expiry=5.0,
            network_backend=PinnedNetworkBackend(pins, inner_backend),
        )


# ── safe_fetch ─────────────────────────────────────────────────────────


@dataclass
class FetchResult:
    url: str  # 最终地址（跟随跳转后）
    status_code: int
    headers: httpx.Headers
    content: bytes
    redirects: list[str] = field(default_factory=list)

    @property
    def text(self) -> str:
        return httpx.Response(self.status_code, headers=self.headers, content=self.content).text


_SENSITIVE_HEADERS = ("authorization", "cookie", "proxy-authorization")
DEFAULT_USER_AGENT = "Mozilla/5.0 (compatible; AICMO-Bot/0.1; +https://aicmo.site/bot)"


async def safe_fetch(
    url: str,
    *,
    method: str = "GET",
    headers: Mapping[str, str] | None = None,
    content: bytes | None = None,
    timeout: float = 15.0,
    max_redirects: int = MAX_REDIRECTS,
    max_bytes: int = 5 * 1024 * 1024,
    resolver: Resolver | None = None,
    allow_hosts: Iterable[str] | None = None,
    inner_backend: httpcore.AsyncNetworkBackend | None = None,
) -> FetchResult:
    """安全地发起 HTTP 请求。任何一跳不符合策略都抛出 SsrfBlockedError。"""
    if allow_hosts is None:
        from app.core.config import get_settings

        allow_hosts = get_settings().ssrf_allow_hosts
    allow = tuple(allow_hosts)
    pins: dict[str, str] = {}
    request_headers = {"User-Agent": DEFAULT_USER_AGENT, **(headers or {})}
    redirects: list[str] = []
    current_url, current_method, body = url, method.upper(), content
    previous_host: str | None = None

    transport = PinnedTransport(pins, inner_backend=inner_backend)
    async with httpx.AsyncClient(
        transport=transport, follow_redirects=False, timeout=timeout, trust_env=False
    ) as client:
        while True:
            parsed = validate_url(current_url, allow_hosts=allow)
            addresses = await resolve_and_check(parsed, resolver=resolver, allow_hosts=allow)
            pins[parsed.host] = str(addresses[0])
            if previous_host is not None and previous_host != parsed.host:
                # 跨主机跳转时不转发凭据。
                request_headers = {k: v for k, v in request_headers.items() if k.lower() not in _SENSITIVE_HEADERS}
            previous_host = parsed.host

            request = client.build_request(current_method, parsed.url, headers=request_headers, content=body)
            response = await client.send(request, stream=True)
            try:
                location = response.headers.get("location")
                if response.status_code in REDIRECT_STATUSES and location:
                    if len(redirects) >= max_redirects:
                        raise SsrfBlockedError("too_many_redirects", str(max_redirects))
                    next_url = urljoin(parsed.url, location)
                    redirects.append(next_url)
                    if response.status_code == 303 or (response.status_code in (301, 302) and current_method == "POST"):
                        current_method, body = "GET", None
                    current_url = next_url
                    continue

                chunks: list[bytes] = []
                total = 0
                async for chunk in response.aiter_bytes():
                    total += len(chunk)
                    if total > max_bytes:
                        raise SsrfBlockedError("response_too_large", str(max_bytes))
                    chunks.append(chunk)
                return FetchResult(
                    url=parsed.url,
                    status_code=response.status_code,
                    headers=response.headers,
                    content=b"".join(chunks),
                    redirects=redirects,
                )
            finally:
                await response.aclose()
