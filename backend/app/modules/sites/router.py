"""官网接口（企业内）、公开询盘接口、预览、站内通知。"""

from __future__ import annotations

import secrets
import uuid
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_db, utcnow
from app.core.deps import MANAGER_ROLES, CompanyScope, current_company
from app.core.errors import AppError, ForbiddenError, NotFoundError
from app.core.security.crypto import ip_hash, make_signed_query, verify_signed
from app.modules.sites import domains, inquiries, service
from app.modules.sites.content import SECTION_MODELS, TEMPLATES, SiteContent, fact_check, known_facts
from app.modules.sites.health import latest_report, run_health_check
from app.modules.sites.models import Notification, Site, SiteInquiry, SiteVersion

router = APIRouter(tags=["sites"])
public = APIRouter(tags=["public"])

PREVIEW_TTL = 1800


# ── 输出模型 ───────────────────────────────────────────────────────────


class TaskOut(BaseModel):
    kind: str
    status: str
    progress: list[dict[str, Any]]
    error: str


class SiteOut(BaseModel):
    id: str
    status: str
    template_key: str
    url: str
    subdomain_host: str
    custom_domain: str | None
    domain_verified: bool
    domain_token: str
    draft_version_id: str | None
    published_version_id: str | None
    has_unpublished_changes: bool
    published_at: str | None
    task: TaskOut
    health_score: int | None
    unresolved_flags: int
    inquiry_count: int
    new_inquiry_count: int


class VersionOut(BaseModel):
    id: str
    content: dict[str, Any]
    flags: list[dict[str, Any]]
    note: str
    created_at: str
    is_published: bool
    is_draft: bool


def site_out(db: Session, site: Site) -> SiteOut:
    report = latest_report(db, site)
    counts = (
        db.execute(select(SiteInquiry.status).where(SiteInquiry.site_id == site.id, SiteInquiry.status != "spam"))
        .scalars()
        .all()
    )
    return SiteOut(
        id=str(site.id),
        status=site.status,
        template_key=site.template_key,
        url=service.site_url(site),
        subdomain_host=service.site_hosts(site)[0],
        custom_domain=site.custom_domain,
        domain_verified=site.domain_verified,
        domain_token=site.domain_token,
        draft_version_id=str(site.draft_version_id) if site.draft_version_id else None,
        published_version_id=str(site.published_version_id) if site.published_version_id else None,
        has_unpublished_changes=site.draft_version_id is not None
        and site.draft_version_id != site.published_version_id,
        published_at=site.published_at.isoformat() if site.published_at else None,
        task=TaskOut(kind=site.task_kind, status=site.task_status, progress=site.task_progress, error=site.task_error),
        health_score=report.score if report else None,
        unresolved_flags=_unresolved(db, site),
        inquiry_count=len(counts),
        new_inquiry_count=sum(1 for c in counts if c == "new"),
    )


def _unresolved(db: Session, site: Site) -> int:
    if site.draft_version_id is None:
        return 0
    draft = db.get(SiteVersion, site.draft_version_id)
    return len(service.unresolved_flags(draft)) if draft else 0


def version_out(site: Site, version: SiteVersion) -> VersionOut:
    return VersionOut(
        id=str(version.id),
        content=version.content,
        flags=version.flags,
        note=version.note,
        created_at=version.created_at.isoformat(),
        is_published=version.id == site.published_version_id,
        is_draft=version.id == site.draft_version_id,
    )


def _site(db: Session, scope: CompanyScope) -> Site:
    site = db.scalar(select(Site).where(Site.company_id == scope.company_id))
    if site is None:
        raise NotFoundError("还没有官网", code="site_missing")
    return site


def _require_manager(scope: CompanyScope) -> None:
    if scope.role not in MANAGER_ROLES:
        raise ForbiddenError("只有企业所有者可以执行此操作")


# ── 官网 ───────────────────────────────────────────────────────────────


@router.get("/site", response_model=SiteOut)
def get_site(scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)) -> SiteOut:
    return site_out(db, _site(db, scope))


class GenerateIn(BaseModel):
    template: Literal["industrial", "building", "consumer"] | None = None


@router.post("/site/generate", response_model=SiteOut, status_code=202)
def generate_site(
    body: GenerateIn, scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)
) -> SiteOut:
    site = service.start_generation(db, scope.company, scope.user.id, body.template)
    db.commit()
    return site_out(db, site)


class SettingsIn(BaseModel):
    template: Literal["industrial", "building", "consumer"]


@router.patch("/site", response_model=SiteOut)
def update_site(
    body: SettingsIn, scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)
) -> SiteOut:
    site = _site(db, scope)
    assert body.template in TEMPLATES
    site.template_key = body.template
    site.updated_at = utcnow()
    db.commit()
    return site_out(db, site)


