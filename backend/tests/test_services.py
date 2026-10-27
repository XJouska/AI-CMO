"""基础服务：本地存储、LLM 客户端（用 respx 模拟 OpenAI 兼容接口）、JSON 解析、提供者注册表。"""

from __future__ import annotations

import json

import httpx
import pytest
import respx

from app.core.errors import ServiceUnavailableError
from app.core.providers import _Providers
from app.services.fakes import FailingLLM, FakeLLM
from app.services.fetcher import FakeFetcher, SafeFetcher
from app.services.llm import LLMError, OpenAICompatLLM, parse_json_object
from app.services.storage import LocalStorage

KEY = "00000000-0000-0000-0000-000000000001/" + "a" * 32


def test_local_storage_roundtrip(tmp_path) -> None:
    storage = LocalStorage(str(tmp_path))
    storage.put(KEY, b"data")
    assert storage.get(KEY) == b"data"
    storage.delete(KEY)
    storage.delete(KEY)
    with pytest.raises(FileNotFoundError):
        storage.get(KEY)


@pytest.mark.parametrize("key", ["../../etc/passwd", "a/b", f"{KEY}/../../x", "/abs/path"])
def test_local_storage_rejects_traversal(tmp_path, key) -> None:
    with pytest.raises(ValueError):
        LocalStorage(str(tmp_path)).put(key, b"x")


@pytest.mark.parametrize(
    ("content", "expected"),
    [('{"a": 1}', {"a": 1}), ('```json\n{"a": 2}\n```', {"a": 2}), ('  {"a": [1]} ', {"a": [1]})],
)
def test_parse_json_object(content, expected) -> None:
    assert parse_json_object(content) == expected


@pytest.mark.parametrize("content", ["not json", "[1, 2]", "```\nnope\n```"])
def test_parse_json_object_errors(content) -> None:
    with pytest.raises(LLMError):
        parse_json_object(content)


def _enable_llm(monkeypatch) -> None:
    from pydantic import SecretStr

    from app.core.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "llm_api_key", SecretStr("sk-test"))
    monkeypatch.setattr(settings, "llm_api_base", "https://llm.example/v1")
    monkeypatch.setattr(settings, "llm_model", "test-model")


def test_real_llm_requires_configuration() -> None:
    with pytest.raises(ServiceUnavailableError):
        OpenAICompatLLM()


@respx.mock
async def test_real_llm_complete_with_usage_and_tool_calls(monkeypatch) -> None:
    _enable_llm(monkeypatch)
    route = respx.post("https://llm.example/v1/chat/completions").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "x",
                "object": "chat.completion",
                "created": 0,
                "model": "test-model",
                "choices": [
                    {
                        "index": 0,
                        "finish_reason": "stop",
                        "message": {
                            "role": "assistant",
                            "content": '{"ok": true}',
                            "tool_calls": [
                                {
                                    "id": "c1",
                                    "type": "function",
                                    "function": {"name": "profile.get", "arguments": "{}"},
                                }
                            ],
                        },
                    }
                ],
                "usage": {"prompt_tokens": 11, "completion_tokens": 5, "total_tokens": 16},
            },
        )
    )
    client = OpenAICompatLLM()
    result = await client.complete(
        [{"role": "user", "content": "hi"}],
        task="t",
        json_mode=True,
        tools=[{"type": "function", "function": {"name": "profile.get"}}],
    )
    assert result.content == '{"ok": true}'
    assert result.usage.total == 16
    assert result.tool_calls == [{"id": "c1", "name": "profile.get", "arguments": "{}"}]
    sent = json.loads(route.calls[0].request.content)
    assert sent["model"] == "test-model"
    assert sent["response_format"] == {"type": "json_object"}
    assert route.calls[0].request.headers["authorization"] == "Bearer sk-test"


