"""商机与监控接口；运营复核队列（staff）。"""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.db import get_db, utcnow
from app.core.deps import CompanyScope, current_company, require_staff
from app.core.errors import AppError, ConflictError, NotFoundError
from app.modules.auth.models import User
from app.modules.companies.models import Company, Product
from app.modules.companies.profile import get_or_create_profile
from app.modules.leads import pipeline
from app.modules.leads.models import Buyer, Lead, LeadFeedback, LeadSignal, Signal, Watch, WatchRun
from app.modules.leads.scoring import DIMENSION_LABELS, WEIGHTS
from app.modules.sources import connectors as conn

router = APIRouter(tags=["leads"])

MAX_WATCHES = 10
MANUAL_RUN_COOLDOWN_MINUTES = 30


# ── 监控计划 ───────────────────────────────────────────────────────────


def _clean(values: list[str], limit: int) -> list[str]:
    return list(dict.fromkeys(v.strip()[:60] for v in values if v.strip()))[:limit]


class WatchIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    product_ids: list[uuid.UUID] = Field(default_factory=list, max_length=30)
    markets: list[str] = Field(default_factory=list, max_length=20)
    keywords_en: list[str] = Field(default_factory=list, max_length=20)
    negative_keywords: list[str] = Field(default_factory=list, max_length=20)
    source_keys: list[str] = Field(default_factory=list, max_length=10)
    frequency: Literal["daily", "weekly"] = "daily"
    is_active: bool = True

    @field_validator("markets", "keywords_en", "negative_keywords")
    @classmethod
    def _items(cls, value: list[str]) -> list[str]:
        return _clean(value, 20)


class WatchPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    product_ids: list[uuid.UUID] | None = Field(default=None, max_length=30)
    markets: list[str] | None = Field(default=None, max_length=20)
    keywords_en: list[str] | None = Field(default=None, max_length=20)
    negative_keywords: list[str] | None = Field(default=None, max_length=20)
    source_keys: list[str] | None = Field(default=None, max_length=10)
    frequency: Literal["daily", "weekly"] | None = None
    is_active: bool | None = None

    @field_validator("markets", "keywords_en", "negative_keywords")
    @classmethod
    def _items(cls, value: list[str] | None) -> list[str] | None:
        return None if value is None else _clean(value, 20)


class RunOut(BaseModel):
    id: str
    status: str
    trigger: str
    stats: dict[str, Any]
    error: str
    created_at: str
    finished_at: str | None


class WatchOut(BaseModel):
    id: str
    name: str
    product_ids: list[str]
    markets: list[str]
    keywords_en: list[str]
    negative_keywords: list[str]
    source_keys: list[str]
    frequency: str
    is_active: bool
    status: str
    last_run_at: str | None
    next_run_at: str | None
    last_run: RunOut | None


def run_out(run: WatchRun) -> RunOut:
    return RunOut(
        id=str(run.id),
        status=run.status,
        trigger=run.trigger,
        stats=run.stats,
        error=run.error,
        created_at=run.created_at.isoformat(),
        finished_at=run.finished_at.isoformat() if run.finished_at else None,
    )


def watch_out(db: Session, watch: Watch) -> WatchOut:
    last = db.scalar(select(WatchRun).where(WatchRun.watch_id == watch.id).order_by(WatchRun.created_at.desc()))
    return WatchOut(
        id=str(watch.id),
        name=watch.name,
        product_ids=watch.product_ids,
        markets=watch.markets,
        keywords_en=watch.keywords_en,
        negative_keywords=watch.negative_keywords,
        source_keys=watch.source_keys,
        frequency=watch.frequency,
        is_active=watch.is_active,
        status=watch.status,
        last_run_at=watch.last_run_at.isoformat() if watch.last_run_at else None,
        next_run_at=watch.next_run_at.isoformat() if watch.next_run_at else None,
        last_run=run_out(last) if last else None,
    )


def _check_refs(db: Session, scope: CompanyScope, product_ids: list[uuid.UUID], source_keys: list[str]) -> None:
    if product_ids:
        owned = set(
            db.scalars(select(Product.id).where(Product.company_id == scope.company_id, Product.id.in_(product_ids)))
        )
        if len(owned) != len(set(product_ids)):
            raise AppError("产品不存在", code="invalid_products")
    unknown = set(source_keys) - set(conn.connectors())
    if unknown:
        raise AppError("数据源不可用", code="invalid_sources")


