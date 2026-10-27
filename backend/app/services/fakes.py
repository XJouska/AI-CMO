"""外部服务的假实现（测试与 TEST_MODE 使用）。不访问网络，结果可预测。"""

from __future__ import annotations

import json
import re
from collections import defaultdict, deque
from collections.abc import AsyncIterator, Callable
from typing import Any

from app.services.llm import LLMError, LLMResult, LLMUsage, Message

Responder = Callable[[list[Message]], LLMResult | str | dict[str, Any]]


def _last_user_text(messages: list[Message]) -> str:
    for message in reversed(messages):
        if message.get("role") == "user":
            content = message.get("content")
            return content if isinstance(content, str) else json.dumps(content, ensure_ascii=False)
    return ""


def fake_profile_extract(messages: list[Message]) -> dict[str, Any]:
    """根据输入文本做简单的规则抽取，模拟 LLM 的结构化输出。"""
    text = _last_user_text(messages)
    result: dict[str, Any] = {"company": {}, "products": [], "certifications": [], "contacts": {}}
    company = result["company"]
    if m := re.search(r"(?:Founded in|成立于)\s*(\d{4})", text):
        company["founded_year"] = int(m.group(1))
    if m := re.search(r"(\d[\d,]*)\s*(?:employees|名员工|人)", text):
        company["employees"] = m.group(1).replace(",", "")
    if m := re.search(r"([\d,]+)\s*(?:square meters|平方米|㎡)", text):
        company["factory_area"] = f"{m.group(1)} m²"
    if m := re.search(r"Annual capacity\s*([^.<]+)", text, re.I):
        company["annual_capacity"] = m.group(1).strip()
    if m := re.search(r"<title>([^<]+)</title>", text):
        company["name_en"] = m.group(1).strip()
    markets = re.search(r"Export markets?:\s*([^.<]+)", text, re.I)
    if markets:
        company["export_markets"] = [part.strip() for part in markets.group(1).split(",") if part.strip()]
    certs = re.findall(r"\b(ISO\s?\d{4,5}|CE|FDA|RoHS|UL|API\s?6D)\b", text)
    result["certifications"] = sorted(set(c.replace("ISO", "ISO ").replace("  ", " ").strip() for c in certs))
    if m := re.search(r"[\w.+-]+@[\w-]+\.[\w.]+", text):
        result["contacts"]["email"] = m.group(0)
    if re.search(r"valve|阀门", text, re.I):
        result["products"].append(
            {
                "name_en": "Stainless Steel Ball Valve",
                "name_cn": "不锈钢球阀",
                "category": "Valves",
                "keywords_en": ["stainless steel ball valve", "industrial valve"],
                "applications": ["water treatment", "oil and gas"],
            }
        )
        company.setdefault("usp", "Factory-direct stainless steel valves with in-house casting and testing.")
    return result


DEFAULT_RESPONDERS: dict[str, Responder] = {
    "profile.extract": fake_profile_extract,
}


class FakeLLM:
    """按任务名返回预设结果。

    - `script(task, *responses)`：按顺序返回指定结果（字符串、dict 或 LLMResult；Exception 实例会被抛出）
    - 未设置脚本时使用 DEFAULT_RESPONDERS；仍没有则返回空 JSON 对象
    """

    def __init__(self) -> None:
        self._scripts: dict[str, deque[Any]] = defaultdict(deque)
        self.calls: list[dict[str, Any]] = []

    def script(self, task: str, *responses: Any) -> FakeLLM:
        self._scripts[task].extend(responses)
        return self

    def _respond(self, task: str, messages: list[Message]) -> LLMResult:
        queue = self._scripts.get(task)
        if queue:
            value = queue.popleft()
        else:
            responder = DEFAULT_RESPONDERS.get(task)
            value = responder(messages) if responder else {}
        if isinstance(value, Exception):
            raise value
        if callable(value):
            value = value(messages)
        if isinstance(value, LLMResult):
            return value
        content = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
        prompt_chars = sum(len(str(m.get("content", ""))) for m in messages)
        return LLMResult(
            content=content,
            usage=LLMUsage(prompt_tokens=prompt_chars // 4, completion_tokens=len(content) // 4),
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
        self.calls.append({"task": task, "messages": messages, "json_mode": json_mode, "tools": tools})
        return self._respond(task, messages)

    async def stream(
        self, messages: list[Message], *, task: str, max_tokens: int = 2048
    ) -> AsyncIterator[str]:
        self.calls.append({"task": task, "messages": messages, "stream": True})
        result = self._respond(task, messages)
        for index in range(0, len(result.content), 8):
            yield result.content[index : index + 8]


class FailingLLM(FakeLLM):
    async def complete(self, messages: list[Message], **kwargs: Any) -> LLMResult:  # type: ignore[override]
        raise LLMError("模拟 LLM 故障")
