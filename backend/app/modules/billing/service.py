"""套餐、订阅、用量限额（服务层统一检查）。

- 套餐与创业计划一致：建站版 / 获客版 / 代运营版；另有试用版（新企业默认 14 天）
- 限额按自然月（UTC）统计；limits 中 -1 或缺省表示不限
- 功能开关：site（官网）/ leads（商机监控）/ outreach（开发信与发信）/ managed（运营代复核）
- 超限抛出 QuotaExceededError（402），前端统一展示「升级」入口
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.db import utcnow
from app.core.errors import AppError
from app.modules.admin.models import Plan, Subscription, UsageRecord

TRIAL_DAYS = 14

DEFAULT_PLANS: list[dict[str, Any]] = [
    {
        "key": "trial",
        "name": "试用版",
        "description": "14 天体验：生成官网草稿、少量商机与开发信",
        "features": ["site", "leads", "outreach"],
        "limits": {"leads": 30, "llm_tokens": 300_000, "watch_runs": 30, "emails_sent": 20, "sites": 1},
        "price_cents": 0,
        "period": "month",
        "is_public": False,
    },
    {
        "key": "site",
        "name": "建站版",
        "description": "英文 B2B 官网生成与托管、询盘回流",
        "features": ["site"],
        "limits": {"leads": 0, "llm_tokens": 500_000, "watch_runs": 0, "emails_sent": 0, "sites": 1},
        "price_cents": 680_000,
        "setup_fee_cents": 980_000,
        "period": "year",
    },
    {
        "key": "growth",
        "name": "获客版",
        "description": "建站版 + 每日商机监控 + 开发信",
        "features": ["site", "leads", "outreach"],
        "limits": {"leads": 300, "llm_tokens": 3_000_000, "watch_runs": 120, "emails_sent": 600, "sites": 1},
        "price_cents": 199_900,
        "period": "month",
    },
    {
        "key": "managed",
        "name": "代运营版",
        "description": "获客版 + 运营人工复核与代跟进",
        "features": ["site", "leads", "outreach", "managed"],
        "limits": {"leads": 800, "llm_tokens": 8_000_000, "watch_runs": 300, "emails_sent": 1500, "sites": 1},
        "price_cents": 599_900,
        "period": "month",
    },
]

QUOTA_LABELS = {
    "leads": "本月商机",
    "llm_tokens": "本月 AI 用量",
    "watch_runs": "本月监控运行次数",
    "emails_sent": "本月发信数",
    "sites": "官网数量",
}
FEATURE_LABELS = {"site": "官网", "leads": "商机监控", "outreach": "开发信", "managed": "运营代复核"}


class QuotaExceededError(AppError):
    def __init__(self, message: str, *, kind: str, limit: int, used: int) -> None:
        super().__init__(
            message, code="quota_exceeded", status_code=402, details={"kind": kind, "limit": limit, "used": used}
        )


class FeatureUnavailableError(AppError):
    def __init__(self, feature: str) -> None:
        super().__init__(
            f"当前套餐不包含「{FEATURE_LABELS.get(feature, feature)}」，请升级套餐",
            code="feature_unavailable",
            status_code=402,
            details={"feature": feature},
        )


def ensure_plans(db: Session) -> None:
    """写入默认套餐（已存在的不覆盖，运营调整后的配置保留）。"""
    existing = set(db.scalars(select(Plan.key)).all())
    for item in DEFAULT_PLANS:
        if item["key"] not in existing:
            db.add(Plan(**item))
    db.flush()


def month_start(now: datetime | None = None) -> datetime:
    now = now or utcnow()
    return datetime(now.year, now.month, 1, tzinfo=UTC)


@dataclass
class Entitlement:
    plan: Plan
    subscription: Subscription | None
    expired: bool

    def limit(self, kind: str) -> int:
        overrides = self.subscription.limit_overrides if self.subscription else {}
        value = overrides.get(kind, self.plan.limits.get(kind, -1))
        return int(value)

    def has(self, feature: str) -> bool:
        return not self.expired and feature in self.plan.features


def current_subscription(db: Session, company_id: uuid.UUID, now: datetime | None = None) -> Subscription | None:
    now = now or utcnow()
    return db.scalar(
        select(Subscription)
        .where(Subscription.company_id == company_id, Subscription.status == "active", Subscription.starts_at <= now)
        .order_by(Subscription.ends_at.desc())
    )


def start_trial(db: Session, company_id: uuid.UUID) -> Subscription:
    ensure_plans(db)
    sub = Subscription(
        company_id=company_id,
        plan_key="trial",
        status="active",
        starts_at=utcnow(),
        ends_at=utcnow() + timedelta(days=TRIAL_DAYS),
        source="trial",
    )
    db.add(sub)
    db.flush()
    return sub


def entitlement(db: Session, company_id: uuid.UUID, now: datetime | None = None) -> Entitlement:
    """当前权益。没有任何订阅的企业（例如本计划之前创建的企业）自动开通试用。"""
    now = now or utcnow()
    sub = current_subscription(db, company_id, now)
    if sub is None:
        has_any = db.scalar(select(Subscription.id).where(Subscription.company_id == company_id).limit(1))
        if has_any is None:
            sub = start_trial(db, company_id)
    if sub is None:
        latest = db.scalar(
            select(Subscription).where(Subscription.company_id == company_id).order_by(Subscription.ends_at.desc())
        )
        ensure_plans(db)
        plan = db.get(Plan, latest.plan_key if latest else "trial")
        assert plan is not None
        return Entitlement(plan=plan, subscription=latest, expired=True)
    plan = db.get(Plan, sub.plan_key)
    if plan is None:  # pragma: no cover - 外键保证
        ensure_plans(db)
        plan = db.get(Plan, "trial")
        assert plan is not None
    return Entitlement(plan=plan, subscription=sub, expired=sub.ends_at <= now)


def used_this_month(db: Session, company_id: uuid.UUID, kind: str, now: datetime | None = None) -> int:
    if kind == "sites":
        from app.modules.sites.models import Site

        return db.scalar(select(func.count()).select_from(Site).where(Site.company_id == company_id)) or 0
    return int(
        db.scalar(
            select(func.coalesce(func.sum(UsageRecord.quantity), 0)).where(
                UsageRecord.company_id == company_id,
                UsageRecord.kind == kind,
                UsageRecord.created_at >= month_start(now),
            )
        )
        or 0
    )


def require_feature(db: Session, company_id: uuid.UUID, feature: str) -> Entitlement:
    ent = entitlement(db, company_id)
    if ent.expired:
        raise AppError("套餐已到期，请联系我们续费", code="subscription_expired", status_code=402)
    if not ent.has(feature):
        raise FeatureUnavailableError(feature)
    return ent


def check_quota(db: Session, company_id: uuid.UUID, kind: str, amount: int = 1) -> None:
    """再用 amount 个单位是否会超限；超限抛出 QuotaExceededError。"""
    ent = entitlement(db, company_id)
    if ent.expired:
        raise AppError("套餐已到期，请联系我们续费", code="subscription_expired", status_code=402)
    limit = ent.limit(kind)
    if limit < 0:
        return
    used = used_this_month(db, company_id, kind)
    if used + amount > limit:
        label = QUOTA_LABELS.get(kind, kind)
        message = (
            f"当前套餐不包含{label}，请升级套餐" if limit == 0 else f"{label}已达上限（{limit}），请升级套餐或下月再试"
        )
        raise QuotaExceededError(message, kind=kind, limit=limit, used=used)


def remaining(db: Session, company_id: uuid.UUID, kind: str) -> int | None:
    """剩余额度；None 表示不限。"""
    ent = entitlement(db, company_id)
    limit = ent.limit(kind)
    if limit < 0:
        return None
    return max(limit - used_this_month(db, company_id, kind), 0)


def usage_summary(db: Session, company_id: uuid.UUID) -> dict[str, Any]:
    ent = entitlement(db, company_id)
    items = []
    for kind, label in QUOTA_LABELS.items():
        limit = ent.limit(kind)
        items.append({"kind": kind, "label": label, "used": used_this_month(db, company_id, kind), "limit": limit})
    return {
        "plan": {"key": ent.plan.key, "name": ent.plan.name, "description": ent.plan.description},
        "features": ent.plan.features,
        "status": "expired" if ent.expired else "active",
        "source": ent.subscription.source if ent.subscription else "",
        "starts_at": ent.subscription.starts_at.isoformat() if ent.subscription else None,
        "ends_at": ent.subscription.ends_at.isoformat() if ent.subscription else None,
        "usage": items,
    }


def require_ai(db: Session, company_id: uuid.UUID, feature: str | None = None, estimate_tokens: int = 2_000) -> None:
    """调用 LLM 前的统一检查：套餐有效、（可选）包含功能、本月 AI 用量还有余量。

    estimate_tokens 为本次调用的预估用量（实际用量在调用后按真实 token 记录）。助手、官网生成 / 改写、
    资料抽取、开发信都经过这里，API 与助手工具共用同一道检查。
    """
    if feature is not None:
        require_feature(db, company_id, feature)
    check_quota(db, company_id, "llm_tokens", estimate_tokens)