def _own_watch(db: Session, scope: CompanyScope, watch_id: uuid.UUID) -> Watch:
    watch = db.get(Watch, watch_id)
    if watch is None or watch.company_id != scope.company_id:
        raise NotFoundError("监控计划不存在")
    return watch


@router.get("/watches", response_model=list[WatchOut])
def list_watches(scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)) -> list[WatchOut]:
    rows = db.scalars(select(Watch).where(Watch.company_id == scope.company_id).order_by(Watch.created_at)).all()
    return [watch_out(db, w) for w in rows]


@router.post("/watches", response_model=WatchOut, status_code=201)
def create_watch(
    body: WatchIn, scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)
) -> WatchOut:
    count = db.scalar(select(func.count()).select_from(Watch).where(Watch.company_id == scope.company_id)) or 0
    if count >= MAX_WATCHES:
        raise AppError("监控计划数量已达上限", code="watch_limit")
    _check_refs(db, scope, body.product_ids, body.source_keys)
    watch = Watch(
        company_id=scope.company_id,
        **body.model_dump(exclude={"product_ids"}),
        product_ids=[str(p) for p in body.product_ids],
        next_run_at=utcnow() if body.is_active else None,
    )
    db.add(watch)
    db.commit()
    return watch_out(db, watch)


@router.post("/watches/from-profile", response_model=WatchOut, status_code=201)
def watch_from_profile(scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)) -> WatchOut:
    """根据企业档案生成监控计划草稿（status=draft，用户确认后启用）。"""
    watch = draft_from_profile(db, scope.company)
    db.commit()
    return watch_out(db, watch)


def draft_from_profile(db: Session, company: Company) -> Watch:
    profile = get_or_create_profile(db, company.id)
    products = db.scalars(select(Product).where(Product.company_id == company.id).order_by(Product.created_at)).all()
    if not products:
        raise AppError("请先添加至少一个产品", code="products_required")
    keywords = _clean([k for p in products for k in p.keywords_en] or [p.name_en for p in products], 10)
    watch = Watch(
        company_id=company.id,
        name="主营产品监控",
        product_ids=[str(p.id) for p in products[:10]],
        markets=_clean(profile.export_markets, 10),
        keywords_en=keywords,
        source_keys=[],
        frequency="daily",
        is_active=False,
        status="draft",
    )
    db.add(watch)
    db.flush()
    return watch


@router.patch("/watches/{watch_id}", response_model=WatchOut)
def patch_watch(
    watch_id: uuid.UUID, body: WatchPatch, scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)
) -> WatchOut:
    watch = _own_watch(db, scope, watch_id)
    data = body.model_dump(exclude_unset=True)
    _check_refs(db, scope, body.product_ids or [], body.source_keys or [])
    if "product_ids" in data and data["product_ids"] is not None:
        data["product_ids"] = [str(p) for p in data["product_ids"]]
    for key, value in data.items():
        if value is not None:
            setattr(watch, key, value)
    if body.is_active is True:
        watch.status = "active"
        watch.next_run_at = watch.next_run_at or utcnow()
    elif body.is_active is False:
        watch.next_run_at = None
    db.commit()
    return watch_out(db, watch)


@router.delete("/watches/{watch_id}", status_code=204)
def delete_watch(
    watch_id: uuid.UUID, scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)
) -> None:
    db.delete(_own_watch(db, scope, watch_id))
    db.commit()


@router.post("/watches/{watch_id}/run", response_model=RunOut, status_code=202)
def run_watch(
    watch_id: uuid.UUID, scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)
) -> RunOut:
    watch = _own_watch(db, scope, watch_id)
    recent = db.scalar(
        select(WatchRun).where(WatchRun.watch_id == watch.id, WatchRun.status.in_(("queued", "running")))
    )
    if recent is not None:
        raise ConflictError("监控正在运行中", code="run_in_progress")
    last_manual = db.scalar(
        select(WatchRun.created_at)
        .where(WatchRun.watch_id == watch.id, WatchRun.trigger == "manual")
        .order_by(WatchRun.created_at.desc())
    )
    if last_manual and last_manual > utcnow() - timedelta(minutes=MANUAL_RUN_COOLDOWN_MINUTES):
        raise AppError(f"{MANUAL_RUN_COOLDOWN_MINUTES} 分钟内只能手动运行一次", code="run_cooldown", status_code=429)
    run = pipeline.start_run(db, watch, "manual")
    db.commit()
    return run_out(run)


