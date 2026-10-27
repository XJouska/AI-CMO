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


_URL_RE = re.compile(r"(?:https?://)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:/\S*)?", re.I)


def fake_assistant_chat(messages: list[Message]) -> LLMResult:
    """TEST_MODE 下的助手：按关键词选择工具，拿到工具结果后给出固定格式的回答。"""
    last = messages[-1] if messages else {}
    if last.get("role") == "tool":
        content = str(last.get("content", ""))
        if '"completeness"' in content:
            data = json.loads(content).get("untrusted_data", {})
            missing = "\n".join(f"- {item['label']}" for item in data.get("missing", [])[:3])
            score = data.get("completeness", 0)
            return LLMResult(content=f"### 档案情况\n目前完整度 **{score}%**，建议先补充：\n{missing}")
        if '"extraction_id"' in content:
            return LLMResult(content="我已经开始整理，完成后请在上方卡片中确认要采纳的内容。")
        if '"waiting_for_user_confirmation"' in content:
            return LLMResult(content="")
        return LLMResult(content="好的，已经处理完成。")
    text = _last_user_text(messages)
    if m := _URL_RE.search(text):
        return _tool_call("profile_extract_from_url", {"url": m.group(0)})
    if re.search(r"档案|完整度", text):
        return _tool_call("profile_get_completeness", {})
    if m := re.search(r"成立于?\s*(\d{4})", text):
        return _tool_call("profile_update_fields", {"company": {"founded_year": int(m.group(1))}})
    return LLMResult(content="我可以帮你整理企业档案、生成英文官网、寻找海外采购商。你想先做哪一件？")


def _tool_call(name: str, args: dict[str, Any]) -> LLMResult:
    return LLMResult(
        content="",
        usage=LLMUsage(prompt_tokens=50, completion_tokens=10),
        tool_calls=[{"id": f"call_{name}", "name": name, "arguments": json.dumps(args, ensure_ascii=False)}],
    )


DEFAULT_RESPONDERS: dict[str, Responder] = {
    "profile.extract": fake_profile_extract,
    "assistant.chat": fake_assistant_chat,
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
        # 保存调用时的消息快照（调用方之后会继续向同一个列表追加消息）
        self.calls.append(
            {"task": task, "messages": [dict(m) for m in messages], "json_mode": json_mode, "tools": tools}
        )
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
