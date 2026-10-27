"""SSRF 防护测试：地址范围、各种 IP 写法、DNS 多记录、跳转、IP 固定、SNI。"""

from __future__ import annotations

import ipaddress
import socket

import httpcore
import pytest

from app.core.security import ssrf
from app.core.security.ssrf import (
    PinnedNetworkBackend,
    SsrfBlockedError,
    is_blocked_ip,
    resolve_and_check,
    safe_fetch,
    validate_url,
)

PUBLIC_V4 = "93.184.216.34"
PUBLIC_V6 = "2606:2800:220:1:248:1893:25c8:1946"


# ── 地址范围 ──────────────────────────────────────────────────────────

BLOCKED_IPS = [
    # 回环
    "127.0.0.1",
    "127.255.255.254",
    "::1",
    # 未指定 / 本网络
    "0.0.0.0",
    "0.1.2.3",
    "::",
    # 私有
    "10.0.0.1",
    "10.255.255.255",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.0.1",
    "192.168.255.255",
    # 链路本地（含云元数据）
    "169.254.169.254",
    "169.254.0.1",
    # CGNAT
    "100.64.0.1",
    "100.127.255.254",
    # 组播 / 广播 / 保留
    "224.0.0.1",
    "239.255.255.250",
    "255.255.255.255",
    "240.0.0.1",
    # 文档、基准测试、IETF 协议分配
    "192.0.2.1",
    "198.51.100.1",
    "203.0.113.1",
    "198.18.0.1",
    "192.0.0.1",
    # 额外禁止的网段
    "9.0.0.1",
    "9.255.255.255",
    "11.1.1.1",
    "21.0.0.1",
    "30.30.30.30",
    # IPv6 ULA / 链路本地 / 站点本地 / 组播 / 文档
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "febf::1",
    "fec0::1",
    "ff02::1",
    "2001:db8::1",
    # 内嵌 IPv4 的 IPv6
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "::ffff:169.254.169.254",
    "::ffff:9.9.9.9",
    "64:ff9b::a00:1",
    "64:ff9b::7f00:1",
    "2002:7f00:1::1",
    "2002:a00:1::1",
    "::127.0.0.1",
    # Teredo
    "2001:0:4136:e378:8000:63bf:3fff:fdd2",
]

ALLOWED_IPS = [
    PUBLIC_V4,
    "8.8.8.8",
    "1.1.1.1",
    "12.0.0.1",
    "20.255.255.255",
    "22.0.0.1",
    "29.255.255.255",
    "31.0.0.1",
    "100.63.255.255",
    "100.128.0.1",
    "172.15.255.255",
    "172.32.0.1",
    "192.167.1.1",
    PUBLIC_V6,
    "2001:4860:4860::8888",
    "::ffff:8.8.8.8",
    "64:ff9b::808:808",
    "2002:808:808::1",
]


@pytest.mark.parametrize("address", BLOCKED_IPS)
def test_blocked_ranges(address: str) -> None:
    assert is_blocked_ip(ipaddress.ip_address(address)) is True


@pytest.mark.parametrize("address", ALLOWED_IPS)
def test_public_addresses_allowed(address: str) -> None:
    assert is_blocked_ip(ipaddress.ip_address(address)) is False


# ── URL 语法校验 ───────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/",
        "http://10.0.0.1/admin",
        "https://169.254.169.254/latest/meta-data/",
        "http://[::1]/",
        "http://[::ffff:127.0.0.1]/",
        "http://[::ffff:7f00:1]/",
        "http://[fd00::1]/",
        "http://[fe80::1]/",
        "http://9.1.2.3/",
        "http://0.0.0.0/",
    ],
)
def test_blocked_ip_literals(url: str) -> None:
    with pytest.raises(SsrfBlockedError) as exc:
        validate_url(url)
    assert exc.value.reason == "blocked_ip"


@pytest.mark.parametrize(
    "url",
    [
        "http://2130706433/",  # 十进制整数 = 127.0.0.1
        "http://3232235521/",  # 十进制整数 = 192.168.0.1
        "http://0177.0.0.1/",  # 八进制
        "http://017700000001/",  # 八进制整数
        "http://0x7f000001/",  # 十六进制整数
        "http://0x7f.0x0.0x0.0x1/",  # 十六进制分段
        "http://0x7f.1/",  # 混合缩写
        "http://127.1/",  # 缩写
        "http://127.0.1/",
        "http://10.1/",
        "http://08.8.8.8/",  # 前导零
        "http://1.2.3.04/",
        "http://134744072/",  # 十进制整数 = 8.8.8.8：即使是公网也拒绝非标准写法
    ],
)
def test_non_canonical_ip_forms_rejected(url: str) -> None:
    with pytest.raises(SsrfBlockedError) as exc:
        validate_url(url)
    assert exc.value.reason == "non_canonical_ip"


