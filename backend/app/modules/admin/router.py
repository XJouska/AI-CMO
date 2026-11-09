"""运营工作台接口（staff）：客户列表与详情、代客操作、审计日志、数据源监控、成本看板、评测、联系人删除工单。"""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.core.db import get_db, utcnow
from app.core.deps import require_staff
from app.core.errors import ConflictError, NotFoundError
from app.core.jobs import Job, enqueue, job_handler
from app.modules.admin.audit import audit
from app.modules.admin.models import AuditLog, DataRequest, EvalRun, UsageRecord
from app.modules.auth.models import Session as UserSession
from app.modules.auth.models import User
from app.modules.billing import service as billing
from app.modules.companies.models import Company, CompanyMember, CompanyProfile
from app.modules.leads.models import Lead, LeadFeedback, SourceConfig, SourceRequest
from app.modules.sites.models import Site

router = APIRouter(tags=["ops"])
EVAL_JOB = "ops.eval"


# ── 客户列表 ───────────────────────────────────────────────────────────


class CustomerOut(BaseModel):
    id: str
    name_cn: str
    name_en: str
    plan: str
    plan_status: str
    ends_at: str | None
    completeness: int
    site_status: str
    leads_week: int
    pending_review: int
    valid_rate: float | None
    last_active_at: str | None
    operator_joined: bool
    stage: str = "start"
    waiting_on: str = "customer"
    open_tasks: int = 0


def _customer_rows(db: Session, staff: User, company_ids: list[uuid.UUID] | None = None) -> list[CustomerOut]:
    week_ago = utcnow() - timedelta(days=7)
    stmt = select(Company).where(Company.status == "active").order_by(Company.created_at.desc()).limit(200)
    if company_ids is not None:
        stmt = stmt.where(Company.id.in_(company_ids))
    companies = db.scalars(stmt).all()
    ids = [c.id for c in companies]
    if not ids:
        return []
    leads_week = dict(
        db.execute(
            select(Lead.company_id, func.count())
            .where(Lead.company_id.in_(ids), Lead.review_status == "approved", Lead.reviewed_at >= week_ago)
            .group_by(Lead.company_id)
        ).all()
    )
    pending = dict(
        db.execute(
            select(Lead.company_id, func.count())
            .where(Lead.company_id.in_(ids), Lead.review_status == "pending")
            .group_by(Lead.company_id)
        ).all()
    )
    feedback = {
        row[0]: (row[1], row[2])
        for row in db.execute(
            select(
                LeadFeedback.company_id,
                func.count(),
                func.sum(case((LeadFeedback.verdict == "useful", 1), else_=0)),
            )
            .where(LeadFeedback.company_id.in_(ids))
            .group_by(LeadFeedback.company_id)
        ).all()
    }
    active = dict(
        db.execute(
            select(CompanyMember.company_id, func.max(UserSession.created_at))
            .join(UserSession, UserSession.user_id == CompanyMember.user_id)
            .where(CompanyMember.company_id.in_(ids), CompanyMember.role != "operator")
            .group_by(CompanyMember.company_id)
        ).all()
    )
    sites = dict(db.execute(select(Site.company_id, Site.status).where(Site.company_id.in_(ids))).all())
    profiles = dict(
        db.execute(
            select(CompanyProfile.company_id, CompanyProfile.completeness).where(CompanyProfile.company_id.in_(ids))
        ).all()
    )
    joined = set(
        db.scalars(
            select(CompanyMember.company_id).where(CompanyMember.company_id.in_(ids), CompanyMember.user_id == staff.id)
        ).all()
    )
    from app.modules.service import progress
    from app.modules.service.models import ServiceTask

    open_tasks = dict(
        db.execute(
            select(ServiceTask.company_id, func.count())
            .where(ServiceTask.company_id.in_(ids), ServiceTask.status.in_(("open", "doing")))
            .group_by(ServiceTask.company_id)
        ).all()
    )
    out = []
    for c in companies:
        snap = progress.snapshot(db, c)
        stage = progress.stage_of(snap)
        ent = billing.entitlement(db, c.id)
        total, useful = feedback.get(c.id, (0, 0))
        last = active.get(c.id)
        out.append(
            CustomerOut(
                id=str(c.id),
                name_cn=c.name_cn,
                name_en=c.name_en,
                plan=ent.plan.name,
                plan_status="expired" if ent.expired else "active",
                ends_at=ent.subscription.ends_at.isoformat() if ent.subscription else None,
                completeness=profiles.get(c.id, 0),
                site_status=sites.get(c.id, "none"),
                leads_week=leads_week.get(c.id, 0),
                pending_review=pending.get(c.id, 0),
                valid_rate=round(int(useful or 0) / total, 3) if total else None,
                last_active_at=last.isoformat() if last else None,
                operator_joined=c.id in joined,
                stage=stage,
                waiting_on="team" if open_tasks.get(c.id) else progress.waiting_on(stage, snap),
                open_tasks=open_tasks.get(c.id, 0),
            )
        )
    return out


