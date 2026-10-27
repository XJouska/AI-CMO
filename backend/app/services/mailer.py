"""邮件发送接口：SMTP 真实实现 + 假实现（测试与 TEST_MODE）。

安全要点：
- SMTP 服务器地址经过 check_smtp_host（端口 465/587、解析结果不得为内网），连接固定到已校验的 IP，
  TLS 证书仍按原主机名校验（防 DNS 重绑定，同时不降低 TLS 安全性）
- 只允许加密连接：465 直接 TLS；587 必须 STARTTLS 成功
- 凭据只在本模块内以明文存在，异常信息中不包含凭据
"""

from __future__ import annotations

import asyncio
import contextlib
import smtplib
import socket
import ssl
from dataclasses import dataclass, field
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from typing import Protocol

from app.core.config import get_settings
from app.core.security.ssrf import SsrfBlockedError, check_smtp_host

SMTP_TIMEOUT = 20


@dataclass
class SmtpCredentials:
    host: str
    port: int
    username: str
    password: str = field(repr=False)


@dataclass
class OutgoingMail:
    from_address: str
    from_name: str
    to: str
    subject: str
    body: str
    unsubscribe_url: str
    reply_to: str = ""


class MailSendError(Exception):
    """发送失败。code：auth_failed / connect_failed / tls_required / rejected / blocked_host"""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class Mailer(Protocol):
    async def verify(self, creds: SmtpCredentials) -> None: ...

    async def send(self, creds: SmtpCredentials, mail: OutgoingMail) -> str: ...


def build_message(mail: OutgoingMail) -> EmailMessage:
    msg = EmailMessage()
    msg["From"] = formataddr((mail.from_name, mail.from_address)) if mail.from_name else mail.from_address
    msg["To"] = mail.to
    msg["Subject"] = mail.subject
    msg["Message-ID"] = make_msgid(domain=mail.from_address.rsplit("@", 1)[-1])
    if mail.reply_to:
        msg["Reply-To"] = mail.reply_to
    # RFC 8058 一键退订
    msg["List-Unsubscribe"] = f"<{mail.unsubscribe_url}>"
    msg["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
    msg.set_content(f"{mail.body}\n\n--\nUnsubscribe: {mail.unsubscribe_url}\n")
    return msg


class _PinnedSMTP(smtplib.SMTP):
    """连接到已校验的 IP；STARTTLS 用原主机名（_host）做 SNI 与证书校验。"""

    def __init__(self, ip: str, **kwargs: object) -> None:
        self._pinned_ip = ip
        super().__init__(**kwargs)  # type: ignore[arg-type]

    def _get_socket(self, host: str, port: int, timeout: float) -> socket.socket:
        # smtplib 默认在 _get_socket 中记录 _host，STARTTLS 依赖它
        self._host = host
        return socket.create_connection((self._pinned_ip, port), timeout)


class _PinnedSMTPSSL(smtplib.SMTP_SSL):
    def __init__(self, ip: str, **kwargs: object) -> None:
        self._pinned_ip = ip
        super().__init__(**kwargs)  # type: ignore[arg-type]

    def _get_socket(self, host: str, port: int, timeout: float) -> socket.socket:
        raw = socket.create_connection((self._pinned_ip, port), timeout)
        return self.context.wrap_socket(raw, server_hostname=host)


class SmtpMailer:
    async def _resolve(self, creds: SmtpCredentials) -> tuple[str, str]:
        try:
            host, addresses = await check_smtp_host(creds.host, creds.port, allow_hosts=get_settings().ssrf_allow_hosts)
        except SsrfBlockedError as exc:
            raise MailSendError("blocked_host", "邮件服务器地址不可用（不允许内网地址，端口只支持 465 / 587）") from exc
        return host, str(addresses[0])

    def _open(self, host: str, ip: str, creds: SmtpCredentials) -> smtplib.SMTP:
        context = ssl.create_default_context()
        client: smtplib.SMTP | None = None
        try:
            if creds.port == 465:
                client = _PinnedSMTPSSL(ip, timeout=SMTP_TIMEOUT, context=context)
                client.connect(host, creds.port)
                client.ehlo()
            else:
                client = _PinnedSMTP(ip, timeout=SMTP_TIMEOUT)
                client.connect(host, creds.port)
                client.ehlo()
                if not client.has_extn("starttls"):
                    raise MailSendError("tls_required", "邮件服务器不支持加密连接（STARTTLS）")
                client.starttls(context=context)
                client.ehlo()
            client.login(creds.username, creds.password)
            return client
        except Exception as exc:
            # 失败时释放连接（否则连接一直占用到超时）
            if client is not None:
                with contextlib.suppress(OSError, smtplib.SMTPException):
                    client.close()
            if isinstance(exc, MailSendError):
                raise
            if isinstance(exc, smtplib.SMTPAuthenticationError):
                raise MailSendError("auth_failed", "邮箱账号或授权码不正确") from exc
            if isinstance(exc, OSError | smtplib.SMTPException):
                raise MailSendError("connect_failed", f"无法连接邮件服务器：{type(exc).__name__}") from exc
            raise

    async def verify(self, creds: SmtpCredentials) -> None:
        host, ip = await self._resolve(creds)

        def run() -> None:
            client = self._open(host, ip, creds)
            with contextlib.suppress(OSError, smtplib.SMTPException):
                client.quit()

        await asyncio.to_thread(run)

    async def send(self, creds: SmtpCredentials, mail: OutgoingMail) -> str:
        host, ip = await self._resolve(creds)
        message = build_message(mail)

        def run() -> str:
            client = self._open(host, ip, creds)
            try:
                client.send_message(message)
            except smtplib.SMTPRecipientsRefused as exc:
                raise MailSendError("rejected", "收件人地址被邮件服务器拒绝") from exc
            except (OSError, smtplib.SMTPException) as exc:
                raise MailSendError("rejected", f"邮件服务器拒绝发送：{type(exc).__name__}") from exc
            finally:
                with contextlib.suppress(OSError, smtplib.SMTPException):
                    client.quit()
            return str(message["Message-ID"])

        return await asyncio.to_thread(run)


@dataclass
class FakeMailer:
    """记录发出的邮件；`fail_with` 可模拟失败。密码为 "wrong" 时校验失败。"""

    sent: list[tuple[SmtpCredentials, EmailMessage]] = field(default_factory=list)
    fail_with: MailSendError | None = None

    async def verify(self, creds: SmtpCredentials) -> None:
        await check_smtp_host_fake(creds)
        if creds.password == "wrong":  # noqa: S105 — 假实现：约定的错误密码
            raise MailSendError("auth_failed", "邮箱账号或授权码不正确")

    async def send(self, creds: SmtpCredentials, mail: OutgoingMail) -> str:
        await check_smtp_host_fake(creds)
        if self.fail_with is not None:
            raise self.fail_with
        message = build_message(mail)
        self.sent.append((creds, message))
        return str(message["Message-ID"])


async def check_smtp_host_fake(creds: SmtpCredentials) -> None:
    """假实现同样执行地址校验（不做真实 DNS：*.example 视为公网地址）。"""

    async def resolver(host: str, port: int) -> list[str]:
        if host.endswith(".example") or host.endswith(".example.com"):
            return ["93.184.216.34"]
        raise OSError("no such host")

    try:
        await check_smtp_host(creds.host, creds.port, resolver=resolver)
    except SsrfBlockedError as exc:
        raise MailSendError("blocked_host", "邮件服务器地址不可用（不允许内网地址，端口只支持 465 / 587）") from exc