@pytest.mark.parametrize(
    ("url", "reason"),
    [
        ("ftp://example.com/", "scheme_not_allowed"),
        ("file:///etc/passwd", "scheme_not_allowed"),
        ("gopher://example.com/", "scheme_not_allowed"),
        ("javascript:alert(1)", "scheme_not_allowed"),
        ("data:text/html,hi", "scheme_not_allowed"),
        ("//example.com/", "scheme_not_allowed"),
        ("http://example.com:8080/", "port_not_allowed"),
        ("https://example.com:22/", "port_not_allowed"),
        ("http://example.com:0/", "port_not_allowed"),
        ("http://example.com:99999/", "invalid_url"),
        ("http://user:pass@example.com/", "credentials_in_url"),
        ("http://user@example.com/", "credentials_in_url"),
        ("http://example.com@127.0.0.1/", "credentials_in_url"),
        ("http:///nohost", "invalid_url"),
        ("http://./", "invalid_url"),
        ("http://exa mple.com/", "invalid_url"),
        ("http://example.com/\r\nHost: evil", "invalid_url"),
        ("http://[::1/", "invalid_url"),
        ("http://" + "a" * 3000 + ".com/", "invalid_url"),
    ],
)
def test_invalid_urls(url: str, reason: str) -> None:
    with pytest.raises(SsrfBlockedError) as exc:
        validate_url(url)
    assert exc.value.reason == reason


def test_non_string_rejected() -> None:
    with pytest.raises(SsrfBlockedError):
        validate_url(None)  # type: ignore[arg-type]


def test_valid_urls_are_normalized() -> None:
    parsed = validate_url("HTTPS://Example.COM./Path?q=1#frag")
    assert parsed.scheme == "https"
    assert parsed.host == "example.com"
    assert parsed.port == 443
    assert parsed.url == "https://example.com/Path?q=1"
    assert parsed.ip_literal is None

    assert validate_url("http://example.com:443/").port == 443
    assert validate_url("https://example.com:80").url == "https://example.com:80/"
    assert validate_url(f"http://{PUBLIC_V4}/").ip_literal == ipaddress.ip_address(PUBLIC_V4)
    assert validate_url(f"http://[{PUBLIC_V6}]/").url == f"http://[{PUBLIC_V6}]/"


def test_idn_host_converted_to_ascii() -> None:
    assert validate_url("http://bücher.example/").host == "xn--bcher-kva.example"


def test_invalid_idn_rejected() -> None:
    with pytest.raises(SsrfBlockedError) as exc:
        validate_url("http://" + "ü" * 70 + ".example/")
    assert exc.value.reason == "invalid_url"


def test_allow_list_skips_ip_check_but_not_port_rules() -> None:
    assert validate_url("http://127.0.0.1/", allow_hosts=["127.0.0.1"]).host == "127.0.0.1"
    with pytest.raises(SsrfBlockedError):
        validate_url("http://127.0.0.1:8080/", allow_hosts=["127.0.0.1"])


def test_error_message_is_user_facing() -> None:
    with pytest.raises(SsrfBlockedError) as exc:
        validate_url("http://127.0.0.1/")
    assert exc.value.status_code == 400
    assert exc.value.code == "url_blocked"
    assert "127.0.0.1" not in exc.value.message
    assert str(exc.value).startswith("blocked_ip")


# ── DNS 解析 ───────────────────────────────────────────────────────────


def resolver_for(mapping: dict[str, list[str]]):
    async def _resolve(host: str, port: int) -> list[str]:
        if host not in mapping:
            raise socket.gaierror(socket.EAI_NONAME, "not found")
        return mapping[host]

    return _resolve


async def test_resolve_all_records_public() -> None:
    parsed = validate_url("https://example.com/")
    result = await resolve_and_check(
        parsed, resolver=resolver_for({"example.com": [PUBLIC_V4, PUBLIC_V6, PUBLIC_V4]})
    )
    assert [str(ip) for ip in result] == [PUBLIC_V4, PUBLIC_V6]


@pytest.mark.parametrize(
    "records",
    [
        [PUBLIC_V4, "127.0.0.1"],
        ["10.0.0.5"],
        [PUBLIC_V6, "fd00::1"],
        ["::ffff:192.168.1.1"],
        [PUBLIC_V4, "169.254.169.254"],
        ["fe80::1%eth0"],
    ],
)
async def test_any_blocked_record_rejects(records: list[str]) -> None:
    parsed = validate_url("https://rebind.example/")
    with pytest.raises(SsrfBlockedError) as exc:
        await resolve_and_check(parsed, resolver=resolver_for({"rebind.example": records}))
    assert exc.value.reason == "blocked_ip"