def _draft(db: Session, site: Site) -> SiteVersion:
    if site.draft_version_id is None:
        raise NotFoundError("官网内容尚未生成", code="draft_missing")
    version = db.get(SiteVersion, site.draft_version_id)
    assert version is not None
    return version


@router.get("/site/draft", response_model=VersionOut)
def get_draft(scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)) -> VersionOut:
    site = _site(db, scope)
    return version_out(site, _draft(db, site))


class SectionIn(BaseModel):
    data: dict[str, Any]


@router.put("/site/sections/{section}", response_model=VersionOut)
def update_section(
    section: str, body: SectionIn, scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)
) -> VersionOut:
    """手动编辑一个分区：保存为新版本草稿，并重新做事实校验。"""
    if section not in SECTION_MODELS:
        raise NotFoundError("分区不存在")
    site = _site(db, scope)
    draft = _draft(db, site)
    model = SECTION_MODELS[section].model_validate(body.data)
    content = SiteContent.model_validate({**draft.content, section: model.model_dump(mode="json")})
    profile, products = service.profile_snapshot(db, scope.company)
    flags = service.carry_acks(fact_check(content, known_facts(profile, products)), draft.flags)
    version = service.new_version(db, site, content, flags, note=f"编辑：{section}", user_id=scope.user.id)
    db.commit()
    return version_out(site, version)


class FlagAckIn(BaseModel):
    section: str
    field: str
    text: str


@router.post("/site/flags/ack", response_model=VersionOut)
def acknowledge_flag(
    body: FlagAckIn, scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)
) -> VersionOut:
    """用户确认「需确认」内容属实：标记为已确认（后续版本中相同内容保持已确认）。"""
    site = _site(db, scope)
    draft = _draft(db, site)
    key = (body.section, body.field, body.text)
    if not any((f["section"], f["field"], f["text"]) == key for f in draft.flags):
        raise NotFoundError("标记不存在")
    draft.flags = [{**f, "ack": True} if (f["section"], f["field"], f["text"]) == key else dict(f) for f in draft.flags]
    db.commit()
    return version_out(site, draft)


class RewriteIn(BaseModel):
    instruction: str = Field(min_length=2, max_length=500)


@router.post("/site/sections/{section}/rewrite", response_model=SiteOut, status_code=202)
def rewrite_section(
    section: str, body: RewriteIn, scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)
) -> SiteOut:
    site = service.start_rewrite(db, scope.company, scope.user.id, section, body.instruction)
    db.commit()
    return site_out(db, site)


@router.get("/site/versions", response_model=list[VersionOut])
def list_versions(scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)) -> list[VersionOut]:
    site = _site(db, scope)
    rows = db.scalars(
        select(SiteVersion).where(SiteVersion.site_id == site.id).order_by(SiteVersion.created_at.desc()).limit(50)
    ).all()
    return [version_out(site, v) for v in rows]


@router.post("/site/versions/{version_id}/restore", response_model=VersionOut)
def restore_version(
    version_id: uuid.UUID, scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)
) -> VersionOut:
    """回滚：以历史版本的内容创建新的草稿版本（历史不丢失）。"""
    site = _site(db, scope)
    old = db.get(SiteVersion, version_id)
    if old is None or old.site_id != site.id:
        raise NotFoundError("版本不存在")
    version = service.new_version(
        db, site, SiteContent.model_validate(old.content), list(old.flags), note="回滚到历史版本", user_id=scope.user.id
    )
    db.commit()
    return version_out(site, version)


@router.post("/site/publish", response_model=SiteOut, status_code=202)
def publish_site(scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)) -> SiteOut:
    _require_manager(scope)
    site = service.start_publish(db, scope.company, scope.user.id)
    db.commit()
    return site_out(db, site)


@router.post("/site/unpublish", response_model=SiteOut)
def unpublish_site(scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)) -> SiteOut:
    _require_manager(scope)
    site = _site(db, scope)
    from app.modules.sites import render

    render.deactivate(service.site_hosts(site))
    site.status, site.published_version_id = "draft", None
    db.commit()
    return site_out(db, site)


class PreviewOut(BaseModel):
    url: str
    expires_in: int


@router.get("/site/preview-url", response_model=PreviewOut)
def preview_url(scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)) -> PreviewOut:
    site = _site(db, scope)
    draft = _draft(db, site)
    query = make_signed_query("site-preview", f"{site.id}:{draft.id}", PREVIEW_TTL)
    return PreviewOut(
        url=f"/api/v1/public/site-preview/{site.id}/{draft.id}/index.html?{query}", expires_in=PREVIEW_TTL
    )


# ── 健康检查 ───────────────────────────────────────────────────────────


class HealthOut(BaseModel):
    score: int
    issues: list[dict[str, Any]]
    created_at: str