@router.get("/watches/{watch_id}/runs", response_model=list[RunOut])
def list_runs(
    watch_id: uuid.UUID, scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)
) -> list[RunOut]:
    watch = _own_watch(db, scope, watch_id)
    rows = db.scalars(
        select(WatchRun).where(WatchRun.watch_id == watch.id).order_by(WatchRun.created_at.desc()).limit(20)
    )
    return [run_out(r) for r in rows]


class SourceOut(BaseModel):
    key: str
    label: str
    terms_note: str


@router.get("/lead-sources", response_model=list[SourceOut])
def list_sources(_: CompanyScope = Depends(current_company)) -> list[SourceOut]:
    return [SourceOut(key=c.key, label=c.label, terms_note=c.terms_note) for c in conn.connectors().values()]


# ── 商机 ───────────────────────────────────────────────────────────────


class BuyerOut(BaseModel):
    name: str
    domain: str
    country: str
    industry: str
    size_hint: str
    public_contacts: dict[str, Any]


class LeadOut(BaseModel):
    id: str
    type: str
    title: str
    summary_cn: str
    reasons: list[str]
    suggested_action: str
    products_matched: list[str]
    market: str
    score: int
    score_detail: list[dict[str, Any]]
    confidence: str
    deadline: str | None
    source_url: str
    source_domain: str
    status: str
    review_status: str
    is_new: bool
    created_at: str
    buyer: BuyerOut | None
    signal_count: int


def lead_out(db: Session, lead: Lead, user_id: uuid.UUID | None) -> LeadOut:
    from urllib.parse import urlsplit

    buyer = db.get(Buyer, lead.buyer_id) if lead.buyer_id else None
    signals = db.scalar(select(func.count()).select_from(LeadSignal).where(LeadSignal.lead_id == lead.id)) or 0
    detail = [
        {"key": k, "label": DIMENSION_LABELS[k], "weight": WEIGHTS[k], "score": lead.score_detail.get(k, 0)}
        for k in WEIGHTS
    ]
    return LeadOut(
        id=str(lead.id),
        type=lead.type,
        title=lead.title,
        summary_cn=lead.summary_cn,
        reasons=lead.reasons,
        suggested_action=lead.suggested_action,
        products_matched=lead.products_matched,
        market=lead.market,
        score=lead.score,
        score_detail=detail,
        confidence=lead.confidence,
        deadline=lead.deadline.date().isoformat() if lead.deadline else None,
        source_url=lead.source_url,
        source_domain=urlsplit(lead.source_url).hostname or "",
        status=lead.status,
        review_status=lead.review_status,
        is_new=user_id is not None and str(user_id) not in lead.seen_by,
        created_at=lead.created_at.isoformat(),
        buyer=BuyerOut(
            name=buyer.name,
            domain=buyer.domain,
            country=buyer.country,
            industry=buyer.industry,
            size_hint=buyer.size_hint,
            public_contacts=buyer.public_contacts,
        )
        if buyer
        else None,
        signal_count=signals,
    )


class LeadPage(BaseModel):
    items: list[LeadOut]
    total: int
    new_count: int
    today_count: int


@router.get("/leads", response_model=LeadPage)
def list_leads(
    type: Literal["tender", "rfq", "buyer_intent", "prospect", "site_inquiry"] | None = None,
    market: str | None = Query(default=None, max_length=80),
    min_score: int = Query(default=0, ge=0, le=100),
    status: str | None = Query(default=None, max_length=16),
    offset: int = Query(default=0, ge=0, le=10_000),
    limit: int = Query(default=20, ge=1, le=50),
    scope: CompanyScope = Depends(current_company),
    db: Session = Depends(get_db),
) -> LeadPage:
    """用户只能看到复核通过的商机（试点期全部人工复核）。"""
    base = select(Lead).where(Lead.company_id == scope.company_id, Lead.review_status == "approved")
    if type:
        base = base.where(Lead.type == type)
    if market:
        base = base.where(func.lower(Lead.market) == market.lower())
    if min_score:
        base = base.where(Lead.score >= min_score)
    if status:
        base = base.where(Lead.status == status)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = db.scalars(base.order_by(Lead.created_at.desc(), Lead.score.desc()).offset(offset).limit(limit)).all()
    me = str(scope.user.id)
    all_approved = select(Lead).where(Lead.company_id == scope.company_id, Lead.review_status == "approved")
    new_count = (
        db.scalar(select(func.count()).select_from(all_approved.where(~Lead.seen_by.contains([me])).subquery())) or 0
    )
    start = utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    today = db.scalar(select(func.count()).select_from(all_approved.where(Lead.reviewed_at >= start).subquery())) or 0
    return LeadPage(
        items=[lead_out(db, lead, scope.user.id) for lead in rows], total=total, new_count=new_count, today_count=today
    )