@respx.mock
async def test_real_llm_retries_then_raises(monkeypatch) -> None:
    _enable_llm(monkeypatch)
    sleeps: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    monkeypatch.setattr("app.services.llm.asyncio.sleep", fake_sleep)
    route = respx.post("https://llm.example/v1/chat/completions").mock(return_value=httpx.Response(500))
    with pytest.raises(LLMError):
        await OpenAICompatLLM().complete([{"role": "user", "content": "hi"}], task="t")
    assert route.call_count == 3
    assert sleeps == [1, 2]


@respx.mock
async def test_real_llm_stream(monkeypatch) -> None:
    _enable_llm(monkeypatch)
    chunks = [
        {
            "id": "x",
            "object": "chat.completion.chunk",
            "created": 0,
            "model": "m",
            "choices": [{"index": 0, "delta": {"content": part}, "finish_reason": None}],
        }
        for part in ("Hel", "lo")
    ]
    body = "".join(f"data: {json.dumps(c)}\n\n" for c in chunks) + "data: [DONE]\n\n"
    respx.post("https://llm.example/v1/chat/completions").mock(
        return_value=httpx.Response(200, text=body, headers={"content-type": "text/event-stream"})
    )
    parts = [p async for p in OpenAICompatLLM().stream([{"role": "user", "content": "hi"}], task="t")]
    assert "".join(parts) == "Hello"


async def test_fake_llm_script_and_stream() -> None:
    llm = FakeLLM().script("x", "first", {"b": 2}, ValueError("boom"), lambda messages: "dynamic")
    assert (await llm.complete([], task="x")).content == "first"
    assert json.loads((await llm.complete([], task="x")).content) == {"b": 2}
    with pytest.raises(ValueError):
        await llm.complete([], task="x")
    assert (await llm.complete([], task="x")).content == "dynamic"
    assert (await llm.complete([], task="unknown")).content == "{}"
    llm.script("s", "abcdefghijkl")
    assert [p async for p in llm.stream([], task="s")] == ["abcdefgh", "ijkl"]
    with pytest.raises(LLMError):
        await FailingLLM().complete([], task="x")


async def test_fake_fetcher_blocks_internal_literals() -> None:
    from app.core.security.ssrf import SsrfBlockedError

    fetcher = FakeFetcher()
    for url in ("http://10.0.0.1/", "http://localhost/", "http://db.internal/"):
        with pytest.raises(SsrfBlockedError):
            await fetcher.fetch(url)
    page = await fetcher.fetch("https://example.com")
    assert page.status == 200 and "Demo Valve" in page.text


async def test_safe_fetcher_uses_ssrf_guard(monkeypatch) -> None:
    from app.core.security import ssrf
    from app.services import fetcher as fetcher_module

    captured: dict[str, object] = {}

    async def fake_safe_fetch(url: str, **kwargs):
        captured.update(url=url, **kwargs)
        return ssrf.FetchResult(
            url=url,
            status_code=200,
            headers=httpx.Headers({"content-type": "text/html"}),
            content=b"<p>ok</p>",
        )

    monkeypatch.setattr(fetcher_module, "safe_fetch", fake_safe_fetch)
    page = await SafeFetcher(max_bytes=1000).fetch("https://example.com/")
    assert page.text == "<p>ok</p>"
    assert captured["max_bytes"] == 1000


def test_provider_registry_selects_fakes_in_test_mode(monkeypatch, tmp_path) -> None:
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "storage_dir", str(tmp_path))
    registry = _Providers()
    assert isinstance(registry.llm(), FakeLLM)
    assert isinstance(registry.fetcher(), FakeFetcher)
    assert isinstance(registry.storage(), LocalStorage)
    assert registry.llm() is registry.llm()  # 缓存
    replacement = FakeLLM()
    with registry.override(llm=replacement):
        assert registry.llm() is replacement
    assert registry.llm() is not replacement

    monkeypatch.setattr(get_settings(), "test_mode", False)
    registry.reset()
    assert isinstance(registry.fetcher(), SafeFetcher)
    with pytest.raises(ServiceUnavailableError):
        registry.llm()
