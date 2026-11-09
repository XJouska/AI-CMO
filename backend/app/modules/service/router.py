"""代运营服务接口。

客户（企业成员）：
  GET  /service/overview          服务进度、下一步、本周数字
  POST /service/onboarding        开通向导提交（风格、已有网站链接、补充说明）
  POST /service/requests          提交网站修改意见（可附图片资料）
  POST /service/approve-site      确认网站上线
运营（staff）：
  GET  /ops/tasks                 全部客户的待办
  PATCH /ops/tasks/{task_id}      更新待办状态
  GET  /ops/customers/{id}/workbench   客户五步工作台数据
  POST /ops/customers/{id}/request-review  把网站发给客户确认
  POST /ops/customers/{id}/start-buyers    开始找买家
"""

from __future__ import annotations

import re
import uuid
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db, utcnow
from app.core.deps import CompanyScope, current_company, current_user, require_staff
from app.core.errors import AppError, ConflictError, NotFoundError
from app.modules.admin.audit import audit, audit_scope
from app.modules.auth.models import User
from app.modules.companies.models import Asset, Company, Product
from app.modules.leads.models import Lead, Watch
from app.modules.service import progress
from app.modules.service.models import TASK_KINDS, ServiceTask
from app.modules.sites.models import Notification, Site

router = APIRouter(tags=["service"])

_URL_RE = re.compile(r"^https?://[^\s<>\"']{3,300}$", re.I)


# ── 客户：进度 ─────────────────────────────────────────────────────────


class StageOut(BaseModel):
    key: str
    label: str
    state: Literal["done", "current", "todo"]


class OverviewOut(BaseModel):
    stage: str
    stages: list[StageOut]
    next: dict[str, str]
    materials: dict[str, int]
    missing: list[str]
    categories: list[dict[str, Any]]
    style_choice: str
    site_url: str
    week: dict[str, int]
    build_days: int
    submitted: bool
    revising: bool


STAGE_LABELS = {
    "materials": "资料已收到",
    "building": "网站制作中",
    "review": "网站待你确认",
    "live": "网站已上线",
    "buyers": "正在找买家",
}


def _stages(stage: str) -> list[StageOut]:
    current = progress.STAGES.index(stage) if stage in progress.STAGES else -1
    out = []
    for index, key in enumerate(progress.STAGES):
        state: Literal["done", "current", "todo"] = (
            "done" if index < current else "current" if index == current else "todo"
        )
        out.append(StageOut(key=key, label=STAGE_LABELS[key], state=state))
    return out


def categories_out() -> list[dict[str, Any]]:
    return [{"key": k, **v} for k, v in progress.MATERIAL_CATEGORIES.items()]


@router.get("/service/overview", response_model=OverviewOut)
def overview(scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)) -> OverviewOut:
    from app.modules.sites.service import site_url

    snap = progress.snapshot(db, scope.company)
    stage = progress.stage_of(snap)
    db.commit()
    return OverviewOut(
        stage=stage,
        stages=_stages(stage),
        next=progress.next_step(stage, snap),
        materials=snap.counts,
        missing=progress.missing_materials(snap.counts),
        categories=categories_out(),
        style_choice=snap.profile.style_choice,
        site_url=site_url(snap.site) if snap.site is not None and snap.site.status == "published" else "",
        week=progress.week_numbers(db, scope.company_id),
        build_days=progress.BUILD_DAYS,
        submitted=snap.profile.submitted_at is not None,
        revising=snap.open_revisions > 0,
    )


# ── 客户：开通向导 ─────────────────────────────────────────────────────


class OnboardingIn(BaseModel):
    style_choice: Literal["heavy", "precision", "building", "consumer", "heritage", "tech", "own"]
    links: list[str] = Field(default_factory=list, max_length=3)
    note: str = Field(default="", max_length=1000)

    @field_validator("links")
    @classmethod
    def _links(cls, value: list[str]) -> list[str]:
        out = []
        for link in value:
            link = link.strip()
            if not link:
                continue
            if re.match(r"^[a-z][a-z0-9+.-]*:(?!\d)", link, re.I) and not link.lower().startswith(
                ("http://", "https://")
            ):
                raise ValueError("只支持 http / https 网址")
            if not link.lower().startswith(("http://", "https://")):
                link = f"https://{link}"
            if not _URL_RE.match(link):
                raise ValueError("网址格式不正确")
            out.append(link)
        return out