@router.post("/site/health-check", response_model=HealthOut)
def health_check(scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)) -> HealthOut:
    site = _site(db, scope)
    report = run_health_check(db, site, _draft(db, site))
    db.commit()
    return HealthOut(score=report.score, issues=report.issues, created_at=report.created_at.isoformat())


@router.get("/site/health", response_model=HealthOut)
def get_health(scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)) -> HealthOut:
    report = latest_report(db, _site(db, scope))
    if report is None:
        raise NotFoundError("还没有检查记录", code="health_missing")
    return HealthOut(score=report.score, issues=report.issues, created_at=report.created_at.isoformat())


# ── 域名 ───────────────────────────────────────────────────────────────


class DomainIn(BaseModel):
    domain: str = Field(min_length=4, max_length=253)


@router.put("/site/domain", response_model=SiteOut)
def set_domain(
    body: DomainIn, scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)
) -> SiteOut:
    _require_manager(scope)
    site = _site(db, scope)
    domain = domains.normalize_domain(body.domain)
    if domain is None:
        raise AppError("域名格式不正确", code="invalid_domain")
    taken = db.scalar(select(Site.id).where(Site.custom_domain == domain, Site.id != site.id))
    if taken:
        raise AppError("该域名已被其他官网使用", code="domain_taken", status_code=409)
    if site.custom_domain != domain:
        if site.custom_domain and site.domain_verified:
            from app.modules.sites import render

            render.deactivate([site.custom_domain])
        site.custom_domain, site.domain_verified = domain, False
        site.domain_token = secrets.token_hex(16)
    db.commit()
    return site_out(db, site)


@router.post("/site/domain/verify", response_model=SiteOut)
async def verify_domain(scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)) -> SiteOut:
    _require_manager(scope)
    site = _site(db, scope)
    if not site.custom_domain:
        raise AppError("请先填写域名", code="domain_missing")
    if not await domains.verify(site.custom_domain, site.domain_token):
        raise AppError("还没有检测到 DNS 记录，生效可能需要几分钟到几小时", code="domain_unverified")
    site.domain_verified = True
    db.commit()
    return site_out(db, site)


@router.delete("/site/domain", response_model=SiteOut)
def remove_domain(scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)) -> SiteOut:
    _require_manager(scope)
    site = _site(db, scope)
    if site.custom_domain:
        from app.modules.sites import render

        render.deactivate([site.custom_domain])
    site.custom_domain, site.domain_verified, site.domain_token = None, False, ""
    db.commit()
    return site_out(db, site)


# ── 询盘（企业内）─────────────────────────────────────────────────────


class InquiryOut(BaseModel):
    id: str
    name: str
    email: str
    company_name: str
    country: str
    product_ref: str
    message: str
    status: str
    created_at: str


def inquiry_out(item: SiteInquiry) -> InquiryOut:
    return InquiryOut(
        id=str(item.id),
        name=item.name,
        email=item.email,
        company_name=item.company_name,
        country=item.country,
        product_ref=item.product_ref,
        message=item.message,
        status=item.status,
        created_at=item.created_at.isoformat(),
    )


@router.get("/site/inquiries", response_model=list[InquiryOut])
def list_inquiries(
    include_spam: bool = False,
    limit: int = Query(default=50, ge=1, le=200),
    scope: CompanyScope = Depends(current_company),
    db: Session = Depends(get_db),
) -> list[InquiryOut]:
    stmt = select(SiteInquiry).where(SiteInquiry.company_id == scope.company_id)
    if not include_spam:
        stmt = stmt.where(SiteInquiry.status != "spam")
    return [inquiry_out(i) for i in db.scalars(stmt.order_by(SiteInquiry.created_at.desc()).limit(limit))]


def _own_inquiry(db: Session, scope: CompanyScope, inquiry_id: uuid.UUID) -> SiteInquiry:
    item = db.get(SiteInquiry, inquiry_id)
    if item is None or item.company_id != scope.company_id:
        raise NotFoundError("询盘不存在")
    return item


@router.get("/site/inquiries/{inquiry_id}", response_model=InquiryOut)
def get_inquiry(
    inquiry_id: uuid.UUID, scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)
) -> InquiryOut:
    item = _own_inquiry(db, scope, inquiry_id)
    if item.status == "new":
        item.status = "read"
        db.commit()
    return inquiry_out(item)


class InquiryPatch(BaseModel):
    status: Literal["read", "spam", "new"]


@router.patch("/site/inquiries/{inquiry_id}", response_model=InquiryOut)
def patch_inquiry(
    inquiry_id: uuid.UUID,
    body: InquiryPatch,
    scope: CompanyScope = Depends(current_company),
    db: Session = Depends(get_db),
) -> InquiryOut:
    item = _own_inquiry(db, scope, inquiry_id)
    item.status = body.status
    db.commit()
    return inquiry_out(item)


