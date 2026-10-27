"""企业（租户）、成员、邀请、企业档案、产品、资料、AI 抽取记录。"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, IdMixin, TimestampMixin, utcnow

ROLES = ("owner", "member", "operator")


class Company(IdMixin, TimestampMixin, Base):
    __tablename__ = "companies"

    name_cn: Mapped[str] = mapped_column(String(100), nullable=False)
    name_en: Mapped[str] = mapped_column(String(150), nullable=False, default="")
    plan: Mapped[str] = mapped_column(String(32), nullable=False, default="trial")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")


class CompanyMember(TimestampMixin, Base):
    __tablename__ = "company_members"

    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True)
    role: Mapped[str] = mapped_column(String(16), nullable=False)


class Invite(IdMixin, TimestampMixin, Base):
    """一次性邀请链接；只存 token 哈希。"""

    __tablename__ = "invites"

    company_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False, default="member")
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    accepted_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class CompanyProfile(Base):
    __tablename__ = "company_profiles"

    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), primary_key=True)
    founded_year: Mapped[int | None] = mapped_column(Integer)
    employees: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    factory_area: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    annual_capacity: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    export_markets: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    certifications: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    main_customers_public: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    usp: Mapped[str] = mapped_column(Text, nullable=False, default="")
    about_en: Mapped[str] = mapped_column(Text, nullable=False, default="")
    contacts: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    # 每个字段的来源：{field: {source, extraction_id, at}}
    field_sources: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    completeness: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class Product(IdMixin, TimestampMixin, Base):
    __tablename__ = "products"

    company_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name_en: Mapped[str] = mapped_column(String(200), nullable=False)
    name_cn: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    category: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    hs_codes: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    specs: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    moq: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    lead_time: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    applications: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    keywords_en: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    images: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)  # asset id 列表
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="manual")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class Asset(IdMixin, TimestampMixin, Base):
    __tablename__ = "assets"
    __table_args__ = (UniqueConstraint("storage_key"),)

    company_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(16), nullable=False)  # image / pdf / certificate / catalog
    storage_key: Mapped[str] = mapped_column(String(200), nullable=False)
    mime: Mapped[str] = mapped_column(String(64), nullable=False)
    size: Mapped[int] = mapped_column(Integer, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    # 仅用于界面显示，不参与存储路径
    display_name: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    text_content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class ProfileExtraction(IdMixin, TimestampMixin, Base):
    """AI 抽取任务：结果是「待确认的变更」，用户确认后才合并到档案。"""

    __tablename__ = "profile_extractions"

    company_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    source: Mapped[str] = mapped_column(String(8), nullable=False)  # url / file / chat
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    input: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    progress: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    result: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    error: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