@pytest.mark.parametrize("records", [[], ["not-an-ip"]])
async def test_bad_dns_answers(records: list[str]) -> None:
    parsed = validate_url("https://weird.example/")
    with pytest.raises(SsrfBlockedError) as exc:
        await resolve_and_check(parsed, resolver=resolver_for({"weird.example": records}))
    assert exc.value.reason == "dns_failed"


async def test_dns_failure() -> None:
    parsed = validate_url("https://missing.example/")
    with pytest.raises(SsrfBlockedError) as exc:
        await resolve_and_check(parsed, resolver=resolver_for({}))
    assert exc.value.reason == "dns_failed"


async def test_ip_literal_skips_dns() -> None:
    async def _boom(host: str, port: int) -> list[str]:
        raise AssertionError("should not resolve")

    result = await resolve_and_check(validate_url(f"http://{PUBLIC_V4}/"), resolver=_boom)
    assert [str(ip) for ip in result] == [PUBLIC_V4]


async def test_allow_list_skips_resolved_ip_check() -> None:
    parsed = validate_url("http://internal.example/", allow_hosts=["internal.example"])
    result = await resolve_and_check(
        parsed, resolver=resolver_for({"internal.example": ["10.0.0.1"]}), allow_hosts=["internal.example"]
    )
    assert [str(ip) for ip in result] == ["10.0.0.1"]


async def test_system_resolver_localhost() -> None:
    addresses = await ssrf.system_resolver("localhost", 80)
    assert addresses
    with pytest.raises(SsrfBlockedError) as exc:
        await resolve_and_check(validate_url("http://localhost/"))
    assert exc.value.reason == "blocked_ip"


# ── safe_fetch：用内存网络后端模拟服务器 ───────────────────────────────


class RecordingStream(httpcore.AsyncMockStream):
    def __init__(self, buffer: list[bytes], log: list[tuple[str, object]]) -> None:
        super().__init__(buffer)
        self._log = log

    async def start_tls(self, ssl_context, server_hostname=None, timeout=None):  # type: ignore[override]
        self._log.append(("sni", server_hostname))
        return self


class FakeServers(httpcore.AsyncNetworkBackend):
    """按「连接到的 IP」返回预设的 HTTP 响应字节。记录每次连接的目标 IP 与 SNI。"""

    def __init__(self, responses: dict[str, list[bytes]]) -> None:
        self.responses = {ip: list(chunks) for ip, chunks in responses.items()}
        self.log: list[tuple[str, object]] = []

    async def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
        self.log.append(("connect", f"{host}:{port}"))
        queue = self.responses.get(host)
        if not queue:
            raise httpcore.ConnectError(f"no server at {host}")
        return RecordingStream([queue.pop(0)], self.log)

    async def sleep(self, seconds: float) -> None:
        return None


def http_response(status: int, body: bytes = b"", headers: dict[str, str] | None = None) -> bytes:
    lines = [f"HTTP/1.1 {status} X".encode()]
    merged = {"Content-Length": str(len(body)), "Connection": "close", **(headers or {})}
    lines += [f"{k}: {v}".encode() for k, v in merged.items()]
    return b"\r\n".join(lines) + b"\r\n\r\n" + body


async def test_safe_fetch_pins_resolved_ip_and_keeps_host_header() -> None:
    servers = FakeServers({PUBLIC_V4: [http_response(200, b"hello")]})
    result = await safe_fetch(
        "http://example.com/page",
        resolver=resolver_for({"example.com": [PUBLIC_V4]}),
        inner_backend=servers,
        allow_hosts=[],
    )
    assert result.status_code == 200
    assert result.content == b"hello"
    assert result.text == "hello"
    assert result.url == "http://example.com/page"
    assert result.redirects == []
    assert servers.log == [("connect", f"{PUBLIC_V4}:80")]


async def test_safe_fetch_https_uses_original_host_for_sni() -> None:
    servers = FakeServers({PUBLIC_V4: [http_response(200, b"secure")]})
    result = await safe_fetch(
        "https://example.com/",
        resolver=resolver_for({"example.com": [PUBLIC_V4]}),
        inner_backend=servers,
        allow_hosts=[],
    )
    assert result.content == b"secure"
    assert ("connect", f"{PUBLIC_V4}:443") in servers.log
    assert ("sni", "example.com") in servers.log


async def test_safe_fetch_rejects_before_connecting() -> None:
    servers = FakeServers({})
    with pytest.raises(SsrfBlockedError) as exc:
        await safe_fetch(
            "http://evil.example/",
            resolver=resolver_for({"evil.example": ["127.0.0.1"]}),
            inner_backend=servers,
            allow_hosts=[],
        )
    assert exc.value.reason == "blocked_ip"
    assert servers.log == []


