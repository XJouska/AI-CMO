"""结构化日志（JSON）、请求 ID、敏感信息脱敏。"""

from __future__ import annotations

import contextvars
import json
import logging
import re
import sys
import time
import uuid
from datetime import UTC, datetime

from starlette.types import ASGIApp, Message, Receive, Scope, Send

request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")

_REDACTIONS: list[tuple[re.Pattern[str], str]] = [
    # Authorization 头 / Bearer token
    (re.compile(r"(?i)(bearer\s+)[A-Za-z0-9._~+/=-]+"), r"\1[REDACTED]"),
    # key=value 形式的敏感字段（token、password、secret、api_key 等）
    (
        re.compile(
            r"(?i)\b((?:access_|refresh_|session_)?token|password|passwd|secret|api[_-]?key)"
            r"(\"?\s*[:=]\s*\"?)([^\s\",&]+)"
        ),
        r"\1\2[REDACTED]",
    ),
    # 邮箱：保留首字母和域名
    (re.compile(r"\b([A-Za-z0-9])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b"), r"\1***@\2"),
    # 手机号：中国大陆 11 位 / 国际 E.164，保留前 3 后 2
    (re.compile(r"(?<!\d)(\+?\d{3})\d{6,10}(\d{2})(?!\d)"), r"\1******\2"),
]


def redact(text: str) -> str:
    for pattern, replacement in _REDACTIONS:
        text = pattern.sub(replacement, text)
    return text


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": redact(record.getMessage()),
            "request_id": request_id_var.get(),
        }
        for key in ("method", "path", "status", "duration_ms"):
            value = getattr(record, key, None)
            if value is not None:
                payload[key] = value
        if record.exc_info:
            payload["exc"] = redact(self.formatException(record.exc_info))
        return json.dumps(payload, ensure_ascii=False)


def configure_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level.upper())
    # uvicorn 自带访问日志不带请求 ID，关闭后由中间件统一记录。
    logging.getLogger("uvicorn.access").disabled = True


_REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9-]{8,64}$")
access_logger = logging.getLogger("app.access")


class RequestContextMiddleware:
    """纯 ASGI 中间件：分配请求 ID、写回响应头、记录访问日志。不缓冲响应体，兼容 SSE。"""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        incoming = ""
        for name, value in scope.get("headers", []):
            if name == b"x-request-id":
                incoming = value.decode("latin-1")
                break
        request_id = incoming if _REQUEST_ID_RE.match(incoming) else uuid.uuid4().hex
        token = request_id_var.set(request_id)
        start = time.perf_counter()
        status_holder = {"status": 500}

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                status_holder["status"] = message["status"]
                headers = list(message.get("headers", []))
                headers.append((b"x-request-id", request_id.encode("latin-1")))
                message["headers"] = headers
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            from app.core.observability import metrics, route_template

            duration = time.perf_counter() - start
            metrics.observe(str(scope.get("method")), route_template(scope), status_holder["status"], duration)
            access_logger.info(
                "request",
                extra={
                    "method": scope.get("method"),
                    "path": scope.get("path"),
                    "status": status_holder["status"],
                    "duration_ms": round((time.perf_counter() - start) * 1000, 1),
                },
            )
            request_id_var.reset(token)