def _own_lead(db: Session, scope: CompanyScope, lead_id: uuid.UUID) -> Lead:
    lead = db.get(Lead, lead_id)
    if lead is None or lead.company_id != scope.company_id or lead.review_status != "approved":
        raise NotFoundError("商机不存在")
    return lead


@router.get("/leads/{lead_id}", response_model=LeadOut)
def get_lead(
    lead_id: uuid.UUID, scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)
) -> LeadOut:
    lead = _own_lead(db, scope, lead_id)
    me = str(scope.user.id)
    if me not in lead.seen_by:
        lead.seen_by = [*lead.seen_by, me]
        db.commit()
    return lead_out(db, lead, scope.user.id)


class FeedbackIn(BaseModel):
    verdict: Literal["useful", "irrelevant", "duplicate", "fake"]
    note: str = Field(default="", max_length=500)


@router.post("/leads/{lead_id}/feedback", status_code=204)
def lead_feedback(
    lead_id: uuid.UUID, body: FeedbackIn, scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)
) -> None:
    lead = _own_lead(db, scope, lead_id)
    existing = db.scalar(
        select(LeadFeedback).where(LeadFeedback.lead_id == lead.id, LeadFeedback.user_id == scope.user.id)
    )
    if existing is None:
        db.add(
            LeadFeedback(
                lead_id=lead.id,
                company_id=scope.company_id,
                user_id=scope.user.id,
                verdict=body.verdict,
                note=body.note.strip(),
            )
        )
    else:
        existing.verdict, existing.note = body.verdict, body.note.strip()
    db.commit()


# ── 运营复核（staff）──────────────────────────────────────────────────


class ReviewItem(BaseModel):
    lead: LeadOut
    company_id: str
    company_name: str
    signals: list[dict[str, Any]]


@router.get("/ops/review-queue", response_model=list[ReviewItem])
def review_queue(
    company_id: uuid.UUID | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    staff: User = Depends(require_staff),
    db: Session = Depends(get_db),
) -> list[ReviewItem]:
    stmt = select(Lead, Company).join(Company, Company.id == Lead.company_id).where(Lead.review_status == "pending")
    if company_id:
        stmt = stmt.where(Lead.company_id == company_id)
    rows = db.execute(stmt.order_by(Lead.score.desc(), Lead.created_at).limit(limit)).all()
    out = []
    for lead, company in rows:
        signals = db.execute(
            select(Signal.source_key, Signal.url, Signal.title, Signal.snippet)
            .join(LeadSignal, LeadSignal.signal_id == Signal.id)
            .where(LeadSignal.lead_id == lead.id)
        ).all()
        out.append(
            ReviewItem(
                lead=lead_out(db, lead, None),
                company_id=str(company.id),
                company_name=company.name_cn,
                signals=[{"source": s, "url": u, "title": t, "snippet": sn[:500]} for s, u, t, sn in signals],
            )
        )
    return out


class ReviewIn(BaseModel):
    decision: Literal["approved", "rejected"]
    summary_cn: str | None = Field(default=None, max_length=500)
    title: str | None = Field(default=None, max_length=300)


@router.post("/ops/leads/{lead_id}/review", response_model=LeadOut)
def review_lead(
    lead_id: uuid.UUID, body: ReviewIn, staff: User = Depends(require_staff), db: Session = Depends(get_db)
) -> LeadOut:
    lead = db.get(Lead, lead_id)
    if lead is None:
        raise NotFoundError("商机不存在")
    if lead.review_status != "pending":
        raise ConflictError("该商机已复核", code="already_reviewed")
    if body.summary_cn is not None:
        lead.summary_cn = body.summary_cn.strip()
    if body.title is not None and body.title.strip():
        lead.title = body.title.strip()
    lead.review_status, lead.reviewer_id, lead.reviewed_at = body.decision, staff.id, utcnow()
    if body.decision == "approved":
        from app.modules.sites.models import Notification

        db.add(
            Notification(
                company_id=lead.company_id,
                kind="new_lead",
                title=f"新商机：{lead.title}"[:120],
                body=lead.summary_cn[:200],
                link=f"/leads/{lead.id}",
            )
        )
    db.commit()
    return lead_out(db, lead, None)
