"""真实 SMTP 发送实现（SmtpMailer）的测试：进程内最小 SMTP 服务器 + 自签证书。

验证：连接固定到已校验的 IP（不按主机名重新解析）、TLS 证书按原主机名校验、587 必须 STARTTLS、
465 直接 TLS、认证失败 / 收件人被拒 / 内网地址的错误码，以及错误信息中不包含凭据。
"""

from __future__ import annotations

import base64
import datetime as dt
import socket
import ssl
import threading
from collections.abc import Iterator
from dataclasses import dataclass, field

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID

from app.services import mailer as mailer_mod
from app.services.mailer import MailSendError, OutgoingMail, SmtpCredentials, SmtpMailer

HOST = "smtp.mail.example"
PUBLIC_IP = "93.184.216.34"
PASSWORD = "S3cret-app-password"


def make_cert(tmp_path, name: str) -> tuple[str, str]:
    key = ec.generate_private_key(ec.SECP256R1())
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, name)])
    now = dt.datetime.now(dt.UTC)
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(days=1))
        .not_valid_after(now + dt.timedelta(days=1))
        .add_extension(x509.SubjectAlternativeName([x509.DNSName(name)]), critical=False)
        .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
        .sign(key, hashes.SHA256())
    )
    cert_path, key_path = tmp_path / f"{name}.crt", tmp_path / f"{name}.key"
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    key_path.write_bytes(
        key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    )
    return str(cert_path), str(key_path)


@dataclass
class SmtpServer:
    """单连接串行处理的最小 SMTP 服务器。mode：starttls / implicit / plain（不支持 STARTTLS）。"""

    context: ssl.SSLContext
    mode: str = "starttls"
    received: list[dict[str, object]] = field(default_factory=list)
    auth_seen: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.sock = socket.socket()
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(5)
        self.port = self.sock.getsockname()[1]
        self.thread = threading.Thread(target=self._serve, daemon=True)
        self.thread.start()

    def _serve(self) -> None:
        while True:
            try:
                conn, _ = self.sock.accept()
            except OSError:
                return
            try:
                self._handle(conn)
            except (OSError, ssl.SSLError):
                pass
            finally:
                conn.close()

    def _handle(self, conn: socket.socket) -> None:
        if self.mode == "implicit":
            conn = self.context.wrap_socket(conn, server_side=True)
        f = conn.makefile("rb")
        tls = self.mode == "implicit"

        def say(line: str) -> None:
            conn.sendall(line.encode() + b"\r\n")

        say("220 test ESMTP")
        mail: dict[str, object] = {"rcpt": []}
        while True:
            raw = f.readline()
            if not raw:
                return
            line = raw.decode().rstrip("\r\n")
            cmd = line.upper()
            if cmd.startswith("EHLO"):
                if self.mode == "starttls" and not tls:
                    say("250-test\r\n250-STARTTLS\r\n250 SIZE 1000000")
                else:
                    say("250-test\r\n250 AUTH PLAIN")
            elif cmd == "STARTTLS":
                say("220 go ahead")
                conn = self.context.wrap_socket(conn, server_side=True)
                f = conn.makefile("rb")
                tls = True
            elif cmd.startswith("AUTH PLAIN"):
                payload = line.split(" ", 2)[2] if line.count(" ") >= 2 else ""
                _, user, password = base64.b64decode(payload).decode().split("\x00")
                self.auth_seen.append(user)
                say("235 ok" if password == PASSWORD else "535 bad credentials")
            elif cmd.startswith("MAIL FROM"):
                mail = {"from": line, "rcpt": []}
                say("250 ok")
            elif cmd.startswith("RCPT TO"):
                if "reject@" in line.lower():
                    say("550 no such user")
                else:
                    mail["rcpt"].append(line)  # type: ignore[union-attr]
                    say("250 ok")
            elif cmd == "DATA":
                say("354 end with .")
                body = b""
                while not body.endswith(b"\r\n.\r\n"):
                    chunk = f.readline()
                    if not chunk:
                        return
                    body += chunk
                mail["data"] = body.decode()
                mail["tls"] = tls
                self.received.append(mail)
                say("250 queued")
            elif cmd in ("RSET", "NOOP"):
                say("250 ok")
            elif cmd == "QUIT":
                say("221 bye")
                return
            else:
                say("500 unknown")

    def close(self) -> None:
        self.sock.close()


