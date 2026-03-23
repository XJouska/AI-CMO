"""SSE (Server-Sent Events) utilities"""
import json
from dataclasses import dataclass
from typing import Any


@dataclass
class SSEEvent:
    """Structured SSE event"""
    event: str
    data: Any

    def to_sse(self) -> str:
        """Convert to SSE wire format"""
        data_str = json.dumps(self.data, ensure_ascii=False) if not isinstance(self.data, str) else self.data
        return f"event: {self.event}\ndata: {data_str}\n\n"


def sse_message(event: str, data: Any) -> str:
    """Helper to create SSE message string"""
    return SSEEvent(event, data).to_sse()
