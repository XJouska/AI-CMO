"""数据源连接器。

统一接口：`search(query, market, since) -> list[RawSignal]`。每个连接器声明速率限制与合规说明（terms_note）。
所有网络请求经过 safe_fetch（SSRF 防护）；网页抓取前检查 robots.txt；不抓取需要登录的内容，不抓取 LinkedIn。
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from email.utils import parsedate_to_datetime
from typing import Any, Protocol
from urllib.parse import quote_plus, urlsplit
from urllib.robotparser import RobotFileParser

from defusedxml import ElementTree
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import utcnow
from app.core.security.ssrf import SsrfBlockedError, safe_fetch
from app.modules.leads.models import SourceConfig, SourceRequest

logger = logging.getLogger(__name__)

BOT_UA = "AICMO-Bot/0.1 (+https://aicmo.site/bot)"
BLOCKED_DOMAINS = ("linkedin.com", "lnkd.in")


@dataclass
class RawSignal:
    source_key: str
    url: str
    title: str
    snippet: str
    published_at: datetime | None = None
    raw: dict[str, Any] = field(default_factory=dict)

    @property
    def url_hash(self) -> str:
        return hashlib.sha256(canonical_url(self.url).encode()).hexdigest()


def canonical_url(url: str) -> str:
    parts = urlsplit(url.strip())
    query = "&".join(
        sorted(p for p in parts.query.split("&") if p and not p.lower().startswith(("utm_", "fbclid", "gclid")))
    )
    path = parts.path.rstrip("/") or "/"
    return f"{parts.scheme.lower()}://{(parts.hostname or '').lower()}{path}" + (f"?{query}" if query else "")


def is_blocked_domain(url: str) -> bool:
    host = (urlsplit(url).hostname or "").lower()
    return any(host == d or host.endswith("." + d) for d in BLOCKED_DOMAINS)


class Connector(Protocol):
    key: str
    label: str
    terms_note: str
    requires_api_key: bool
    rate_limit_per_minute: int

    async def search(self, query: str, market: str, since: datetime) -> list[RawSignal]: ...


# ── robots.txt ─────────────────────────────────────────────────────────

_ROBOTS_CACHE: dict[str, tuple[float, RobotFileParser | None]] = {}
ROBOTS_TTL = 3600


async def robots_allows(url: str) -> bool:
    """检查 robots.txt。无法获取时（404 等）视为允许；被 SSRF 拒绝时视为不允许。"""
    parts = urlsplit(url)
    origin = f"{parts.scheme}://{parts.netloc}"
    cached = _ROBOTS_CACHE.get(origin)
    if cached is None or time.monotonic() - cached[0] > ROBOTS_TTL:
        from app.core.providers import providers

        parser: RobotFileParser | None = RobotFileParser()
        try:
            # 经由 Fetcher（真实实现为 safe_fetch，含 SSRF 防护）
            result = await providers.fetcher().fetch(f"{origin}/robots.txt")
            if result.status >= 400:
                parser = None
            else:
                parser.parse(result.text.splitlines())  # type: ignore[union-attr]
        except SsrfBlockedError:
            return False
        except Exception:
            parser = None
        _ROBOTS_CACHE[origin] = (time.monotonic(), parser)
        cached = _ROBOTS_CACHE[origin]
    parser = cached[1]
    return True if parser is None else parser.can_fetch(BOT_UA, url)


# ── 速率限制（基于 source_requests 记录，多 worker 共享）───────────────


def rate_limited(db: Session, key: str, per_minute: int) -> bool:
    count = (
        db.scalar(
            select(func.count())
            .select_from(SourceRequest)
            .where(SourceRequest.source_key == key, SourceRequest.created_at > utcnow() - timedelta(minutes=1))
        )
        or 0
    )
    return count >= per_minute


def record_request(
    db: Session, key: str, company_id: Any, *, ok: bool, started: float, results: int, error: str = ""
) -> None:
    db.add(
        SourceRequest(
            source_key=key,
            company_id=company_id,
            ok=ok,
            results=results,
            error=error[:200],
            duration_ms=int((time.monotonic() - started) * 1000),
        )
    )


def source_enabled(db: Session, key: str) -> bool:
    config = db.get(SourceConfig, key)
    return config is None or config.enabled


# ── 搜索引擎 API（采购意图）────────────────────────────────────────────


class BingSearch:
    key = "web_search"
    label = "搜索引擎"
    terms_note = "使用官方搜索 API（Bing Web Search），遵守其使用条款；只读取搜索结果摘要与公开页面。"
    requires_api_key = True
    rate_limit_per_minute = 30
    URL = "https://api.bing.microsoft.com/v7.0/search"

    def __init__(self, api_key: str) -> None:
        self.api_key = api_key

    async def search(self, query: str, market: str, since: datetime) -> list[RawSignal]:
        url = f"{self.URL}?q={quote_plus(query)}&count=20&freshness=Month&textDecorations=false"
        result = await safe_fetch(url, headers={"Ocp-Apim-Subscription-Key": self.api_key}, max_bytes=2_000_000)
        if result.status_code != 200:
            raise RuntimeError(f"search api status {result.status_code}")
        data = json.loads(result.content)
        out = []
        for item in (data.get("webPages") or {}).get("value", []):
            if is_blocked_domain(item.get("url", "")):
                continue
            out.append(
                RawSignal(
                    self.key,
                    item.get("url", ""),
                    item.get("name", "")[:500],
                    item.get("snippet", "")[:2000],
                    _parse_date(item.get("dateLastCrawled")),
                    {"query": query, "market": market},
                )
            )
        return out


class SerpApiSearch(BingSearch):
    terms_note = "使用 SerpAPI 官方接口获取搜索结果，遵守其使用条款。"
    URL = "https://serpapi.com/search.json"

    async def search(self, query: str, market: str, since: datetime) -> list[RawSignal]:
        url = f"{self.URL}?engine=google&q={quote_plus(query)}&num=20&tbs=qdr:m&api_key={quote_plus(self.api_key)}"
        result = await safe_fetch(url, max_bytes=2_000_000)
        if result.status_code != 200:
            raise RuntimeError(f"serpapi status {result.status_code}")
        data = json.loads(result.content)
        return [
            RawSignal(
                self.key,
                item.get("link", ""),
                item.get("title", "")[:500],
                item.get("snippet", "")[:2000],
                _parse_date(item.get("date")),
                {"query": query, "market": market},
            )
            for item in data.get("organic_results", [])
            if item.get("link") and not is_blocked_domain(item["link"])
        ]


# ── RSS（公开招标公告、行业新闻）──────────────────────────────────────


class RssSource:
    """读取 RSS / Atom，按关键词过滤。使用 defusedxml 解析，防止 XML 实体攻击。"""

    requires_api_key = False
    rate_limit_per_minute = 10

    def __init__(self, key: str, url: str, label: str, terms_note: str) -> None:
        self.key = key
        self.url = url
        self.label = label
        self.terms_note = terms_note

    async def search(self, query: str, market: str, since: datetime) -> list[RawSignal]:
        if not await robots_allows(self.url):
            return []
        result = await safe_fetch(self.url, max_bytes=5_000_000, headers={"User-Agent": BOT_UA})
        if result.status_code != 200:
            raise RuntimeError(f"rss status {result.status_code}")
        return filter_items(parse_feed(result.content, self.key), query, market, since)


def parse_feed(content: bytes, key: str) -> list[RawSignal]:
    root = ElementTree.fromstring(content, forbid_dtd=True, forbid_entities=True, forbid_external=True)
    items: list[RawSignal] = []
    ns = {"a": "http://www.w3.org/2005/Atom"}
    for item in root.iter("item"):
        items.append(
            RawSignal(
                key,
                _text(item, "link"),
                _text(item, "title")[:500],
                _strip_html(_text(item, "description"))[:2000],
                _parse_date(_text(item, "pubDate")),
            )
        )
    for entry in root.iter("{http://www.w3.org/2005/Atom}entry"):
        link = entry.find("a:link", ns)
        items.append(
            RawSignal(
                key,
                link.get("href", "") if link is not None else "",
                _text(entry, "a:title", ns)[:500],
                _strip_html(_text(entry, "a:summary", ns))[:2000],
                _parse_date(_text(entry, "a:updated", ns)),
            )
        )
    return [i for i in items if i.url.startswith(("http://", "https://")) and not is_blocked_domain(i.url)]


def filter_items(items: list[RawSignal], query: str, market: str, since: datetime) -> list[RawSignal]:
    terms = [t.lower() for t in re.findall(r"[\w-]{3,}", query) if t.lower() not in _STOP]
    out = []
    for item in items:
        if item.published_at and item.published_at < since:
            continue
        text = f"{item.title} {item.snippet}".lower()
        if terms and sum(term in text for term in terms) < min(2, len(terms)):
            continue
        item.raw.update({"query": query, "market": market})
        out.append(item)
    return out


_STOP = {"the", "and", "for", "supplier", "suppliers", "rfq", "tender", "looking", "with", "from", "buy", "quote"}


def _text(node: Any, path: str, ns: dict[str, str] | None = None) -> str:
    found = node.find(path, ns or {})
    return (found.text or "").strip() if found is not None and found.text else ""


def _strip_html(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", text)).strip()


def _parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = parsedate_to_datetime(value)
    except (TypeError, ValueError):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


# ── 假数据源（测试与 TEST_MODE）────────────────────────────────────────


class FakeSearch:
    """按查询词返回可预测的结果：包含招标、求购、无关和指向内网的条目，用于验证流水线各环节。"""

    key = "web_search"
    label = "搜索引擎（演示）"
    terms_note = "测试数据"
    requires_api_key = False
    rate_limit_per_minute = 1000

    def __init__(self, results: dict[str, list[RawSignal]] | None = None) -> None:
        self.results = results
        self.queries: list[str] = []

    async def search(self, query: str, market: str, since: datetime) -> list[RawSignal]:
        self.queries.append(query)
        if self.results is not None:
            return list(self.results.get(query, self.results.get("*", [])))
        product = query.split('"')[1] if '"' in query else query.split()[0]
        slug = re.sub(r"[^a-z0-9]+", "-", product.lower()).strip("-")
        country = market or "Germany"
        return [
            RawSignal(
                self.key,
                f"https://tenders.example/{slug}-{country.lower()}-2026",
                f"Tender: supply of {product} for municipal water project ({country})",
                f"The city utility invites bids for 2,000 units of {product}. Deadline 2026-12-15. "
                f"Contact procurement@utility-{country.lower()}.example",
                raw={"country": country},
            ),
            RawSignal(
                self.key,
                f"https://b2b.example/rfq/{slug}-{country.lower()}",
                f"RFQ: looking for {product} supplier",
                f"Distributor in {country} looking for a reliable {product} manufacturer, 500 pcs monthly.",
                raw={"country": country},
            ),
            RawSignal(
                self.key,
                f"https://news.example/{slug}-history",
                f"The history of {product}",
                "An encyclopedia article.",
                raw={"country": country},
            ),
            RawSignal(self.key, "http://10.0.0.5/internal-rfq", f"Internal {product} RFQ", "should be blocked"),
        ]


# ── 注册表 ─────────────────────────────────────────────────────────────

DEFAULT_RSS = [
    {
        "key": "ted_rss",
        "url": "https://ted.europa.eu/api/v3.0/notices/search/rss",
        "kind": "tender",
        "label": "欧盟 TED 招标",
        "terms_note": "欧盟官方公开招标数据（TED），按其开放数据条款使用；只读取 RSS 公告。",
    },
]


def connectors() -> dict[str, Connector]:
    from app.core.providers import providers

    return providers.lead_sources()


def build_connectors() -> dict[str, Connector]:
    settings = get_settings()
    out: dict[str, Connector] = {}
    if settings.search_api_key and settings.search_api_provider != "none":
        key = settings.search_api_key.get_secret_value()
        out["web_search"] = SerpApiSearch(key) if settings.search_api_provider == "serpapi" else BingSearch(key)
    for item in [*DEFAULT_RSS, *settings.rss_sources]:
        if item.get("key") and item.get("url"):
            out[item["key"]] = RssSource(
                item["key"], item["url"], item.get("label", item["key"]), item.get("terms_note", "公开 RSS 数据源")
            )
    return out


def build_fake_connectors() -> dict[str, Connector]:
    return {"web_search": FakeSearch()}