@router.post("/service/onboarding", response_model=OverviewOut)
def submit_onboarding(
    body: OnboardingIn, scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)
) -> OverviewOut:
    profile = progress.get_or_create(db, scope.company_id)
    profile.style_choice = body.style_choice
    profile.existing_links = body.links
    profile.note = body.note.strip()
    first = profile.submitted_at is None
    profile.submitted_at = profile.submitted_at or utcnow()
    profile.updated_at = utcnow()
    if first:
        progress.open_task(db, scope.company_id, "organize", note=profile.note, user_id=scope.user.id)
    audit_scope(db, scope, "service.onboarding", target_type="company", target_id=scope.company_id)
    db.commit()
    return overview(scope, db)


# ── 客户：修改意见、确认上线 ───────────────────────────────────────────


class RequestIn(BaseModel):
    text: str = Field(min_length=2, max_length=2000)
    asset_ids: list[uuid.UUID] = Field(default_factory=list, max_length=10)


class TaskOut(BaseModel):
    id: str
    company_id: str
    company_name: str
    kind: str
    kind_label: str
    status: str
    note: str
    asset_ids: list[str]
    created_at: str
    done_at: str | None


def task_out(task: ServiceTask, company: Company | None = None) -> TaskOut:
    return TaskOut(
        id=str(task.id),
        company_id=str(task.company_id),
        company_name=company.name_cn if company else "",
        kind=task.kind,
        kind_label=TASK_KINDS.get(task.kind, task.kind),
        status=task.status,
        note=task.note,
        asset_ids=task.asset_ids,
        created_at=task.created_at.isoformat(),
        done_at=task.done_at.isoformat() if task.done_at else None,
    )


@router.post("/service/requests", response_model=TaskOut, status_code=201)
def submit_request(
    body: RequestIn, scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)
) -> TaskOut:
    ids = [str(i) for i in body.asset_ids]
    if ids:
        owned = set(
            db.scalars(select(Asset.id).where(Asset.company_id == scope.company_id, Asset.id.in_(body.asset_ids))).all()
        )
        if len(owned) != len(set(body.asset_ids)):
            raise NotFoundError("资料不存在")
    open_count = len(
        db.scalars(
            select(ServiceTask.id).where(
                ServiceTask.company_id == scope.company_id,
                ServiceTask.kind == "revise_site",
                ServiceTask.status.in_(("open", "doing")),
            )
        ).all()
    )
    if open_count >= 10:
        raise AppError("还有较多修改意见在处理中，请稍后再提", code="too_many_requests", status_code=429)
    task = progress.open_task(
        db, scope.company_id, "revise_site", note=body.text.strip(), asset_ids=ids, user_id=scope.user.id
    )
    audit_scope(db, scope, "service.revise_request", target_type="service_task", target_id=task.id)
    db.commit()
    return task_out(task, scope.company)


@router.post("/service/approve-site", response_model=OverviewOut)
def approve_site(scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)) -> OverviewOut:
    """客户确认网站：发布当前草稿（发布本身由后台任务完成）。"""
    from app.modules.sites import service as site_service

    snap = progress.snapshot(db, scope.company)
    if progress.stage_of(snap) != "review":
        raise ConflictError("网站还没有准备好确认", code="not_ready")
    site = site_service.start_publish(db, scope.company, scope.user.id)
    snap.profile.approved_at = utcnow()
    progress.close_tasks(db, scope.company_id, "build_site")
    audit_scope(db, scope, "site.publish", target_type="site", target_id=site.id, detail={"by": "customer_approve"})
    db.commit()
    return overview(scope, db)


# ── 运营：待办 ─────────────────────────────────────────────────────────


@router.get("/ops/tasks", response_model=list[TaskOut])
def list_tasks(
    status: Literal["open", "done", "all"] = "open",
    company_id: uuid.UUID | None = None,
    limit: int = Query(default=100, ge=1, le=300),
    staff: User = Depends(require_staff),
    db: Session = Depends(get_db),
) -> list[TaskOut]:
    stmt = select(ServiceTask, Company).join(Company, Company.id == ServiceTask.company_id)
    if status == "open":
        stmt = stmt.where(ServiceTask.status.in_(("open", "doing"))).order_by(ServiceTask.created_at)
    elif status == "done":
        stmt = stmt.where(ServiceTask.status.in_(("done", "cancelled"))).order_by(ServiceTask.done_at.desc())
    else:
        stmt = stmt.order_by(ServiceTask.created_at.desc())
    if company_id:
        stmt = stmt.where(ServiceTask.company_id == company_id)
    return [task_out(task, company) for task, company in db.execute(stmt.limit(limit)).all()]


class TaskPatch(BaseModel):
    status: Literal["open", "doing", "done", "cancelled"]


