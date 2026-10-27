"""商机情报：监控计划、运行记录、信号、买家、商机、反馈、数据源配置。"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, IdMixin, TimestampMixin, utcnow


class Watch(IdMixin, TimestampMixin, Base):
    """监控计划：一组产品 + 目标市场 + 关键词 + 数据源 + 频率。"""

    __tablename__ = "watches"

    company_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    product_ids: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    markets: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    keywords_en: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    negative_keywords: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    source_keys: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    frequency: Mapped[str] = mapped_column(String(16), nullable=False, default="daily")  # daily / weekly
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    next_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")  # draft / active


class WatchRun(IdMixin, TimestampMixin, Base):
    __tablename__ = "watch_runs"

    watch_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("watches.id", ondelete="CASCADE"), nullable=False, index=True
    )
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="queued")  # queued/running/done/failed
    trigger: Mapped[str] = mapped_column(String(16), nullable=False, default="schedule")  # schedule / manual
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    stats: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    error: Mapped[str] = mapped_column(String(300), nullable=False, default="")


class Signal(IdMixin, Base):
    """数据源抓到的一条原始记录。同一企业内按 url_hash 去重。"""

    __tablename__ = "signals"
    __table_args__ = (UniqueConstraint("company_id", "url_hash"),)

    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    watch_run_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("watch_runs.id", ondelete="SET NULL"))
    source_key: Mapped[str] = mapped_column(String(32), nullable=False)
    url: Mapped[str] = mapped_column(String(2048), nullable=False)
    url_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    snippet: Mapped[str] = mapped_column(Text, nullable=False, default="")
    raw: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    classification: Mapped[str] = mapped_column(String(16), nullable=False, default="")  # tender/rfq/... / irrelevant


class Buyer(IdMixin, TimestampMixin, Base):
    """采购组织（跨商机复用，按企业隔离：不同客户的买家数据互不可见）。"""

    __tablename__ = "buyers"
    __table_args__ = (Index("ix_buyers_company_domain", "company_id", "domain"),)

    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    name_key: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    domain: Mapped[str] = mapped_column(String(253), nullable=False, default="")
    country: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    industry: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    size_hint: Mapped[str] = mapped_column(String(60), nullable=False, default="")
    public_contacts: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    sources: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    enriched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Lead(IdMixin, TimestampMixin, Base):
    __tablename__ = "leads"
    __table_args__ = (
        Index("ix_leads_company_review_created", "company_id", "review_status", "created_at"),
        Index("ix_leads_company_dedupe", "company_id", "dedupe_key"),
    )

    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    buyer_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("buyers.id", ondelete="SET NULL"))
    watch_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("watches.id", ondelete="SET NULL"))
    type: Mapped[str] = mapped_column(String(16), nullable=False)  # tender/rfq/buyer_intent/prospect/site_inquiry
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    summary_cn: Mapped[str] = mapped_column(Text, nullable=False, default="")
    reasons: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    suggested_action: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    products_matched: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    market: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    score: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    score_detail: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    confidence: Mapped[str] = mapped_column(String(8), nullable=False, default="medium")  # high / medium / low
    deadline: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    source_url: Mapped[str] = mapped_column(String(2048), nullable=False, default="")
    dedupe_key: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="new")  # 跟进阶段（计划 06 扩展）
    review_status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    reviewer_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    seen_by: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class LeadSignal(Base):
    __tablename__ = "lead_signals"

    lead_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"), primary_key=True)
    signal_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("signals.id", ondelete="CASCADE"), primary_key=True)


class LeadFeedback(IdMixin, TimestampMixin, Base):
    __tablename__ = "lead_feedback"
    __table_args__ = (UniqueConstraint("lead_id", "user_id"),)

    lead_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"), nullable=False)
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    verdict: Mapped[str] = mapped_column(String(16), nullable=False)  # useful / irrelevant / duplicate / fake
    note: Mapped[str] = mapped_column(String(500), nullable=False, default="")


class SourceConfig(Base):
    """数据源配置（全局，由运营维护）：启用状态、速率限制、条款依据。"""

    __tablename__ = "source_configs"

    source_key: Mapped[str] = mapped_column(String(32), primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    rate_limit_per_minute: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    terms_note: Mapped[str] = mapped_column(Text, nullable=False, default="")
    requires_api_key: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class SourceRequest(IdMixin, Base):
    """数据源请求记录：用于速率限制与运营监控（成功率、耗时）。"""

    __tablename__ = "source_requests"
    __table_args__ = (Index("ix_source_requests_key_created", "source_key", "created_at"),)

    source_key: Mapped[str] = mapped_column(String(32), nullable=False)
    company_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("companies.id", ondelete="SET NULL"))
    ok: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    results: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
