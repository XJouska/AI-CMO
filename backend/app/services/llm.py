"""LLM 客户端：OpenAI 兼容接口（从旧版迁移并改造）。

- `LLMClient` 协议：业务代码只依赖这个接口
- `OpenAICompatLLM`：真实实现（连接池、指数退避重试、JSON 模式、用量统计）
- `FakeLLM`（app/services/fakes.py）：测试与 TEST_MODE 使用
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any, Protocol

import httpx
from openai import AsyncOpenAI

from app.core.config import get_settings
from app.core.errors import ServiceUnavailableError

logger = logging.getLogger(__name__)

Message = dict[str, Any]


@dataclass
class LLMUsage:
    prompt_tokens: int = 0
    completion_tokens: int = 0

    @property
    def total(self) -> int:
        return self.prompt_tokens + self.completion_tokens

    def add(self, other: LLMUsage) -> None:
        self.prompt_tokens += other.prompt_tokens
        self.completion_tokens += other.completion_tokens


@dataclass
class LLMResult:
    content: str
    usage: LLMUsage = field(default_factory=LLMUsage)
    tool_calls: list[dict[str, Any]] = field(default_factory=list)


class LLMError(Exception):
    """LLM 调用失败（已重试）。"""


class LLMClient(Protocol):
    async def complete(
        self,
        messages: list[Message],
        *,
        task: str,
        json_mode: bool = False,
        tools: list[dict[str, Any]] | None = None,
        max_tokens: int = 2048,
    ) -> LLMResult: ...

    def stream(self, messages: list[Message], *, task: str, max_tokens: int = 2048) -> AsyncIterator[str]: ...


_JSON_BLOCK = re.compile(r"```(?:json)?\s*([\s\S]*?)```")


def parse_json_object(content: str) -> dict[str, Any]:
    """解析 LLM 返回的 JSON 对象；兼容 Markdown 代码块包裹。失败抛出 LLMError。"""
    text = content.strip()
    candidates = [text]
    match = _JSON_BLOCK.search(text)
    if match:
        candidates.append(match.group(1).strip())
    for candidate in candidates:
        try:
            value = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            return value
    raise LLMError("AI 返回的内容不是有效的 JSON")


class OpenAICompatLLM:
    """真实 LLM 客户端。"""

    RETRIES = 3

    def __init__(self) -> None:
        settings = get_settings()
        if not settings.llm_enabled or settings.llm_api_key is None:
            raise ServiceUnavailableError("AI 服务未配置，请联系管理员", code="llm_not_configured")
        self.model = settings.llm_model
        self.client = AsyncOpenAI(
            api_key=settings.llm_api_key.get_secret_value(),
            base_url=settings.llm_api_base,
            http_client=httpx.AsyncClient(
                limits=httpx.Limits(max_connections=20, max_keepalive_connections=10, keepalive_expiry=30),
                timeout=httpx.Timeout(90.0, connect=5.0),
                trust_env=False,
            ),
            max_retries=0,
        )

    async def complete(
        self,
        messages: list[Message],
        *,
        task: str,
        json_mode: bool = False,
        tools: list[dict[str, Any]] | None = None,
        max_tokens: int = 2048,
    ) -> LLMResult:
        kwargs: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": 0.3,
            "max_tokens": max_tokens,
        }
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}
        if tools:
            kwargs["tools"] = tools
        last_error: Exception | None = None
        for attempt in range(self.RETRIES):
            try:
                response = await self.client.chat.completions.create(**kwargs)
                choice = response.choices[0].message
                usage = LLMUsage(
                    prompt_tokens=getattr(response.usage, "prompt_tokens", 0) or 0,
                    completion_tokens=getattr(response.usage, "completion_tokens", 0) or 0,
                )
                calls = [
                    {"id": c.id, "name": c.function.name, "arguments": c.function.arguments}
                    for c in (choice.tool_calls or [])
                ]
                return LLMResult(content=choice.content or "", usage=usage, tool_calls=calls)
            except Exception as exc:
                last_error = exc
                logger.warning("llm task=%s attempt %d failed: %s", task, attempt + 1, type(exc).__name__)
                if attempt < self.RETRIES - 1:
                    await asyncio.sleep(2**attempt)
        raise LLMError(f"LLM 调用失败：{type(last_error).__name__}")

    async def stream(
        self, messages: list[Message], *, task: str, max_tokens: int = 2048
    ) -> AsyncIterator[str]:
        response = await self.client.chat.completions.create(
            model=self.model, messages=messages, temperature=0.3, max_tokens=max_tokens, stream=True
        )
        async for chunk in response:
            if chunk.choices and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content