@router.patch("/ops/tasks/{task_id}", response_model=TaskOut)
def update_task(
    task_id: uuid.UUID, body: TaskPatch, staff: User = Depends(require_staff), db: Session = Depends(get_db)
) -> TaskOut:
    task = db.get(ServiceTask, task_id)
    if task is None:
        raise NotFoundError("待办不存在")
    task.status = body.status
    task.assignee_id = task.assignee_id or staff.id
    task.done_at = utcnow() if body.status in ("done", "cancelled") else None
    audit(
        db,
        "service.task",
        actor_id=staff.id,
        company_id=task.company_id,
        target_type="service_task",
        target_id=task.id,
        detail={"status": body.status, "kind": task.kind},
        on_behalf=True,
    )
    db.commit()
    return task_out(task, db.get(Company, task.company_id))


# ── 运营：客户工作台 ───────────────────────────────────────────────────


class WorkbenchOut(BaseModel):
    company_id: str
    name_cn: str
    name_en: str
    stage: str
    waiting_on: str
    style_choice: str
    links: list[str]
    note: str
    materials: dict[str, int]
    missing: list[str]
    categories: list[dict[str, Any]]
    products: int
    completeness: int
    site: dict[str, Any] | None
    watch_active: bool
    leads_pending: int
    leads_approved: int
    tasks: list[TaskOut]
    steps: list[dict[str, Any]]


def _company(db: Session, company_id: uuid.UUID) -> Company:
    company = db.get(Company, company_id)
    if company is None or company.status != "active":
        raise NotFoundError("企业不存在")
    return company


def workbench_data(db: Session, company: Company) -> WorkbenchOut:
    from sqlalchemy import func

    from app.modules.companies.profile import refresh_completeness

    snap = progress.snapshot(db, company)
    stage = progress.stage_of(snap)
    score, _ = refresh_completeness(db, company)
    products = db.scalar(select(func.count()).select_from(Product).where(Product.company_id == company.id)) or 0
    watch_active = bool(
        db.scalar(select(Watch.id).where(Watch.company_id == company.id, Watch.is_active.is_(True)).limit(1))
    )
    pending = (
        db.scalar(
            select(func.count()).select_from(Lead).where(Lead.company_id == company.id, Lead.review_status == "pending")
        )
        or 0
    )
    approved = (
        db.scalar(
            select(func.count())
            .select_from(Lead)
            .where(Lead.company_id == company.id, Lead.review_status == "approved")
        )
        or 0
    )
    site = snap.site
    tasks = db.scalars(
        select(ServiceTask)
        .where(ServiceTask.company_id == company.id)
        .order_by(ServiceTask.created_at.desc())
        .limit(30)
    ).all()
    has_draft = site is not None and site.draft_version_id is not None
    published = site is not None and site.status == "published"
    steps = [
        {"key": "materials", "label": "查看客户资料", "done": not progress.missing_materials(snap.counts)},
        {"key": "organize", "label": "整理工厂信息和产品", "done": score >= 60 and products > 0},
        {"key": "site", "label": "确定风格并生成网站", "done": has_draft},
        {"key": "review", "label": "发给客户确认", "done": published or snap.profile.review_requested_at is not None},
        {
            "key": "buyers",
            "label": "设置找买家并审核",
            "done": snap.profile.buyers_started_at is not None and watch_active,
        },
    ]
    return WorkbenchOut(
        company_id=str(company.id),
        name_cn=company.name_cn,
        name_en=company.name_en,
        stage=stage,
        waiting_on=progress.waiting_on(stage, snap),
        style_choice=snap.profile.style_choice,
        links=snap.profile.existing_links,
        note=snap.profile.note,
        materials=snap.counts,
        missing=progress.missing_materials(snap.counts),
        categories=categories_out(),
        products=products,
        completeness=score,
        site={
            "status": site.status,
            "has_draft": has_draft,
            "task_status": site.task_status,
            "task_kind": site.task_kind,
            "task_error": site.task_error,
            "style": site.style,
        }
        if site is not None
        else None,
        watch_active=watch_active,
        leads_pending=pending,
        leads_approved=approved,
        tasks=[task_out(t, company) for t in tasks],
        steps=steps,
    )


@router.get("/ops/customers/{company_id}/workbench", response_model=WorkbenchOut)
def workbench(
    company_id: uuid.UUID, staff: User = Depends(require_staff), db: Session = Depends(get_db)
) -> WorkbenchOut:
    data = workbench_data(db, _company(db, company_id))
    db.commit()
    return data


