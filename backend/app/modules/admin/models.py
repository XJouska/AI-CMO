"""运营后台、计费、通知、合规的数据模型。

- audit_logs：敏感操作审计（权限变更、数据导出、代客操作、发布官网、发送邮件、删除等）
- plans / subscriptions / usage_records / invoices / payment_orders：套餐与计费
- notification_prefs：用户通知开关；notification_deliveries：邮件 / 企业微信投递记录（失败重试）
- data_requests：联系人删除请求等合规工单
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, Integer, LargeBinary, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, IdMixin, TimestampMixin, utcnow


class AuditLog(IdMixin, TimestampMixin, Base):
    __tablename__ = "audit_logs"
    __table_args__ = (
        Index("ix_audit_logs_company_created", "company_id", "created_at"),
        Index("ix_audit_logs_actor_created", "actor_user_id", "created_at"),
    )

    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    company_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("companies.id", ondelete="SET NULL"))
    action: Mapped[str] = mapped_column(String(48), nullable=False)
    target_type: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    target_id: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    # 运营人员以 operator 身份代客操作时为 True（客户可在审计中看到「运营代操作」）
    on_behalf: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    detail: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    ip_hash: Mapped[str] = mapped_column(String(64), nullable=False, default="")


class Plan(TimestampMixin, Base):
    """套餐（可配置）。limits 中未出现的用量类型视为不限；-1 表示不限。"""

    __tablename__ = "plans"

    key: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    description: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    features: Mapped[list[str]] = mapped_column(
        JSONB, nullable=False, default=list
    )  # site / leads / outreach / managed
    limits: Mapped[dict[str, int]] = mapped_column(JSONB, nullable=False, default=dict)  # 按月
    price_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # 周期价格（人民币分）
    setup_fee_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    period: Mapped[str] = mapped_column(String(8), nullable=False, default="month")  # month / year
    is_public: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class Subscription(IdMixin, TimestampMixin, Base):
    __tablename__ = "subscriptions"
    __table_args__ = (Index("ix_subscriptions_company_status", "company_id", "status"),)

    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    plan_key: Mapped[str] = mapped_column(ForeignKey("plans.key"), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")  # active / expired / canceled
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="manual")  # trial / manual / online
    # 运营对单个客户的限额调整（覆盖套餐 limits）
    limit_overrides: Mapped[dict[str, int]] = mapped_column(JSONB, nullable=False, default=dict)
    note: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class UsageRecord(IdMixin, Base):
    """用量记录（计费限额 + 成本看板）。quantity 为数量；cost_micros 为估算成本（人民币百万分之一元）。"""

    __tablename__ = "usage_records"
    __table_args__ = (Index("ix_usage_records_company_kind_created", "company_id", "kind", "created_at"),)

    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    cost_micros: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    detail: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class Invoice(IdMixin, TimestampMixin, Base):
    __tablename__ = "invoices"
    __table_args__ = (UniqueConstraint("number"),)

    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    subscription_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("subscriptions.id", ondelete="SET NULL"))
    number: Mapped[str] = mapped_column(String(32), nullable=False)
    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="issued")  # issued / paid / void
    method: Mapped[str] = mapped_column(String(16), nullable=False, default="bank_transfer")
    period_start: Mapped[date | None] = mapped_column(Date)
    period_end: Mapped[date | None] = mapped_column(Date)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    note: Mapped[str] = mapped_column(String(300), nullable=False, default="")


class PaymentOrder(IdMixin, TimestampMixin, Base):
    """在线支付订单。金额以服务端订单为准；回调验签后按 provider_trade_no 幂等处理。"""

    __tablename__ = "payment_orders"
    __table_args__ = (UniqueConstraint("provider", "provider_trade_no"),)

    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    plan_key: Mapped[str] = mapped_column(ForeignKey("plans.key"), nullable=False)
    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    provider: Mapped[str] = mapped_column(String(16), nullable=False)
    provider_trade_no: Mapped[str | None] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")  # pending / paid / failed
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class NotificationPref(Base):
    """用户在某企业下的通知开关：{kind: {channel: bool}}。未设置时使用默认值。"""

    __tablename__ = "notification_prefs"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), primary_key=True)
    prefs: Mapped[dict[str, dict[str, bool]]] = mapped_column(JSONB, nullable=False, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class NotificationDelivery(IdMixin, TimestampMixin, Base):
    """站外渠道投递记录。同一 (notification, user, channel) 只投递一次。"""

    __tablename__ = "notification_deliveries"
    __table_args__ = (UniqueConstraint("notification_id", "user_id", "channel"),)

    notification_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("notifications.id", ondelete="CASCADE"))
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    channel: Mapped[str] = mapped_column(String(16), nullable=False)  # email / wecom
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="queued"
    )  # queued / sent / failed / skipped
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class DataRequest(IdMixin, TimestampMixin, Base):
    """合规工单：联系人删除请求（买家来信要求删除其公开联系方式）等。"""

    __tablename__ = "data_requests"

    kind: Mapped[str] = mapped_column(String(24), nullable=False)  # contact_erasure
    email: Mapped[str] = mapped_column(String(254), nullable=False)
    note: Mapped[str] = mapped_column(Text, nullable=False, default="")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="open")  # open / done / rejected
    result: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    handled_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    handled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ip_hash: Mapped[str] = mapped_column(String(64), nullable=False, default="")


class EvalRun(IdMixin, TimestampMixin, Base):
    """评测运行记录（运营后台查看指标趋势）。"""

    __tablename__ = "eval_runs"

    dataset: Mapped[str] = mapped_column(String(80), nullable=False)
    mode: Mapped[str] = mapped_column(
        String(8), nullable=False, default="rules"
    )  # rules（规则化分析器）/ live（真实 LLM）
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="queued")  # queued / done / failed
    metrics: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    error: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class CompanyChannel(TimestampMixin, Base):
    """企业级通知渠道（企业微信群机器人）。Webhook 含密钥，加密存储，接口只返回是否已配置。"""

    __tablename__ = "company_channels"

    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), primary_key=True)
    channel: Mapped[str] = mapped_column(String(16), primary_key=True)  # wecom
    encrypted_config: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)


class WorkerHeartbeat(Base):
    """worker 心跳（每分钟更新）：/health 与告警检查据此判断 worker 是否存活。"""

    __tablename__ = "worker_heartbeats"

    worker_id: Mapped[str] = mapped_column(String(100), primary_key=True)
    beat_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
