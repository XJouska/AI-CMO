"""企业档案：字段定义、完整度计算、变更合并（记录字段来源）。

完整度按「官网生成和商机匹配所需字段」加权，总分 100。
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import utcnow
from app.modules.companies.models import Company, CompanyProfile, Product

LIST_FIELDS = ("export_markets", "certifications", "main_customers_public")
TEXT_FIELDS = ("employees", "factory_area", "annual_capacity", "usp", "about_en")
CONTACT_FIELDS = ("email", "phone", "whatsapp", "address", "website")
PRODUCT_FIELDS = (
    "name_en",
    "name_cn",
    "category",
    "hs_codes",
    "moq",
    "lead_time",
    "applications",
    "keywords_en",
)


@dataclass(frozen=True)
class CompletenessItem:
    key: str
    label: str
    weight: int
    section: str  # 前端跳转目标：basic / market / certs / story / contacts / products


COMPLETENESS_ITEMS: tuple[CompletenessItem, ...] = (
    CompletenessItem("name_en", "英文公司名", 8, "basic"),
    CompletenessItem("founded_year", "成立年份", 4, "basic"),
    CompletenessItem("employees", "员工人数", 4, "basic"),
    CompletenessItem("factory_area", "工厂面积", 4, "basic"),
    CompletenessItem("annual_capacity", "年产能", 6, "basic"),
    CompletenessItem("export_markets", "出口市场", 8, "market"),
    CompletenessItem("certifications", "资质认证", 8, "certs"),
    CompletenessItem("usp", "核心优势", 8, "story"),
    CompletenessItem("about_en", "英文公司介绍", 10, "story"),
    CompletenessItem("contacts", "联系方式（邮箱或电话）", 10, "contacts"),
    CompletenessItem("products", "至少一个产品", 15, "products"),
    CompletenessItem("product_keywords", "产品英文关键词", 8, "products"),
    CompletenessItem("product_images", "产品图片", 7, "products"),
)
assert sum(item.weight for item in COMPLETENESS_ITEMS) == 100


def _filled(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, list | dict):
        return bool(value)
    return True


def compute_completeness(
    company: Company, profile: CompanyProfile, products: list[Product]
) -> tuple[int, list[CompletenessItem]]:
    checks = {
        "name_en": _filled(company.name_en),
        "founded_year": profile.founded_year is not None,
        "employees": _filled(profile.employees),
        "factory_area": _filled(profile.factory_area),
        "annual_capacity": _filled(profile.annual_capacity),
        "export_markets": _filled(profile.export_markets),
        "certifications": _filled(profile.certifications),
        "usp": _filled(profile.usp),
        "about_en": _filled(profile.about_en),
        "contacts": _filled((profile.contacts or {}).get("email"))
        or _filled((profile.contacts or {}).get("phone")),
        "products": bool(products),
        "product_keywords": any(_filled(p.keywords_en) for p in products),
        "product_images": any(_filled(p.images) for p in products),
    }
    score = sum(item.weight for item in COMPLETENESS_ITEMS if checks[item.key])
    missing = [item for item in COMPLETENESS_ITEMS if not checks[item.key]]
    return score, missing


def get_or_create_profile(db: Session, company_id: uuid.UUID) -> CompanyProfile:
    profile = db.get(CompanyProfile, company_id)
    if profile is None:
        profile = CompanyProfile(company_id=company_id)
        db.add(profile)
        db.flush()
    return profile


def refresh_completeness(db: Session, company: Company) -> tuple[int, list[CompletenessItem]]:
    profile = get_or_create_profile(db, company.id)
    products = list(db.scalars(select(Product).where(Product.company_id == company.id)))
    score, missing = compute_completeness(company, profile, products)
    profile.completeness = score
    return score, missing


def record_source(profile: CompanyProfile, field: str, source: str, extraction_id: str | None = None) -> None:
    sources = dict(profile.field_sources or {})
    sources[field] = {"source": source, "extraction_id": extraction_id, "at": utcnow().isoformat()}
    profile.field_sources = sources


def apply_profile_fields(
    company: Company,
    profile: CompanyProfile,
    fields: dict[str, Any],
    *,
    source: str,
    extraction_id: str | None = None,
) -> list[str]:
    """把字段写入企业 / 档案，并记录来源。返回实际修改的字段名。"""
    changed: list[str] = []
    for field, value in fields.items():
        if field == "name_en":
            if company.name_en != value:
                company.name_en = value
                changed.append(field)
        elif field == "founded_year":
            if profile.founded_year != value:
                profile.founded_year = value
                changed.append(field)
        elif field in TEXT_FIELDS or field in LIST_FIELDS:
            if getattr(profile, field) != value:
                setattr(profile, field, value)
                changed.append(field)
        elif field.startswith("contacts."):
            key = field.split(".", 1)[1]
            if key not in CONTACT_FIELDS:
                continue
            contacts = dict(profile.contacts or {})
            if contacts.get(key) != value:
                contacts[key] = value
                profile.contacts = contacts
                changed.append(field)
        else:
            continue
        record_source(profile, field, source, extraction_id)
    if changed:
        profile.updated_at = utcnow()
    return changed
