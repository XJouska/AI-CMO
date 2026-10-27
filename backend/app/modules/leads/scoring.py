"""商机评分（六维加权，plans/05 5.1）与去重（URL、买家域名、名称相似度、需求相似度）。"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from difflib import SequenceMatcher
from typing import Any
from urllib.parse import urlsplit

WEIGHTS: dict[str, float] = {
    "product_match": 0.35,
    "intent": 0.25,
    "timeliness": 0.15,
    "potential": 0.10,
    "reachability": 0.10,
    "credibility": 0.05,
}
assert abs(sum(WEIGHTS.values()) - 1) < 1e-9

DIMENSION_LABELS = {
    "product_match": "产品匹配度",
    "intent": "采购意图明确度",
    "timeliness": "时效性",
    "potential": "订单潜力",
    "reachability": "可触达性",
    "credibility": "可信度",
}

INTENT_BY_TYPE = {"tender": 95, "rfq": 90, "site_inquiry": 95, "buyer_intent": 70, "prospect": 40}


@dataclass
class ScoreInput:
    type: str
    product_match: int  # 0-100，由 LLM 判断（结合关键词命中校验）
    published_at: datetime | None
    deadline: datetime | None
    potential: int  # 0-100
    has_contact: bool
    has_bid_portal: bool
    source_trust: int  # 0-100
    now: datetime


def clamp(value: float) -> int:
    return max(0, min(100, round(value)))


def timeliness(published_at: datetime | None, deadline: datetime | None, now: datetime) -> int:
    if deadline is not None:
        days_left = (deadline - now).days
        if days_left < 0:
            return 0
        if days_left < 3:
            return 40  # 太近，来不及响应
        return 100 if days_left <= 45 else 80
    if published_at is None:
        return 50
    age = (now - published_at).days
    if age <= 7:
        return 100
    if age <= 30:
        return 75
    if age <= 90:
        return 40
    return 10


def score(data: ScoreInput) -> tuple[int, dict[str, int]]:
    detail = {
        "product_match": clamp(data.product_match),
        "intent": INTENT_BY_TYPE.get(data.type, 40),
        "timeliness": timeliness(data.published_at, data.deadline, data.now),
        "potential": clamp(data.potential),
        "reachability": 100 if data.has_contact else 70 if data.has_bid_portal else 20,
        "credibility": clamp(data.source_trust),
    }
    total = clamp(sum(detail[k] * w for k, w in WEIGHTS.items()))
    return total, detail


def confidence(product_match: int, keyword_hits: int, classification_confident: bool) -> str:
    if product_match >= 70 and keyword_hits >= 1 and classification_confident:
        return "high"
    if product_match >= 40:
        return "medium"
    return "low"


# ── 去重 ───────────────────────────────────────────────────────────────

_LEGAL = re.compile(
    r"\b(co|corp|corporation|inc|ltd|llc|gmbh|ag|sa|srl|spa|bv|nv|plc|limited|company|group|holding|the)\b\.?", re.I
)


def name_key(name: str) -> str:
    text = _LEGAL.sub(" ", name.lower())
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def registrable_domain(url_or_domain: str) -> str:
    host = urlsplit(url_or_domain if "://" in url_or_domain else f"//{url_or_domain}").hostname or ""
    host = host.lower().removeprefix("www.")
    parts = host.split(".")
    if len(parts) >= 3 and parts[-2] in {"co", "com", "org", "net", "gov", "ac", "edu"} and len(parts[-1]) == 2:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:]) if len(parts) >= 2 else host


def similar_names(a: str, b: str, threshold: float = 0.88) -> bool:
    ka, kb = name_key(a), name_key(b)
    if not ka or not kb:
        return False
    return ka == kb or SequenceMatcher(None, ka, kb).ratio() >= threshold


def dedupe_key(title: str, buyer: str, deadline: datetime | None) -> str:
    """同一采购需求的指纹：买家 + 标题主要词 + 截止日期。"""
    words = sorted({w for w in re.findall(r"[a-z0-9]{3,}", title.lower()) if w not in _STOP})[:8]
    parts = [name_key(buyer)[:60], " ".join(words)[:100], deadline.date().isoformat() if deadline else ""]
    return "|".join(parts)[:200]


_STOP = {
    "tender",
    "rfq",
    "supply",
    "for",
    "the",
    "and",
    "looking",
    "supplier",
    "request",
    "quotation",
    "with",
    "from",
    "notice",
    "procurement",
    "purchase",
    "of",
}


def same_requirement(a: dict[str, Any], b: dict[str, Any]) -> bool:
    """两条商机是否为同一采购需求：买家相同（域名或名称）且标题高度相似（或截止日期相同）。"""
    buyer_same = (a.get("domain") and a.get("domain") == b.get("domain")) or similar_names(
        a.get("buyer", ""), b.get("buyer", "")
    )
    if not buyer_same:
        return False
    if a.get("deadline") and a.get("deadline") == b.get("deadline"):
        return True
    ta = " ".join(sorted(set(re.findall(r"[a-z0-9]{3,}", a.get("title", "").lower())) - _STOP))
    tb = " ".join(sorted(set(re.findall(r"[a-z0-9]{3,}", b.get("title", "").lower())) - _STOP))
    return SequenceMatcher(None, ta, tb).ratio() >= 0.7
