"""SSE 事件编码与事件类型（协议见 plans/03-assistant.md 4.1，样例见 contracts/sse-assistant.json）。"""

from __future__ import annotations

import json
from typing import Any, Literal

EventName = Literal[
    "message.start", "progress", "block.delta", "block.card", "followups", "message.done", "error"
]
EVENT_NAMES: tuple[str, ...] = (
    "message.start",
    "progress",
    "block.delta",
    "block.card",
    "followups",
    "message.done",
    "error",
)


def event(name: EventName, data: dict[str, Any]) -> dict[str, Any]:
    return {"event": name, "data": data}


def encode(item: dict[str, Any]) -> str:
    """编码为 SSE 文本。data 为单行 JSON（json.dumps 不输出换行），不会被注入额外字段。"""
    payload = json.dumps(item["data"], ensure_ascii=False, separators=(",", ":"))
    return f"event: {item['event']}\ndata: {payload}\n\n"


KEEPALIVE = ": keepalive\n\n"