async def test_redirect_to_internal_address_blocked() -> None:
    servers = FakeServers(
        {PUBLIC_V4: [http_response(302, headers={"Location": "http://169.254.169.254/latest/meta-data/"})]}
    )
    with pytest.raises(SsrfBlockedError) as exc:
        await safe_fetch(
            "http://example.com/",
            resolver=resolver_for({"example.com": [PUBLIC_V4]}),
            inner_backend=servers,
            allow_hosts=[],
        )
    assert exc.value.reason == "blocked_ip"
    assert servers.log == [("connect", f"{PUBLIC_V4}:80")]


async def test_redirect_to_host_resolving_internal_blocked() -> None:
    servers = FakeServers(
        {PUBLIC_V4: [http_response(301, headers={"Location": "https://intranet.example/"})]}
    )
    with pytest.raises(SsrfBlockedError) as exc:
        await safe_fetch(
            "http://example.com/",
            resolver=resolver_for({"example.com": [PUBLIC_V4], "intranet.example": ["10.1.2.3"]}),
            inner_backend=servers,
            allow_hosts=[],
        )
    assert exc.value.reason == "blocked_ip"


@pytest.mark.parametrize(
    "location",
    ["file:///etc/passwd", "gopher://example.com/", "http://example.com:6379/", "http://2130706433/"],
)
async def test_redirect_to_disallowed_target(location: str) -> None:
    servers = FakeServers({PUBLIC_V4: [http_response(302, headers={"Location": location})]})
    with pytest.raises(SsrfBlockedError):
        await safe_fetch(
            "http://example.com/",
            resolver=resolver_for({"example.com": [PUBLIC_V4]}),
            inner_backend=servers,
            allow_hosts=[],
        )


async def test_follows_public_redirects_and_strips_credentials_cross_host() -> None:
    other = "8.8.4.4"
    servers = FakeServers(
        {
            PUBLIC_V4: [
                http_response(302, headers={"Location": "/step2"}),
                http_response(303, headers={"Location": "https://other.example/final"}),
            ],
            other: [http_response(200, b"done")],
        }
    )
    result = await safe_fetch(
        "http://example.com/start",
        method="POST",
        content=b"x=1",
        headers={"Authorization": "Bearer secret"},
        resolver=resolver_for({"example.com": [PUBLIC_V4], "other.example": [other]}),
        inner_backend=servers,
        allow_hosts=[],
    )
    assert result.status_code == 200
    assert result.url == "https://other.example/final"
    assert result.redirects == ["http://example.com/step2", "https://other.example/final"]
    assert ("sni", "other.example") in servers.log


async def test_too_many_redirects() -> None:
    loop = [http_response(302, headers={"Location": "/again"}) for _ in range(10)]
    servers = FakeServers({PUBLIC_V4: loop})
    with pytest.raises(SsrfBlockedError) as exc:
        await safe_fetch(
            "http://example.com/",
            resolver=resolver_for({"example.com": [PUBLIC_V4]}),
            inner_backend=servers,
            max_redirects=5,
            allow_hosts=[],
        )
    assert exc.value.reason == "too_many_redirects"
    assert len([entry for entry in servers.log if entry[0] == "connect"]) == 6


async def test_response_size_limit() -> None:
    servers = FakeServers({PUBLIC_V4: [http_response(200, b"x" * 2048)]})
    with pytest.raises(SsrfBlockedError) as exc:
        await safe_fetch(
            "http://example.com/",
            resolver=resolver_for({"example.com": [PUBLIC_V4]}),
            inner_backend=servers,
            max_bytes=1024,
            allow_hosts=[],
        )
    assert exc.value.reason == "response_too_large"


async def test_default_allow_hosts_come_from_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "ssrf_allow_hosts", ["internal.example"])
    servers = FakeServers({"10.0.0.9": [http_response(200, b"ok")]})
    result = await safe_fetch(
        "http://internal.example/",
        resolver=resolver_for({"internal.example": ["10.0.0.9"]}),
        inner_backend=servers,
    )
    assert result.content == b"ok"


async def test_pinned_backend_refuses_unpinned_hosts_and_unix_sockets() -> None:
    backend = PinnedNetworkBackend({"example.com": PUBLIC_V4}, FakeServers({}))
    with pytest.raises(httpcore.ConnectError):
        await backend.connect_tcp("other.example", 80)
    with pytest.raises(httpcore.ConnectError):
        await backend.connect_unix_socket("/var/run/docker.sock")
    await backend.sleep(0)