# ── 站内通知 ───────────────────────────────────────────────────────────


class NotificationOut(BaseModel):
    id: str
    kind: str
    title: str
    body: str
    link: str
    read: bool
    created_at: str


@router.get("/notifications", response_model=list[NotificationOut])
def list_notifications(
    scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)
) -> list[NotificationOut]:
    rows = db.scalars(
        select(Notification)
        .where(
            Notification.company_id == scope.company_id,
            (Notification.user_id.is_(None)) | (Notification.user_id == scope.user.id),
        )
        .order_by(Notification.created_at.desc())
        .limit(100)
    ).all()
    me = str(scope.user.id)
    return [
        NotificationOut(
            id=str(n.id),
            kind=n.kind,
            title=n.title,
            body=n.body,
            link=n.link,
            read=me in n.read_by,
            created_at=n.created_at.isoformat(),
        )
        for n in rows
    ]


@router.post("/notifications/{notification_id}/read", status_code=204)
def read_notification(
    notification_id: uuid.UUID, scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)
) -> Response:
    item = db.get(Notification, notification_id)
    if item is None or item.company_id != scope.company_id or item.user_id not in (None, scope.user.id):
        raise NotFoundError("通知不存在")
    me = str(scope.user.id)
    if me not in item.read_by:
        item.read_by = [*item.read_by, me]
        db.commit()
    return Response(status_code=204)


# ── 公开接口 ───────────────────────────────────────────────────────────


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


@public.post("/public/sites/{site_id}/inquiries")
async def submit_inquiry(site_id: uuid.UUID, request: Request, db: Session = Depends(get_db)) -> Response:
    """官网询盘表单（标准 HTML 表单 POST，无需 JavaScript）。成功后 303 跳转到感谢页。

    返回跳转而不是 JSON：官网是纯静态页面，严格 CSP 下不运行脚本。
    """
    site = db.get(Site, site_id)
    if site is None or site.status != "published":
        raise NotFoundError("官网不存在")
    content_type = request.headers.get("content-type", "")
    if len(await request.body()) > 20_000:
        return RedirectResponse("/?inquiry=invalid#contact", status_code=303)
    if content_type.startswith("application/json"):
        raw = await request.json()
        data = {k: str(v) for k, v in raw.items()} if isinstance(raw, dict) else {}
    else:
        form = await request.form()
        data = {k: str(v) for k, v in form.items() if isinstance(v, str)}
    allowed = {"name", "email", "company_name", "country", "product_ref", "message", "website"}
    ip = _client_ip(request)
    try:
        await inquiries.submit(
            db,
            site,
            {k: v for k, v in data.items() if k in allowed},
            ip=ip,
            ip_hash=ip_hash(ip),
            user_agent=request.headers.get("user-agent", ""),
            captcha_token=data.get("cf-turnstile-response", ""),
        )
    except inquiries.InquiryRejected as exc:
        db.rollback()
        if exc.reason == "spam":  # 蜜罐命中：假装成功，不给机器人反馈
            return RedirectResponse("/thank-you.html", status_code=303)
        return RedirectResponse(f"/?inquiry={exc.reason}#contact", status_code=303)
    db.commit()
    return RedirectResponse("/thank-you.html", status_code=303)


@public.get("/public/site-preview/{site_id}/{version_id}/{page:path}", response_class=HTMLResponse)
def site_preview(
    site_id: uuid.UUID,
    version_id: uuid.UUID,
    page: str,
    exp: int = Query(...),
    sig: str = Query(..., max_length=128),
    db: Session = Depends(get_db),
) -> HTMLResponse:
    """草稿预览：签名绑定站点与版本；响应带沙箱 CSP，不执行任何脚本。"""
    if not verify_signed("site-preview", f"{site_id}:{version_id}", exp, sig):
        raise NotFoundError("预览链接无效或已过期", code="link_invalid")
    site = db.get(Site, site_id)
    version = db.get(SiteVersion, version_id)
    if site is None or version is None or version.site_id != site.id:
        raise NotFoundError("预览不存在")
    html = service.preview_html(db, site, version, page)
    if html is None:
        raise NotFoundError("页面不存在")
    # 预览页中的相对链接需要继续携带签名
    query = f"exp={exp}&sig={sig}"
    html = html.replace('.html"', f'.html?{query}"').replace(".html#", f".html?{query}#")
    settings = get_settings()
    return HTMLResponse(
        html,
        headers={
            "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; "
            "form-action 'none'; frame-ancestors 'self'; sandbox",
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "no-store",
            "X-Robots-Tag": "noindex",
            "Referrer-Policy": "no-referrer" if settings.is_production else "same-origin",
        },
    )
