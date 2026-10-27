"""测试数据工厂：直接写数据库，返回已 flush 的对象；`login()` 返回带认证头的字典。"""

from __future__ import annotations

import itertools
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any

from sqlalchemy.orm import Session

from app.core.db import utcnow
from app.core.security.crypto import hash_password, new_token, token_hash
from app.modules.auth.models import Session as UserSession
from app.modules.auth.models import User
from app.modules.companies.models import Asset, Company, CompanyMember, CompanyProfile, Product

_seq = itertools.count(1)
PASSWORD = "Passw0rd!"
_PASSWORD_HASH = hash_password(PASSWORD)


def make_user(db: Session, *, email: str | None = None, is_staff: bool = False, **kwargs: Any) -> User:
    n = next(_seq)
    user = User(
        email=email or f"user{n}@example.com",
        password_hash=_PASSWORD_HASH,
        name=kwargs.pop("name", f"用户{n}"),
        is_staff=is_staff,
        **kwargs,
    )
    db.add(user)
    db.flush()
    return user


def make_session(db: Session, user: User, *, days: int = 7) -> str:
    token = new_token()
    db.add(UserSession(user_id=user.id, token_hash=token_hash(token), expires_at=utcnow() + timedelta(days=days)))
    db.flush()
    return token


def make_company(db: Session, owner: User | None = None, *, name_cn: str | None = None, role: str = "owner") -> Company:
    n = next(_seq)
    company = Company(name_cn=name_cn or f"测试工厂{n}", name_en="")
    db.add(company)
    db.flush()
    db.add(CompanyProfile(company_id=company.id))
    if owner is not None:
        db.add(CompanyMember(company_id=company.id, user_id=owner.id, role=role))
    db.flush()
    return company


def add_member(db: Session, company: Company, user: User, role: str = "member") -> None:
    db.add(CompanyMember(company_id=company.id, user_id=user.id, role=role))
    db.flush()


def make_product(db: Session, company: Company, **kwargs: Any) -> Product:
    product = Product(company_id=company.id, name_en=kwargs.pop("name_en", f"Product {next(_seq)}"), **kwargs)
    db.add(product)
    db.flush()
    return product


def make_asset(db: Session, company: Company, *, kind: str = "image", mime: str = "image/png", text: str = "") -> Asset:
    n = next(_seq)
    asset = Asset(
        company_id=company.id,
        kind=kind,
        storage_key=f"{company.id}/{n:032x}",
        mime=mime,
        size=10,
        sha256="0" * 64,
        display_name=f"file{n}",
        text_content=text,
    )
    db.add(asset)
    db.flush()
    return asset


@dataclass
class Tenant:
    """一个完整的租户：所有者账号 + 企业 + 认证头。"""

    user: User
    company: Company
    token: str
    extra: dict[str, Any] = field(default_factory=dict)

    @property
    def headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}", "X-Company-Id": str(self.company.id)}

    @property
    def auth(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}"}

    def as_company(self, company: Company) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}", "X-Company-Id": str(company.id)}


def make_tenant(db: Session, *, role: str = "owner", is_staff: bool = False) -> Tenant:
    user = make_user(db, is_staff=is_staff)
    company = make_company(db, user, role=role)
    return Tenant(user=user, company=company, token=make_session(db, user))


def complete_profile(db: Session, company: Company, **overrides: Any) -> CompanyProfile:
    """填充一份完整度 ≥ 60% 的企业档案（官网生成的前置条件）。"""
    company.name_en = overrides.pop("name_en", "Demo Valve Co., Ltd.")
    profile = db.get(CompanyProfile, company.id)
    assert profile is not None
    values: dict[str, Any] = {
        "founded_year": 2008,
        "employees": "120",
        "factory_area": "15000 m²",
        "annual_capacity": "500,000 valves",
        "export_markets": ["Germany", "United States"],
        "certifications": ["ISO 9001", "CE"],
        "usp": "In-house casting and 100% pressure testing",
        "about_en": "Demo Valve manufactures stainless steel ball valves since 2008.",
        "contacts": {"email": "sales@demo-valve.example", "phone": "+86 574 0000 0000"},
        "main_customers_public": [],
    }
    values.update(overrides)
    for key, value in values.items():
        setattr(profile, key, value)
    db.flush()
    return profile