@pytest.fixture
def tls_env(tmp_path, monkeypatch) -> Iterator[dict[str, object]]:
    """服务端证书签给 HOST；客户端信任该证书。所有连接被重定向到测试服务器，并记录客户端实际连接的地址。"""
    cert, key = make_cert(tmp_path, HOST)
    server_ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    server_ctx.load_cert_chain(cert, key)
    client_ctx = ssl.create_default_context(cafile=cert)
    monkeypatch.setattr(mailer_mod.ssl, "create_default_context", lambda: client_ctx)

    state: dict[str, object] = {"connected": [], "server": None, "server_ctx": server_ctx, "tmp": tmp_path}
    real_create = socket.create_connection

    def redirect(address, timeout=None, *args, **kwargs):  # type: ignore[no-untyped-def]
        state["connected"].append(address)  # type: ignore[union-attr]
        server: SmtpServer = state["server"]  # type: ignore[assignment]
        return real_create(("127.0.0.1", server.port), timeout)

    monkeypatch.setattr(mailer_mod.socket, "create_connection", redirect)

    original_check = mailer_mod.check_smtp_host

    async def check(host, port, *, allow_hosts=()):  # type: ignore[no-untyped-def]
        async def resolver(name: str, p: int) -> list[str]:
            return {"smtp.mail.example": [PUBLIC_IP], "smtp.wrong-cert.example": [PUBLIC_IP]}.get(name, ["10.0.0.8"])

        return await original_check(host, port, resolver=resolver, allow_hosts=allow_hosts)

    monkeypatch.setattr(mailer_mod, "check_smtp_host", check)
    yield state
    if state["server"] is not None:
        state["server"].close()  # type: ignore[union-attr]


def start(state: dict[str, object], mode: str) -> SmtpServer:
    server = SmtpServer(context=state["server_ctx"], mode=mode)  # type: ignore[arg-type]
    state["server"] = server
    return server


def mail(to: str = "buyer@b.example") -> OutgoingMail:
    return OutgoingMail(
        from_address="sales@a.example",
        from_name="A",
        to=to,
        subject="Ball valves",
        body="Hello",
        unsubscribe_url="https://app.example/u",
    )


def creds(port: int = 587, host: str = HOST, password: str = PASSWORD) -> SmtpCredentials:
    return SmtpCredentials(host=host, port=port, username="sales@a.example", password=password)


async def test_starttls_send_pins_ip(tls_env) -> None:
    server = start(tls_env, "starttls")
    message_id = await SmtpMailer().send(creds(587), mail())
    assert message_id.endswith("@a.example>")
    assert tls_env["connected"] == [(PUBLIC_IP, 587)]  # 连接的是已校验的 IP，不是主机名
    received = server.received[0]
    assert received["tls"] is True
    assert "List-Unsubscribe" in str(received["data"]) and "Subject: Ball valves" in str(received["data"])
    assert server.auth_seen == ["sales@a.example"]


async def test_implicit_tls_465_verify(tls_env) -> None:
    start(tls_env, "implicit")
    await SmtpMailer().verify(creds(465))
    assert tls_env["connected"] == [(PUBLIC_IP, 465)]


async def test_starttls_required(tls_env) -> None:
    start(tls_env, "plain")
    with pytest.raises(MailSendError) as exc:
        await SmtpMailer().verify(creds(587))
    assert exc.value.code == "tls_required"


async def test_certificate_must_match_hostname(tls_env) -> None:
    start(tls_env, "starttls")
    with pytest.raises(MailSendError) as exc:
        await SmtpMailer().verify(creds(587, host="smtp.wrong-cert.example"))
    assert exc.value.code == "connect_failed"


async def test_auth_failure_and_rejected_recipient(tls_env) -> None:
    start(tls_env, "starttls")
    with pytest.raises(MailSendError) as exc:
        await SmtpMailer().verify(creds(587, password="nope"))
    assert exc.value.code == "auth_failed" and "nope" not in str(exc.value) and PASSWORD not in str(exc.value)
    with pytest.raises(MailSendError) as exc:
        await SmtpMailer().send(creds(587), mail(to="reject@b.example"))
    assert exc.value.code == "rejected"


async def test_internal_host_never_connected(tls_env) -> None:
    start(tls_env, "starttls")
    for host in ("smtp.internal.example", "127.0.0.1"):
        with pytest.raises(MailSendError) as exc:
            await SmtpMailer().send(creds(587, host=host), mail())
        assert exc.value.code == "blocked_host"
    with pytest.raises(MailSendError) as exc:
        await SmtpMailer().verify(creds(25))
    assert exc.value.code == "blocked_host"
    assert tls_env["connected"] == []


async def test_connection_refused(tls_env, monkeypatch) -> None:
    def refuse(address, timeout=None, *args, **kwargs):  # type: ignore[no-untyped-def]
        raise ConnectionRefusedError

    monkeypatch.setattr(mailer_mod.socket, "create_connection", refuse)
    with pytest.raises(MailSendError) as exc:
        await SmtpMailer().verify(creds(465))
    assert exc.value.code == "connect_failed"


def test_credentials_repr_hides_password() -> None:
    assert PASSWORD not in repr(creds())
