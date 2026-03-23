import json
import asyncio
import logging
from typing import AsyncGenerator, Optional

import httpx
from openai import AsyncOpenAI
from cachetools import TTLCache

from app.config import settings

logger = logging.getLogger(__name__)


class LLMService:
    """Optimized LLM service layer with connection pooling and caching"""

    def __init__(self):
        self.client = AsyncOpenAI(
            api_key=settings.qwen_api_key,
            base_url=settings.qwen_api_base,
            http_client=httpx.AsyncClient(
                limits=httpx.Limits(
                    max_connections=20,
                    max_keepalive_connections=10,
                    keepalive_expiry=30,
                ),
                timeout=httpx.Timeout(90.0, connect=5.0),
            ),
        )
        self._cache = TTLCache(maxsize=100, ttl=3600)

    async def chat(self, messages: list, stream: bool = False,
                   json_mode: bool = False, max_tokens: int = 4096) -> str:
        """Single LLM call, non-streaming"""
        kwargs = {
            "model": settings.qwen_model,
            "messages": messages,
            "temperature": 0.3,
            "max_tokens": max_tokens,
        }
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}

        for attempt in range(3):
            try:
                response = await self.client.chat.completions.create(**kwargs)
                return response.choices[0].message.content
            except Exception as e:
                logger.warning(f"LLM call attempt {attempt+1} failed: {e}")
                if attempt == 2:
                    raise
                await asyncio.sleep(1 * (attempt + 1))

    async def chat_json(self, messages: list, cache_key: Optional[str] = None,
                        max_tokens: int = 4096) -> dict:
        """JSON mode call with caching"""
        if cache_key and cache_key in self._cache:
            return self._cache[cache_key]

        content = await self.chat(messages, json_mode=True, max_tokens=max_tokens)

        # Try to extract JSON from content
        try:
            result = json.loads(content)
        except json.JSONDecodeError:
            # Try to find JSON in markdown code blocks
            import re
            json_match = re.search(r'```(?:json)?\s*([\s\S]*?)```', content)
            if json_match:
                result = json.loads(json_match.group(1).strip())
            else:
                logger.error(f"Failed to parse JSON from LLM: {content[:500]}")
                result = {"error": "Failed to parse response", "raw": content[:1000]}

        if cache_key:
            self._cache[cache_key] = result
        return result

    async def chat_stream(self, messages: list) -> AsyncGenerator[str, None]:
        """Streaming LLM call"""
        response = await self.client.chat.completions.create(
            model=settings.qwen_model,
            messages=messages,
            temperature=0.3,
            max_tokens=4096,
            stream=True,
        )
        async for chunk in response:
            if chunk.choices and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content

    async def chat_json_parallel(self, task_list: list) -> list:
        """Parallel JSON LLM calls"""
        tasks = [
            asyncio.create_task(
                self.chat_json(t["messages"], t.get("cache_key"), t.get("max_tokens", 4096))
            )
            for t in task_list
        ]
        return await asyncio.gather(*tasks, return_exceptions=True)


_llm_instance = None


def get_llm_service() -> LLMService:
    global _llm_instance
    if _llm_instance is None:
        _llm_instance = LLMService()
    return _llm_instance