@router.post("/ops/customers/{company_id}/request-review", response_model=WorkbenchOut)
def request_review(
    company_id: uuid.UUID, staff: User = Depends(require_staff), db: Session = Depends(get_db)
) -> WorkbenchOut:
    """运营把生成好的网站发给客户确认：客户首页进度进入「网站待你确认」，并收到通知。"""
    company = _company(db, company_id)
    site = db.scalar(select(Site).where(Site.company_id == company.id))
    if site is None or site.draft_version_id is None:
        raise ConflictError("请先生成网站", code="site_missing")
    profile = progress.get_or_create(db, company.id)
    profile.review_requested_at = utcnow()
    profile.updated_at = utcnow()
    progress.close_tasks(db, company.id, "organize")
    progress.close_tasks(db, company.id, "revise_site")
    progress.open_task(db, company.id, "build_site")
    db.add(
        Notification(
            company_id=company.id,
            kind="system",
            title="你的英文网站做好了，请看一看",
            body="没问题就点「确认上线」，想改哪里点「我要修改」告诉我们。",
            link="/my-site",
        )
    )
    audit(
        db,
        "service.request_review",
        actor_id=staff.id,
        company_id=company.id,
        target_type="site",
        target_id=site.id,
        on_behalf=True,
    )
    db.commit()
    return workbench_data(db, company)


class StyleIn(BaseModel):
    layout: Literal["heavy", "precision", "building", "consumer", "heritage", "tech"]
    primary: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    accent: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    font: Literal["sans", "serif", "rounded"] | None = None
    radius: Literal["sharp", "small", "round"] | None = None
    image: Literal["plain", "framed", "duotone"] | None = None


@router.get("/site-styles")
def site_styles(_: User = Depends(current_user)) -> dict[str, Any]:
    """网站风格目录（客户在向导中选择、运营在工作台中调整）。"""
    from app.modules.sites import styles

    return {
        "layouts": [
            {"key": k, "label": v["label"], "desc": v["desc"], **v["palette"]} for k, v in styles.LAYOUTS.items()
        ],
        "fonts": list(styles.FONTS),
        "radii": list(styles.RADII),
        "images": list(styles.IMAGE_TREATMENTS),
    }


@router.put("/ops/customers/{company_id}/site-style", response_model=WorkbenchOut)
def set_site_style(
    company_id: uuid.UUID, body: StyleIn, staff: User = Depends(require_staff), db: Session = Depends(get_db)
) -> WorkbenchOut:
    from app.modules.sites import styles
    from app.modules.sites.service import get_or_create_site

    company = _company(db, company_id)
    site = get_or_create_site(db, company)
    current = styles.normalize(site.style, site.template_key)
    palette = dict(current["palette"])
    if body.layout != current["layout"] and body.primary is None:
        palette = dict(styles.LAYOUTS[body.layout]["palette"])
    if body.primary:
        palette["primary"] = body.primary.lower()
    if body.accent:
        palette["accent"] = body.accent.lower()
    site.style = styles.normalize(
        {
            "layout": body.layout,
            "palette": palette,
            "font": body.font or current["font"],
            "radius": body.radius or current["radius"],
            "image": body.image or current["image"],
        }
    )
    site.updated_at = utcnow()
    audit(
        db,
        "site.style",
        actor_id=staff.id,
        company_id=company.id,
        target_type="site",
        target_id=site.id,
        detail=site.style,
        on_behalf=True,
    )
    db.commit()
    return workbench_data(db, company)


@router.post("/ops/customers/{company_id}/start-buyers", response_model=WorkbenchOut)
def start_buyers(
    company_id: uuid.UUID, staff: User = Depends(require_staff), db: Session = Depends(get_db)
) -> WorkbenchOut:
    """开始找买家：没有启用中的找买家计划时按产品自动建一个并启用。"""
    from app.modules.leads.router import draft_from_profile

    company = _company(db, company_id)
    watch = db.scalar(select(Watch).where(Watch.company_id == company.id).order_by(Watch.created_at))
    if watch is None:
        watch = draft_from_profile(db, company)
    if not watch.is_active:
        watch.is_active, watch.status = True, "active"
        watch.next_run_at = watch.next_run_at or utcnow()
    profile = progress.get_or_create(db, company.id)
    profile.buyers_started_at = profile.buyers_started_at or utcnow()
    progress.close_tasks(db, company.id, "setup_buyers")
    audit(
        db,
        "service.start_buyers",
        actor_id=staff.id,
        company_id=company.id,
        target_type="watch",
        target_id=watch.id,
        on_behalf=True,
    )
    db.commit()
    return workbench_data(db, company)
