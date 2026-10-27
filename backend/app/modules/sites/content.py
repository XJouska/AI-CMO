"""官网内容结构（每个分区一个 Pydantic 模型）与事实校验。

事实约束（plans/04 4.1）：生成内容中的数字、证书、客户名只能来自档案；不在档案中的标记为「需确认」。
证书、联系方式、工厂数据等分区直接从档案取值，不交给 LLM 生成。
"""

from __future__ import annotations

import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

SECTION_KEYS = ("hero", "about", "products", "factory", "certificates", "markets", "cases", "faq", "contact")
SectionKey = Literal["hero", "about", "products", "factory", "certificates", "markets", "cases", "faq", "contact"]
TEMPLATES = ("industrial", "building", "consumer")


class _Model(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)


def _short(limit: int) -> Any:
    return Field(default="", max_length=limit)


class Hero(_Model):
    headline: str = _short(120)
    subheadline: str = _short(300)
    cta: str = Field(default="Request a Quote", max_length=40)


class About(_Model):
    title: str = Field(default="About Us", max_length=80)
    body: str = _short(3000)  # 富文本：发布时经 nh3 白名单清洗
    highlights: list[str] = Field(default_factory=list, max_length=6)


class ProductItem(_Model):
    product_id: str = ""
    name: str = Field(max_length=200)
    summary: str = _short(600)
    image_asset_id: str = ""
    keywords: list[str] = Field(default_factory=list, max_length=10)


class Products(_Model):
    title: str = Field(default="Our Products", max_length=80)
    items: list[ProductItem] = Field(default_factory=list, max_length=30)


class Stat(_Model):
    label: str = Field(max_length=60)
    value: str = Field(max_length=60)


class Factory(_Model):
    title: str = Field(default="Our Factory", max_length=80)
    body: str = _short(2000)
    stats: list[Stat] = Field(default_factory=list, max_length=6)
    image_asset_ids: list[str] = Field(default_factory=list, max_length=8)


class Certificates(_Model):
    title: str = Field(default="Certifications", max_length=80)
    items: list[str] = Field(default_factory=list, max_length=30)
    image_asset_ids: list[str] = Field(default_factory=list, max_length=12)


class Markets(_Model):
    title: str = Field(default="Export Markets", max_length=80)
    items: list[str] = Field(default_factory=list, max_length=50)


class Case(_Model):
    title: str = Field(max_length=120)
    body: str = _short(800)


class Cases(_Model):
    title: str = Field(default="Customers & Projects", max_length=80)
    items: list[Case] = Field(default_factory=list, max_length=10)


class FaqItem(_Model):
    q: str = Field(max_length=200)
    a: str = Field(max_length=1000)  # 富文本：发布时清洗


class Faq(_Model):
    title: str = Field(default="FAQ", max_length=80)
    items: list[FaqItem] = Field(default_factory=list, max_length=12)


class Contact(_Model):
    title: str = Field(default="Contact Us", max_length=80)
    email: str = _short(200)
    phone: str = _short(200)
    whatsapp: str = _short(200)
    address: str = _short(300)


class Seo(_Model):
    title: str = _short(70)
    description: str = _short(200)
    keywords: list[str] = Field(default_factory=list, max_length=20)


class SiteContent(_Model):
    company_name: str = Field(default="", max_length=150)
    hero: Hero = Field(default_factory=Hero)
    about: About = Field(default_factory=About)
    products: Products = Field(default_factory=Products)
    factory: Factory = Field(default_factory=Factory)
    certificates: Certificates = Field(default_factory=Certificates)
    markets: Markets = Field(default_factory=Markets)
    cases: Cases = Field(default_factory=Cases)
    faq: Faq = Field(default_factory=Faq)
    contact: Contact = Field(default_factory=Contact)
    seo: Seo = Field(default_factory=Seo)

    @field_validator("company_name")
    @classmethod
    def _name(cls, value: str) -> str:
        return value[:150]


SECTION_MODELS: dict[str, type[_Model]] = {
    "hero": Hero,
    "about": About,
    "products": Products,
    "factory": Factory,
    "certificates": Certificates,
    "markets": Markets,
    "cases": Cases,
    "faq": Faq,
    "contact": Contact,
    "seo": Seo,
}


# ── 事实校验 ───────────────────────────────────────────────────────────

