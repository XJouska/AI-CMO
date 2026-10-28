"""套餐与用量接口。

客户：查看套餐、本月用量、发票；（可选）发起在线支付。
运营（staff）：手工开通 / 续期 / 调整限额、开具发票、确认对公转账到账。
支付回调：公开接口，验签 + 金额校验 + 幂等。
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta
from typing import Any, Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.db import get_db, utcnow
from app.core.deps import MANAGER_ROLES, CompanyScope, current_company, require_role, require_staff
from app.core.errors import AppError, NotFoundError
from app.modules.admin.audit import audit
from app.modules.admin.models import Invoice, PaymentOrder, Plan, Subscription
from app.modules.auth.models import User
from app.modules.billing import service
from app.modules.billing.payments import gateways
from app.modules.companies.models import Company

router = APIRouter(tags=["billing"])


class PlanOut(BaseModel):
    key: str
    name: str
    description: str
    features: list[str]
    limits: dict[str, int]
    price_cents: int
    setup_fee_cents: int
    period: str


def plan_out(p: Plan) -> PlanOut:
    return PlanOut(
        key=p.key,
        name=p.name,
        description=p.description,
        features=p.features,
        limits=p.limits,
        price_cents=p.price_cents,
        setup_fee_cents=p.setup_fee_cents,
        period=p.period,
    )


@router.get("/billing/plans", response_model=list[PlanOut])
def list_plans(scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)) -> list[PlanOut]:
    service.ensure_plans(db)
    db.commit()
    return [plan_out(p) for p in db.scalars(select(Plan).where(Plan.is_public.is_(True)).order_by(Plan.price_cents))]


class UsageOut(BaseModel):
    plan: dict[str, str]
    features: list[str]
    status: str
    source: str
    starts_at: str | None
    ends_at: str | None
    usage: list[dict[str, Any]]


@router.get("/billing/usage", response_model=UsageOut)
def get_usage(scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)) -> UsageOut:
    summary = service.usage_summary(db, scope.company_id)
    db.commit()
    return UsageOut(**summary)


class InvoiceOut(BaseModel):
    id: str
    number: str
    amount_cents: int
    status: str
    method: str
    period_start: str | None
    period_end: str | None
    paid_at: str | None
    created_at: str


def invoice_out(i: Invoice) -> InvoiceOut:
    return InvoiceOut(
        id=str(i.id),
        number=i.number,
        amount_cents=i.amount_cents,
        status=i.status,
        method=i.method,
        period_start=i.period_start.isoformat() if i.period_start else None,
        period_end=i.period_end.isoformat() if i.period_end else None,
        paid_at=i.paid_at.isoformat() if i.paid_at else None,
        created_at=i.created_at.isoformat(),
    )


@router.get("/billing/invoices", response_model=list[InvoiceOut])
def list_invoices(scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)) -> list[InvoiceOut]:
    rows = db.scalars(
        select(Invoice).where(Invoice.company_id == scope.company_id).order_by(Invoice.created_at.desc()).limit(50)
    ).all()
    return [invoice_out(i) for i in rows]


# ── 在线支付（可选；金额以服务端订单为准）────────────────────────────


class CheckoutIn(BaseModel):
    plan_key: str = Field(max_length=32)
    provider: str = Field(max_length=16)


class CheckoutOut(BaseModel):
    order_id: str
    amount_cents: int
    pay_url: str


@router.post("/billing/checkout", response_model=CheckoutOut, status_code=201)
def checkout(
    body: CheckoutIn, scope: CompanyScope = Depends(require_role(*MANAGER_ROLES)), db: Session = Depends(get_db)
) -> CheckoutOut:
    gateway = gateways().get(body.provider)
    if gateway is None:
        raise AppError("暂不支持在线支付，请联系我们对公转账开通", code="payment_unavailable")
    service.ensure_plans(db)
    plan = db.get(Plan, body.plan_key)
    if plan is None or not plan.is_public or plan.price_cents <= 0:
        raise NotFoundError("套餐不存在")
    order = PaymentOrder(
        company_id=scope.company_id,
        plan_key=plan.key,
        amount_cents=plan.price_cents,
        provider=gateway.name,
        created_by=scope.user.id,
    )
    db.add(order)
    db.flush()
    db.commit()
    return CheckoutOut(
        order_id=str(order.id),
        amount_cents=order.amount_cents,
        pay_url=gateway.checkout_url(str(order.id), order.amount_cents, plan.name),
    )


def _period(plan: Plan) -> timedelta:
    return timedelta(days=365) if plan.period == "year" else timedelta(days=31)


def activate(
    db: Session,
    company_id: uuid.UUID,
    plan: Plan,
    *,
    ends_at: datetime | None,
    source: str,
    actor: uuid.UUID | None,
    note: str = "",
    limit_overrides: dict[str, int] | None = None,
) -> Subscription:
    """开通 / 续期：结束当前订阅，新订阅从现在开始；续期同套餐时从原到期日顺延。"""
    now = utcnow()
    current = service.current_subscription(db, company_id, now)
    start = now
    if current is not None:
        if current.plan_key == plan.key and current.ends_at > now and ends_at is None:
            start = current.ends_at
        current.status = "canceled" if current.plan_key != plan.key else "expired"
    sub = Subscription(
        company_id=company_id,
        plan_key=plan.key,
        status="active",
        starts_at=now,  # 立即生效；续期时到期日从原到期日顺延
        ends_at=ends_at or (start + _period(plan)),
        source=source,
        limit_overrides=limit_overrides or {},
        note=note,
        created_by=actor,
    )
    db.add(sub)
    db.flush()
    return sub


@router.post("/public/payments/{provider}/notify")
async def payment_notify(provider: str, request: Request, db: Session = Depends(get_db)) -> dict[str, str]:
    gateway = gateways().get(provider)
    if gateway is None:
        raise NotFoundError("支付渠道不存在")
    body = await request.body()
    if len(body) > 16_384:
        raise AppError("请求过大", code="payload_too_large", status_code=413)
    try:
        notice = gateway.parse_notice(body, {k.lower(): v for k, v in request.headers.items()})
    except (ValueError, KeyError, TypeError) as exc:
        raise AppError("签名无效", code="bad_signature", status_code=400) from exc
    try:
        order_id = uuid.UUID(notice.order_id)
    except ValueError as exc:
        raise NotFoundError("订单不存在") from exc
    order = db.scalar(select(PaymentOrder).where(PaymentOrder.id == order_id).with_for_update())
    if order is None or order.provider != gateway.name:
        raise NotFoundError("订单不存在")
    if order.status == "paid":
        # 幂等：重复通知直接返回成功（无论 trade_no 是否相同，订单只生效一次）
        return {"status": "ok"}
    if not notice.paid:
        order.status = "failed"
        db.commit()
        return {"status": "ok"}
    if notice.amount_cents != order.amount_cents:
        audit(
            db,
            "payment.amount_mismatch",
            actor_id=None,
            company_id=order.company_id,
            target_type="payment_order",
            target_id=order.id,
            detail={"expected": order.amount_cents, "got": notice.amount_cents},
        )
        db.commit()
        raise AppError("金额不一致", code="amount_mismatch", status_code=400)
    plan = db.get(Plan, order.plan_key)
    assert plan is not None
    order.status, order.provider_trade_no, order.paid_at = "paid", notice.trade_no, utcnow()
    sub = activate(db, order.company_id, plan, ends_at=None, source="online", actor=None)
    db.add(
        Invoice(
            company_id=order.company_id,
            subscription_id=sub.id,
            number=_invoice_number(db),
            amount_cents=order.amount_cents,
            status="paid",
            method=gateway.name,
            period_start=sub.starts_at.date(),
            period_end=sub.ends_at.date(),
            paid_at=order.paid_at,
        )
    )
    audit(
        db,
        "payment.paid",
        actor_id=None,
        company_id=order.company_id,
        target_type="payment_order",
        target_id=order.id,
        detail={"plan": plan.key, "amount_cents": order.amount_cents, "trade_no": notice.trade_no},
    )
    db.commit()
    return {"status": "ok"}


def _invoice_number(db: Session) -> str:
    today = utcnow().strftime("%Y%m%d")
    count = db.scalar(select(func.count()).select_from(Invoice).where(Invoice.number.like(f"INV{today}%"))) or 0
    return f"INV{today}{count + 1:04d}"


# ── 运营：手工开通、发票 ───────────────────────────────────────────────


class ActivateIn(BaseModel):
    plan_key: str = Field(max_length=32)
    ends_at: date | None = None
    limit_overrides: dict[str, int] = Field(default_factory=dict)
    note: str = Field(default="", max_length=300)
    invoice_amount_cents: int | None = Field(default=None, ge=0, le=100_000_000)


class SubscriptionOut(BaseModel):
    id: str
    plan_key: str
    status: str
    starts_at: str
    ends_at: str
    source: str
    limit_overrides: dict[str, int]
    note: str


def subscription_out(s: Subscription) -> SubscriptionOut:
    return SubscriptionOut(
        id=str(s.id),
        plan_key=s.plan_key,
        status=s.status,
        starts_at=s.starts_at.isoformat(),
        ends_at=s.ends_at.isoformat(),
        source=s.source,
        limit_overrides=s.limit_overrides,
        note=s.note,
    )


@router.post("/ops/companies/{company_id}/subscription", response_model=SubscriptionOut, status_code=201)
def ops_activate(
    company_id: uuid.UUID,
    body: ActivateIn,
    request: Request,
    staff: User = Depends(require_staff),
    db: Session = Depends(get_db),
) -> SubscriptionOut:
    """对公转账到账后手工开通（或续期 / 调整限额）。可同时登记一张已付款发票。"""
    company = db.get(Company, company_id)
    if company is None:
        raise NotFoundError("企业不存在")
    service.ensure_plans(db)
    plan = db.get(Plan, body.plan_key)
    if plan is None:
        raise NotFoundError("套餐不存在")
    unknown = set(body.limit_overrides) - set(service.QUOTA_LABELS)
    if unknown:
        raise AppError(f"未知的限额类型：{', '.join(sorted(unknown))}", code="invalid_limit")
    from datetime import UTC

    ends_at = (
        datetime(body.ends_at.year, body.ends_at.month, body.ends_at.day, 23, 59, tzinfo=UTC) if body.ends_at else None
    )
    if ends_at is not None and ends_at <= utcnow():
        raise AppError("到期日必须晚于今天", code="invalid_ends_at")
    sub = activate(
        db,
        company.id,
        plan,
        ends_at=ends_at,
        source="manual",
        actor=staff.id,
        note=body.note.strip(),
        limit_overrides=body.limit_overrides,
    )
    if body.invoice_amount_cents:
        db.add(
            Invoice(
                company_id=company.id,
                subscription_id=sub.id,
                number=_invoice_number(db),
                amount_cents=body.invoice_amount_cents,
                status="paid",
                method="bank_transfer",
                period_start=sub.starts_at.date(),
                period_end=sub.ends_at.date(),
                paid_at=utcnow(),
                note=body.note.strip(),
            )
        )
    from app.modules.auth.router import client_ip

    audit(
        db,
        "subscription.activate",
        actor_id=staff.id,
        company_id=company.id,
        target_type="subscription",
        target_id=sub.id,
        detail={"plan": plan.key, "ends_at": sub.ends_at.isoformat(), "overrides": body.limit_overrides},
        ip=client_ip(request),
    )
    db.commit()
    return subscription_out(sub)


class InvoiceVoidIn(BaseModel):
    status: Literal["void"]
    note: str = Field(default="", max_length=300)


@router.patch("/ops/invoices/{invoice_id}", response_model=InvoiceOut)
def ops_void_invoice(
    invoice_id: uuid.UUID, body: InvoiceVoidIn, staff: User = Depends(require_staff), db: Session = Depends(get_db)
) -> InvoiceOut:
    invoice = db.get(Invoice, invoice_id)
    if invoice is None:
        raise NotFoundError("发票不存在")
    invoice.status, invoice.note = "void", body.note.strip() or invoice.note
    audit(
        db,
        "invoice.void",
        actor_id=staff.id,
        company_id=invoice.company_id,
        target_type="invoice",
        target_id=invoice.id,
    )
    db.commit()
    return invoice_out(invoice)