@router.get("/ops/customers", response_model=list[CustomerOut])
def list_customers(
    q: str = Query(default="", max_length=60), staff: User = Depends(require_staff), db: Session = Depends(get_db)
) -> list[CustomerOut]:
    ids = None
    if q.strip():
        like = f"%{q.strip().lower()}%"
        ids = list(
            db.scalars(
                select(Company.id).where(
                    func.lower(Company.name_cn).like(like) | func.lower(Company.name_en).like(like)
                )
            ).all()
        )
    rows = _customer_rows(db, staff, ids)
    db.commit()  # entitlement 可能为旧企业补开试用
    return rows


class CustomerDetail(BaseModel):
    customer: CustomerOut
    usage: dict[str, Any]
    members: list[dict[str, str]]
    recent_audit: list[dict[str, Any]]


@router.get("/ops/customers/{company_id}", response_model=CustomerDetail)
def customer_detail(
    company_id: uuid.UUID, staff: User = Depends(require_staff), db: Session = Depends(get_db)
) -> CustomerDetail:
    rows = _customer_rows(db, staff, [company_id])
    if not rows:
        raise NotFoundError("企业不存在")
    members = [
        {"user_id": str(u.id), "name": u.name, "role": role}
        for u, role in db.execute(
            select(User, CompanyMember.role)
            .join(CompanyMember, CompanyMember.user_id == User.id)
            .where(CompanyMember.company_id == company_id)
        ).all()
    ]
    logs = db.scalars(
        select(AuditLog).where(AuditLog.company_id == company_id).order_by(AuditLog.created_at.desc()).limit(20)
    ).all()
    usage = billing.usage_summary(db, company_id)
    db.commit()
    return CustomerDetail(customer=rows[0], usage=usage, members=members, recent_audit=[audit_out(a) for a in logs])


@router.post("/ops/customers/{company_id}/join", response_model=CustomerOut)
def join_as_operator(
    company_id: uuid.UUID, request: Request, staff: User = Depends(require_staff), db: Session = Depends(get_db)
) -> CustomerOut:
    """以 operator 角色进入客户企业（代客操作）。此后该运营人员在该企业内的敏感操作都标记为「运营代操作」。"""
    company = db.get(Company, company_id)
    if company is None or company.status != "active":
        raise NotFoundError("企业不存在")
    member = db.get(CompanyMember, {"company_id": company_id, "user_id": staff.id})
    if member is not None and member.role != "operator":
        raise ConflictError("你已经以普通成员身份加入该企业", code="already_member")
    if member is None:
        db.add(CompanyMember(company_id=company_id, user_id=staff.id, role="operator"))
        from app.modules.auth.router import client_ip

        audit(
            db,
            "operator.join",
            actor_id=staff.id,
            company_id=company_id,
            target_type="user",
            target_id=staff.id,
            on_behalf=True,
            ip=client_ip(request),
        )
    db.flush()
    row = _customer_rows(db, staff, [company_id])[0]
    db.commit()
    return row