_NUMBER = re.compile(
    r"(?<![\w.])(\d[\d,]*(?:\.\d+)?)\s*(%|\+|years?|employees?|m²|sqm|square\s+meters|pcs|units)?", re.I
)
_CERT = re.compile(
    r"\b(ISO\s?\d{4,5}(?::\d{4})?|CE|FDA|RoHS|REACH|UL|API\s?6D|API\s?\d+[A-Z]*|SGS|BSCI|TÜV|TUV|"
    r"WRAS|NSF|CSA|GS|KC|PSE|CCC|BRC|HACCP|GMP|IATF\s?16949)\b"
)


def _normalize_number(raw: str) -> str:
    return raw.replace(",", "")


def known_facts(profile: dict[str, Any], products: list[dict[str, Any]]) -> dict[str, set[str]]:
    """从档案与产品中收集「已知事实」：数字、证书、客户名。"""
    texts: list[str] = []
    for key in ("employees", "factory_area", "annual_capacity", "usp", "about_en"):
        texts.append(str(profile.get(key) or ""))
    if profile.get("founded_year"):
        texts.append(str(profile["founded_year"]))
    for product in products:
        texts.extend(str(product.get(k) or "") for k in ("moq", "lead_time", "name_en"))
        texts.extend(str(v) for v in (product.get("specs") or {}).values())
        texts.extend(product.get("hs_codes") or [])
    numbers = {_normalize_number(m.group(1)) for text in texts for m in _NUMBER.finditer(text)}
    if profile.get("founded_year"):
        # 「成立 N 年」类表述允许由成立年份推算
        from datetime import UTC, datetime

        numbers.add(str(datetime.now(UTC).year - int(profile["founded_year"])))
    certs = {_canon_cert(c) for c in profile.get("certifications") or []}
    for text in texts:
        certs.update(_canon_cert(m.group(1)) for m in _CERT.finditer(text))
    customers = {c.strip().lower() for c in profile.get("main_customers_public") or [] if c.strip()}
    return {"numbers": numbers, "certs": certs, "customers": customers}


def _canon_cert(value: str) -> str:
    return re.sub(r"\s+", "", value).upper()


def _iter_texts(content: SiteContent) -> list[tuple[str, str, str]]:
    """(section, field, text)：只检查 LLM 生成的自由文本；档案直出的分区不检查。"""
    out: list[tuple[str, str, str]] = [
        ("hero", "headline", content.hero.headline),
        ("hero", "subheadline", content.hero.subheadline),
        ("about", "body", content.about.body),
        ("factory", "body", content.factory.body),
        ("seo", "description", content.seo.description),
    ]
    out += [("about", f"highlights.{i}", h) for i, h in enumerate(content.about.highlights)]
    out += [("products", f"items.{i}.summary", p.summary) for i, p in enumerate(content.products.items)]
    out += [("faq", f"items.{i}.a", item.a) for i, item in enumerate(content.faq.items)]
    for i, case in enumerate(content.cases.items):
        out += [("cases", f"items.{i}.title", case.title), ("cases", f"items.{i}.body", case.body)]
    return out


def fact_check(content: SiteContent, facts: dict[str, set[str]]) -> list[dict[str, str]]:
    flags: list[dict[str, str]] = []
    for section, field, text in _iter_texts(content):
        plain = re.sub(r"<[^>]+>", " ", text)
        for match in _CERT.finditer(plain):
            if _canon_cert(match.group(1)) not in facts["certs"]:
                flags.append(
                    {"section": section, "field": field, "text": match.group(1), "reason": "证书不在企业档案中"}
                )
        # 证书编号中的数字（如 ISO 9001）不作为数字事实检查
        numbers_only = _CERT.sub(" ", plain)
        for match in _NUMBER.finditer(numbers_only):
            number = _normalize_number(match.group(1))
            if len(number) <= 1 and not match.group(2):  # 单个数字（如 "1 stop"）不视为事实
                continue
            if number not in facts["numbers"]:
                flags.append(
                    {"section": section, "field": field, "text": match.group(0).strip(), "reason": "数字不在企业档案中"}
                )
        for match in _CERT.finditer(plain):
            if _canon_cert(match.group(1)) not in facts["certs"]:
                flags.append(
                    {"section": section, "field": field, "text": match.group(1), "reason": "证书不在企业档案中"}
                )
    for i, case in enumerate(content.cases.items):
        if not any(customer in (case.title + " " + case.body).lower() for customer in facts["customers"]):
            flags.append(
                {
                    "section": "cases",
                    "field": f"items.{i}",
                    "text": case.title,
                    "reason": "客户名称不在档案的公开合作客户中",
                }
            )
    unique: dict[tuple[str, str, str], dict[str, str]] = {}
    for flag in flags:
        unique.setdefault((flag["section"], flag["field"], flag["text"]), flag)
    return list(unique.values())
