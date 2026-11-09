"""触达与跟进：跟进阶段、跟进记录、开发信草稿、发信邮箱、屏蔽名单、周报。"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, Integer, LargeBinary, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, IdMixin, TimestampMixin, utcnow


class LeadPipeline(TimestampMixin, Base):
    """一条商机的跟进状态（与商机一对一，首次推进时创建）。"""

    __tablename__ = "lead_pipeline"
    __table_args__ = (Index("ix_lead_pipeline_company_next", "company_id", "next_action_at"),)

    lead_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"), primary_key=True)
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    stage: Mapped[str] = mapped_column(String(16), nullable=False, default="new")
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    next_action: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    next_action_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # 已为当前 next_action_at 发过提醒（修改时间后清空）
    next_action_notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    lost_reason: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    deal_value: Mapped[int | None] = mapped_column(Integer)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="USD")
    # 招标截止提醒：已提醒过的档位（"7" / "3"）
    deadline_alerts: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class LeadActivity(IdMixin, TimestampMixin, Base):
    __tablename__ = "lead_activities"
    __table_args__ = (Index("ix_lead_activities_lead_created", "lead_id", "created_at"),)

    lead_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"), nullable=False)
    company_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    kind: Mapped[str] = mapped_column(String(16), nullable=False)  # note/email_draft/email_sent/reply/call/stage_change
    content: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)


class OutreachDraft(IdMixin, TimestampMixin, Base):
    __tablename__ = "outreach_drafts"
    __table_args__ = (Index("ix_outreach_drafts_lead_created", "lead_id", "created_at"),)

    lead_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"), nullable=False)
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    channel: Mapped[str] = mapped_column(String(24), nullable=False, default="email")
    tone: Mapped[str] = mapped_column(String(16), nullable=False, default="professional")  # concise/professional/warm
    language: Mapped[str] = mapped_column(String(8), nullable=False, default="en")
    to_email: Mapped[str] = mapped_column(String(254), nullable=False, default="")
    subject: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    body: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # 中文对照（给老板看懂自己发出去的内容；不发送）
    subject_zh: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    body_zh: Mapped[str] = mapped_column(Text, nullable=False, default="")
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft")  # draft / approved / sent
    flags: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)  # 事实校验结果
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class MailAccount(IdMixin, TimestampMixin, Base):
    """绑定的发信邮箱。凭据用应用级密钥加密（Fernet），接口永不返回明文。"""

    __tablename__ = "mail_accounts"

    company_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("companies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    provider: Mapped[str] = mapped_column(String(16), nullable=False, default="smtp")
    from_address: Mapped[str] = mapped_column(String(254), nullable=False)
    from_name: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    encrypted_credentials: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    daily_limit: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    last_error: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    dns_hints: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)  # SPF / DMARC 检查结果


class EmailSuppression(TimestampMixin, Base):
    __tablename__ = "email_suppressions"

    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), primary_key=True)
    email: Mapped[str] = mapped_column(String(254), primary_key=True)
    reason: Mapped[str] = mapped_column(String(32), nullable=False, default="manual")  # unsubscribe/bounce/manual


class WeeklyReport(IdMixin, TimestampMixin, Base):
    __tablename__ = "weekly_reports"
    __table_args__ = (UniqueConstraint("company_id", "week_start"),)

    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    week_start: Mapped[date] = mapped_column(Date, nullable=False)  # 统计周的周一（UTC）
    stats: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    markdown: Mapped[str] = mapped_column(Text, nullable=False, default="")
