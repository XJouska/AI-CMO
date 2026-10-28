"""LLM 用量计量：包装 LLMClient，把每次调用的 token 数写入当前企业的 usage_records。

调用方在进入「属于某企业的工作」时设置计量上下文：

    with metering(db, company_id):
        await providers.llm().complete(...)

用量记录加入同一个数据库会话，随业务事务一起提交（业务回滚时用量也回滚——失败的调用不计费，
但仍计入成本看板的「failed」统计由日志承担）。没有上下文时不记录（例如评测脚本）。
"""

from __future__ import annotations

import contextvars
import uuid
from collections.abc import AsyncIterator, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from app.services.llm import LLMClient, LLMResult, Message


@dataclass
class _Meter:
    db: Session
    company_id: uuid.UUID


_current: contextvars.ContextVar[_Meter | None] = contextvars.ContextVar("llm_meter", default=None)


@contextmanager
def metering(db: Session, company_id: uuid.UUID) -> Iterator[None]:
    token = _current.set(_Meter(db, company_id))
    try:
        yield
    finally:
        _current.reset(token)


def current_company_id() -> uuid.UUID | None:
    meter = _current.get()
    return meter.company_id if meter else None


class MeteredLLM:
    def __init__(self, inner: LLMClient) -> None:
        self.inner = inner

    def __getattr__(self, name: str) -> Any:  # 透传测试替身上的辅助方法（script / calls 等）
        return getattr(self.inner, name)

    async def complete(self, messages: list[Message], *, task: str, **kwargs: Any) -> LLMResult:
        result = await self.inner.complete(messages, task=task, **kwargs)
        meter = _current.get()
        if meter is not None and result.usage.total:
            from app.modules.admin.audit import record_usage

            record_usage(
                meter.db,
                meter.company_id,
                "llm_tokens",
                result.usage.total,
                {"task": task, "prompt": result.usage.prompt_tokens, "completion": result.usage.completion_tokens},
            )
        return result

    def stream(self, messages: list[Message], *, task: str, max_tokens: int = 2048) -> AsyncIterator[str]:
        return self.inner.stream(messages, task=task, max_tokens=max_tokens)
