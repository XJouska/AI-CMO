"""官网、版本、询盘、健康检查报告。"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, IdMixin, TimestampMixin, utcnow


class Site(IdMixin, TimestampMixin, Base):
    __tablename__ = "sites"

    company_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    template_key: Mapped[str] = mapped_column(String(32), nullable=False, default="industrial")
    # 网站风格：{layout, palette: {primary, accent, ink, bg}, font, radius, image}；见 sites/styles.py
    style: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft")  # draft/published/suspended
    subdomain: Mapped[str] = mapped_column(String(63), nullable=False, unique=True)
    custom_domain: Mapped[str | None] = mapped_column(String(253), unique=True)
    domain_token: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    domain_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    draft_version_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("site_versions.id", ondelete="SET NULL", use_alter=True)
    )
    published_version_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("site_versions.id", ondelete="SET NULL", use_alter=True)
    )
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # 后台任务状态：生成 / 改写 / 发布
    task_kind: Mapped[str] = mapped_column(String(16), nullable=False, default="")
    task_status: Mapped[str] = mapped_column(String(16), nullable=False, default="idle")  # idle/running/failed
    task_progress: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    task_error: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class SiteVersion(IdMixin, TimestampMixin, Base):
    __tablename__ = "site_versions"
    __table_args__ = (Index("ix_site_versions_site_created", "site_id", "created_at"),)

    site_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), nullable=False)
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    content: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    # 事实校验发现的「需确认」项：[{section, field, text, reason}]
    flags: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    note: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class SiteInquiry(IdMixin, TimestampMixin, Base):
    __tablename__ = "site_inquiries"
    __table_args__ = (
        Index("ix_site_inquiries_company_created", "company_id", "created_at"),
        Index("ix_site_inquiries_ip_created", "ip_hash", "created_at"),
    )

    site_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), nullable=False)
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    email: Mapped[str] = mapped_column(String(254), nullable=False)
    company_name: Mapped[str] = mapped_column(String(150), nullable=False, default="")
    country: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    message: Mapped[str] = mapped_column(Text, nullable=False)
    product_ref: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    ip_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    user_agent: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    spam_score: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="new")  # new/read/spam
    lead_id: Mapped[uuid.UUID | None] = mapped_column()  # 计划 05 关联商机


class SiteHealthReport(IdMixin, TimestampMixin, Base):
    __tablename__ = "site_health_reports"

    site_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sites.id", ondelete="CASCADE"), nullable=False, index=True)
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    score: Mapped[int] = mapped_column(Integer, nullable=False)
    issues: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)


class Notification(IdMixin, TimestampMixin, Base):
    """站内通知。user_id 为空表示发给企业全部成员。计划 07 扩展邮件 / 微信渠道。"""

    __tablename__ = "notifications"
    __table_args__ = (Index("ix_notifications_company_created", "company_id", "created_at"),)

    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    body: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    link: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    read_by: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