@router.post("/ops/customers/{company_id}/leave", status_code=204)
def leave_operator(company_id: uuid.UUID, staff: User = Depends(require_staff), db: Session = Depends(get_db)) -> None:
    member = db.get(CompanyMember, {"company_id": company_id, "user_id": staff.id})
    if member is None or member.role != "operator":
        raise NotFoundError("未以运营身份加入该企业")
    db.delete(member)
    audit(
        db,
        "operator.leave",
        actor_id=staff.id,
        company_id=company_id,
        target_type="user",
        target_id=staff.id,
        on_behalf=True,
    )
    db.commit()


# ── 审计日志 ───────────────────────────────────────────────────────────


def audit_out(a: AuditLog) -> dict[str, Any]:
    return {
        "id": str(a.id),
        "action": a.action,
        "actor_user_id": str(a.actor_user_id) if a.actor_user_id else None,
        "company_id": str(a.company_id) if a.company_id else None,
        "target_type": a.target_type,
        "target_id": a.target_id,
        "on_behalf": a.on_behalf,
        "detail": a.detail,
        "created_at": a.created_at.isoformat(),
    }


@router.get("/ops/audit-logs")
def list_audit_logs(
    company_id: uuid.UUID | None = None,
    action: str = Query(default="", max_length=48),
    on_behalf: bool | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    staff: User = Depends(require_staff),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    stmt = select(AuditLog).order_by(AuditLog.created_at.desc()).limit(limit)
    if company_id:
        stmt = stmt.where(AuditLog.company_id == company_id)
    if action:
        stmt = stmt.where(AuditLog.action.startswith(action))
    if on_behalf is not None:
        stmt = stmt.where(AuditLog.on_behalf.is_(on_behalf))
    return [audit_out(a) for a in db.scalars(stmt).all()]


# ── 数据源监控 ─────────────────────────────────────────────────────────


@router.get("/ops/sources")
def source_health(
    days: int = Query(default=7, ge=1, le=90), staff: User = Depends(require_staff), db: Session = Depends(get_db)
) -> list[dict[str, Any]]:
    """各数据源：请求数、成功率、平均耗时、限流 / 封禁错误数、产出有效率（复核通过 / 产出商机）。"""
    from app.modules.leads.models import LeadSignal, Signal

    since = utcnow() - timedelta(days=days)
    rows = db.execute(
        select(
            SourceRequest.source_key,
            func.count(),
            func.sum(case((SourceRequest.ok.is_(True), 1), else_=0)),
            func.avg(SourceRequest.duration_ms),
            func.sum(case((SourceRequest.error.ilike("%403%") | SourceRequest.error.ilike("%429%"), 1), else_=0)),
            func.sum(SourceRequest.results),
        )
        .where(SourceRequest.created_at >= since)
        .group_by(SourceRequest.source_key)
    ).all()
    produced = dict(
        db.execute(
            select(Signal.source_key, func.count(func.distinct(Lead.id)))
            .join(LeadSignal, LeadSignal.signal_id == Signal.id)
            .join(Lead, Lead.id == LeadSignal.lead_id)
            .where(Lead.created_at >= since)
            .group_by(Signal.source_key)
        ).all()
    )
    approved = dict(
        db.execute(
            select(Signal.source_key, func.count(func.distinct(Lead.id)))
            .join(LeadSignal, LeadSignal.signal_id == Signal.id)
            .join(Lead, Lead.id == LeadSignal.lead_id)
            .where(Lead.created_at >= since, Lead.review_status == "approved")
            .group_by(Signal.source_key)
        ).all()
    )
    configs = {c.source_key: c for c in db.scalars(select(SourceConfig)).all()}
    out = []
    for key, total, ok, avg_ms, blocked, results in rows:
        leads = produced.get(key, 0)
        out.append(
            {
                "source_key": key,
                "enabled": configs[key].enabled if key in configs else True,
                "requests": total,
                "success_rate": round(int(ok or 0) / total, 3) if total else None,
                "avg_ms": int(avg_ms or 0),
                "blocked": int(blocked or 0),
                "results": int(results or 0),
                "leads": leads,
                "valid_rate": round(approved.get(key, 0) / leads, 3) if leads else None,
            }
        )
    return sorted(out, key=lambda r: r["source_key"])


class SourceToggle(BaseModel):
    enabled: bool


@router.patch("/ops/sources/{source_key}")
def toggle_source(
    source_key: str, body: SourceToggle, staff: User = Depends(require_staff), db: Session = Depends(get_db)
) -> dict[str, Any]:
    from app.modules.sources.connectors import connectors

    if source_key not in connectors():
        raise NotFoundError("数据源不存在")
    config = db.get(SourceConfig, source_key)
    if config is None:
        config = SourceConfig(source_key=source_key)
        db.add(config)
    config.enabled, config.updated_at = body.enabled, utcnow()
    audit(
        db,
        "source.toggle",
        actor_id=staff.id,
        target_type="source",
        target_id=source_key,
        detail={"enabled": body.enabled},
    )
    db.commit()
    return {"source_key": source_key, "enabled": config.enabled}


# ── 成本看板 ───────────────────────────────────────────────────────────


@router.get("/ops/costs")
def cost_board(
    days: int = Query(default=30, ge=1, le=365), staff: User = Depends(require_staff), db: Session = Depends(get_db)
) -> dict[str, Any]:
    since = utcnow() - timedelta(days=days)
    rows = db.execute(
        select(
            UsageRecord.company_id, UsageRecord.kind, func.sum(UsageRecord.quantity), func.sum(UsageRecord.cost_micros)
        )
        .where(UsageRecord.created_at >= since)
        .group_by(UsageRecord.company_id, UsageRecord.kind)
    ).all()
    names = dict(db.execute(select(Company.id, Company.name_cn)).all())
    per: dict[uuid.UUID, dict[str, Any]] = {}
    totals: dict[str, int] = {}
    for company_id, kind, qty, cost in rows:
        item = per.setdefault(
            company_id,
            {"company_id": str(company_id), "name": names.get(company_id, ""), "usage": {}, "cost_micros": 0},
        )
        item["usage"][kind] = int(qty or 0)
        item["cost_micros"] += int(cost or 0)
        totals[kind] = totals.get(kind, 0) + int(qty or 0)
    companies = sorted(per.values(), key=lambda r: r["cost_micros"], reverse=True)
    return {
        "days": days,
        "totals": totals,
        "cost_micros": sum(c["cost_micros"] for c in companies),
        "companies": companies,
    }


# ── 评测集 ─────────────────────────────────────────────────────────────


class EvalIn(BaseModel):
    dataset: str = Field(default="valves_synthetic.jsonl", max_length=80, pattern=r"^[A-Za-z0-9_.-]+\.jsonl$")
    mode: Literal["rules", "live"] = "rules"


def _datasets() -> list[str]:
    from evals.leads import DATASETS

    return sorted(p.name for p in DATASETS.glob("*.jsonl"))


@router.get("/ops/evals")
def list_evals(staff: User = Depends(require_staff), db: Session = Depends(get_db)) -> dict[str, Any]:
    runs = db.scalars(select(EvalRun).order_by(EvalRun.created_at.desc()).limit(50)).all()
    return {
        "datasets": _datasets(),
        "runs": [
            {
                "id": str(r.id),
                "dataset": r.dataset,
                "mode": r.mode,
                "status": r.status,
                "metrics": {k: v for k, v in r.metrics.items() if k != "confusion"},
                "error": r.error,
                "created_at": r.created_at.isoformat(),
            }
            for r in runs
        ],
    }


@router.post("/ops/evals", status_code=202)
def start_eval(body: EvalIn, staff: User = Depends(require_staff), db: Session = Depends(get_db)) -> dict[str, str]:
    if body.dataset not in _datasets():
        raise NotFoundError("评测集不存在")
    run = EvalRun(dataset=body.dataset, mode=body.mode, created_by=staff.id)
    db.add(run)
    db.flush()
    enqueue(db, EVAL_JOB, {"run_id": str(run.id)}, max_attempts=1)
    db.commit()
    return {"id": str(run.id), "status": run.status}


@job_handler(EVAL_JOB)
async def handle_eval(db: Session, job: Job) -> None:
    from app.core.providers import providers
    from evals.leads import DATASETS, evaluate, load

    run = db.get(EvalRun, uuid.UUID(job.payload["run_id"]))
    if run is None:
        return
    try:
        if run.mode == "live":
            llm = providers.llm()
        else:
            from app.services.fakes import FakeLLM

            llm = FakeLLM()
        run.metrics = await evaluate(load(DATASETS / run.dataset), llm)
        run.status = "done"
    except Exception as exc:  # 评测失败只记录，不重试
        run.status, run.error = "failed", f"{type(exc).__name__}: {exc}"[:300]


# ── 联系人删除工单 ─────────────────────────────────────────────────────


def erase_contact(db: Session, email: str) -> dict[str, int]:
    """从全部企业的买家公开联系方式、开发信收件人中删除该邮箱，并加入各企业屏蔽名单（防止再次联系）。"""
    from app.modules.leads.models import Buyer
    from app.modules.outreach import service as outreach
    from app.modules.outreach.models import OutreachDraft

    email = email.strip().lower()
    buyers = 0
    companies: set[uuid.UUID] = set()
    for buyer in db.scalars(select(Buyer).where(Buyer.public_contacts["emails"].astext.ilike(f"%{email}%"))).all():
        emails = [e for e in buyer.public_contacts.get("emails", []) if e.lower() != email]
        if len(emails) != len(buyer.public_contacts.get("emails", [])):
            buyer.public_contacts = {**buyer.public_contacts, "emails": emails}
            buyers += 1
            companies.add(buyer.company_id)
    drafts = 0
    for draft in db.scalars(select(OutreachDraft).where(func.lower(OutreachDraft.to_email) == email)).all():
        if draft.status != "sent":
            draft.to_email = ""
        drafts += 1
        companies.add(draft.company_id)
    for company_id in companies:
        outreach.suppress(db, company_id, email, "erasure")
    return {"buyers": buyers, "drafts": drafts, "companies": len(companies)}


@router.get("/ops/data-requests")
def list_data_requests(staff: User = Depends(require_staff), db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    rows = db.scalars(select(DataRequest).order_by(DataRequest.created_at.desc()).limit(200)).all()
    return [
        {
            "id": str(r.id),
            "kind": r.kind,
            "email": r.email,
            "note": r.note,
            "status": r.status,
            "result": r.result,
            "created_at": r.created_at.isoformat(),
            "handled_at": r.handled_at.isoformat() if r.handled_at else None,
        }
        for r in rows
    ]


class DataRequestDecision(BaseModel):
    decision: Literal["done", "rejected"]


@router.post("/ops/data-requests/{request_id}")
def handle_data_request(
    request_id: uuid.UUID,
    body: DataRequestDecision,
    staff: User = Depends(require_staff),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    item = db.scalar(select(DataRequest).where(DataRequest.id == request_id).with_for_update())
    if item is None:
        raise NotFoundError("工单不存在")
    if item.status != "open":
        raise ConflictError("工单已处理", code="already_handled")
    if body.decision == "done":
        item.result = erase_contact(db, item.email)
    item.status, item.handled_by, item.handled_at = body.decision, staff.id, utcnow()
    audit(
        db,
        f"data_request.{body.decision}",
        actor_id=staff.id,
        target_type="data_request",
        target_id=item.id,
        detail={"kind": item.kind, **item.result},
    )
    db.commit()
    return {"id": str(item.id), "status": item.status, "result": item.result}
