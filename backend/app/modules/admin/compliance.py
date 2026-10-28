"""数据合规：企业数据导出（JSON / CSV）、注销删除、联系人删除请求（公开接口）、隐私政策 / 用户协议版本。"""

from __future__ import annotations

import contextlib
import csv
import io
import json
import uuid
from datetime import timedelta
from typing import Any

from email_validator import EmailNotValidError, validate_email
from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.db import get_db, utcnow
from app.core.deps import CompanyScope, current_company, require_role
from app.core.errors import AppError, RateLimitedError
from app.core.security.crypto import ip_hash
from app.modules.admin.audit import audit, audit_scope
from app.modules.admin.models import DataRequest

router = APIRouter(tags=["compliance"])

POLICY_VERSION = "2026-10-28"
DELETE_CONFIRM = "DELETE"
ERASURE_IP_LIMIT_PER_DAY = 5


def _rows(db: Session, model: Any, company_id: uuid.UUID, exclude: tuple[str, ...] = ()) -> list[dict[str, Any]]:
    out = []
    for obj in db.scalars(select(model).where(model.company_id == company_id)).all():
        row = {}
        for column in model.__table__.columns:
            if column.name in exclude:
                continue
            value = getattr(obj, column.key)
            row[column.name] = (
                value.isoformat()
                if hasattr(value, "isoformat")
                else (str(value) if isinstance(value, uuid.UUID) else value)
            )
        out.append(row)
    return out


def export_company(db: Session, company_id: uuid.UUID) -> dict[str, Any]:
    """企业全部业务数据。不含：密码哈希、会话、邮箱凭据（加密内容）、询盘 IP 哈希、内部任务表。"""
    from app.modules.companies.models import Company, CompanyProfile, Product
    from app.modules.leads.models import Buyer, Lead, Watch
    from app.modules.outreach.models import EmailSuppression, LeadActivity, LeadPipeline, OutreachDraft, WeeklyReport
    from app.modules.sites.models import Site, SiteInquiry, SiteVersion

    company = db.get(Company, company_id)
    assert company is not None
    profile = db.get(CompanyProfile, company_id)
    return {
        "exported_at": utcnow().isoformat(),
        "company": {"id": str(company.id), "name_cn": company.name_cn, "name_en": company.name_en},
        "profile": {c.name: getattr(profile, c.key) for c in CompanyProfile.__table__.columns if c.name != "company_id"}
        if profile
        else {},
        "products": _rows(db, Product, company_id),
        "site": _rows(db, Site, company_id, ("domain_token",)),
        "site_versions": _rows(db, SiteVersion, company_id),
        "inquiries": _rows(db, SiteInquiry, company_id, ("ip_hash", "user_agent")),
        "watches": _rows(db, Watch, company_id),
        "buyers": _rows(db, Buyer, company_id),
        "leads": _rows(db, Lead, company_id, ("seen_by", "reviewer_id")),
        "pipeline": _rows(db, LeadPipeline, company_id),
        "activities": _rows(db, LeadActivity, company_id),
        "outreach_drafts": _rows(db, OutreachDraft, company_id),
        "email_suppressions": _rows(db, EmailSuppression, company_id),
        "weekly_reports": _rows(db, WeeklyReport, company_id),
    }


def _safe_cell(value: Any) -> str:
    """CSV 注入防护：以 = + - @ 开头的单元格加前缀，避免在表格软件中被当作公式执行。"""
    text = json.dumps(value, ensure_ascii=False, default=str) if isinstance(value, (dict, list)) else str(value or "")
    return "'" + text if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


def leads_csv(data: dict[str, Any]) -> str:
    buyers = {b["id"]: b for b in data["buyers"]}
    stages = {p["lead_id"]: p["stage"] for p in data["pipeline"]}
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["类型", "标题", "市场", "评分", "截止日期", "买家", "买家网站", "跟进阶段", "来源", "创建时间"])
    for lead in data["leads"]:
        if lead["review_status"] != "approved":
            continue
        buyer = buyers.get(lead["buyer_id"]) or {}
        writer.writerow(
            [
                _safe_cell(v)
                for v in (
                    lead["type"],
                    lead["title"],
                    lead["market"],
                    lead["score"],
                    (lead["deadline"] or "")[:10],
                    buyer.get("name", ""),
                    buyer.get("domain", ""),
                    stages.get(lead["id"], "new"),
                    lead["source_url"],
                    lead["created_at"][:19],
                )
            ]
        )
    return "\ufeff" + out.getvalue()  # BOM：Excel 正确识别 UTF-8


@router.get("/compliance/export")
def export(
    format: str = "json",
    request: Request = None,  # type: ignore[assignment]
    scope: CompanyScope = Depends(require_role("owner", "operator")),
    db: Session = Depends(get_db),
) -> Response:
    if format not in ("json", "csv"):
        raise AppError("格式只支持 json / csv", code="invalid_format")
    data = export_company(db, scope.company_id)
    from app.modules.auth.router import client_ip

    audit_scope(
        db,
        scope,
        "data.export",
        target_type="company",
        target_id=scope.company_id,
        detail={"format": format},
        ip=client_ip(request),
    )
    db.commit()
    stamp = utcnow().strftime("%Y%m%d")
    if format == "csv":
        return Response(
            leads_csv(data),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="leads-{stamp}.csv"', "Cache-Control": "no-store"},
        )
    return Response(
        json.dumps(data, ensure_ascii=False, default=str, indent=2),
        media_type="application/json; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="company-{stamp}.json"', "Cache-Control": "no-store"},
    )


class DeleteIn(BaseModel):
    confirm: str = Field(max_length=16)
    company_name: str = Field(max_length=100)


def delete_company_data(db: Session, company_id: uuid.UUID) -> None:
    """注销企业：下线官网并删除全部已构建版本、删除上传文件，然后删除企业记录——所有业务表的 company_id
    外键均为 ON DELETE CASCADE（审计日志、数据源请求记录为 SET NULL，保留但不再关联到企业）。

    备份：加密备份保留 14 天后自动删除（deploy/backup.sh），注销数据随之在 14 天内从备份中消失。
    """
    from app.core.providers import providers
    from app.modules.companies.models import Asset, Company
    from app.modules.sites import render
    from app.modules.sites import service as site_service
    from app.modules.sites.models import Site

    site = db.scalar(select(Site).where(Site.company_id == company_id))
    if site is not None:
        # 下线并删除全部已构建的版本（HTML 与图片）；失败时抛出异常，事务回滚，注销不生效
        render.purge_site(site.id, site_service.site_hosts(site))
    storage = providers.storage()
    for asset in db.scalars(select(Asset).where(Asset.company_id == company_id)).all():
        with contextlib.suppress(OSError):
            storage.delete(asset.storage_key)
    db.execute(Company.__table__.delete().where(Company.id == company_id))
    db.expire_all()


@router.post("/compliance/delete-company", status_code=204)
def delete_company(
    body: DeleteIn,
    request: Request,
    scope: CompanyScope = Depends(require_role("owner")),
    db: Session = Depends(get_db),
) -> Response:
    """所有者注销企业（不可恢复）：需输入 DELETE 和企业中文名确认。"""
    if body.confirm != DELETE_CONFIRM or body.company_name.strip() != scope.company.name_cn:
        raise AppError("确认信息不正确", code="confirmation_mismatch")
    from app.modules.auth.router import client_ip

    audit(
        db,
        "company.delete",
        actor_id=scope.user.id,
        company_id=None,
        target_type="company",
        target_id=scope.company_id,
        detail={"name": scope.company.name_cn},
        ip=client_ip(request),
    )
    delete_company_data(db, scope.company_id)
    db.commit()
    return Response(status_code=204)


class ErasureIn(BaseModel):
    email: str = Field(max_length=254)
    note: str = Field(default="", max_length=1000)
    website: str = Field(default="", max_length=200)  # 蜜罐


@router.post("/public/data-requests", status_code=202)
def request_erasure(body: ErasureIn, request: Request, db: Session = Depends(get_db)) -> dict[str, str]:
    """被采集的买家联系人请求删除其公开联系方式（GDPR 第 17 条）。由运营在后台核实处理。"""
    from app.modules.auth.router import client_ip

    if body.website:
        return {"status": "received"}  # 蜜罐：假装成功
    try:
        email = validate_email(body.email.strip(), check_deliverability=False).normalized.lower()
    except EmailNotValidError as exc:
        raise AppError("邮箱格式不正确", code="invalid_email") from exc
    hashed = ip_hash(client_ip(request))
    recent = db.scalar(
        select(func.count())
        .select_from(DataRequest)
        .where(DataRequest.ip_hash == hashed, DataRequest.created_at >= utcnow() - timedelta(days=1))
    )
    if (recent or 0) >= ERASURE_IP_LIMIT_PER_DAY:
        raise RateLimitedError("提交太频繁，请稍后再试")
    db.add(DataRequest(kind="contact_erasure", email=email, note=body.note.strip(), ip_hash=hashed))
    db.commit()
    return {"status": "received"}


@router.get("/public/policies")
def policies() -> dict[str, str]:
    """隐私政策 / 用户协议的当前版本（正文在前端静态页面中维护）。"""
    return {"version": POLICY_VERSION, "privacy": "/privacy", "terms": "/terms"}


# ── 通知设置 ───────────────────────────────────────────────────────────


class PrefsOut(BaseModel):
    groups: list[dict[str, Any]]
    wecom_configured: bool
    email: str


def _prefs_out(db: Session, scope: CompanyScope) -> PrefsOut:
    from app.modules.admin.models import CompanyChannel, NotificationPref
    from app.modules.admin.notifications import PREF_GROUPS, effective_prefs

    prefs = effective_prefs(db.get(NotificationPref, (scope.user.id, scope.company_id)))
    return PrefsOut(
        groups=[{"key": k, "label": g["label"], **prefs[k]} for k, g in PREF_GROUPS.items()],
        wecom_configured=db.get(CompanyChannel, (scope.company_id, "wecom")) is not None,
        email=scope.user.email,
    )


@router.get("/notification-prefs", response_model=PrefsOut)
def get_prefs(scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)) -> PrefsOut:
    return _prefs_out(db, scope)


class PrefPatch(BaseModel):
    group: str = Field(max_length=16)
    channel: str = Field(max_length=8)
    enabled: bool


@router.patch("/notification-prefs", response_model=PrefsOut)
def patch_prefs(
    body: PrefPatch, scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)
) -> PrefsOut:
    from app.modules.admin.models import NotificationPref
    from app.modules.admin.notifications import CHANNELS, PREF_GROUPS

    if body.group not in PREF_GROUPS or body.channel not in CHANNELS:
        raise AppError("未知的通知类型", code="invalid_pref")
    pref = db.get(NotificationPref, (scope.user.id, scope.company_id))
    if pref is None:
        pref = NotificationPref(user_id=scope.user.id, company_id=scope.company_id, prefs={})
        db.add(pref)
    group = dict(pref.prefs.get(body.group, {}))
    group[body.channel] = body.enabled
    pref.prefs = {**pref.prefs, body.group: group}
    pref.updated_at = utcnow()
    db.commit()
    return _prefs_out(db, scope)


class WecomIn(BaseModel):
    webhook: str = Field(default="", max_length=300)


@router.put("/notification-prefs/wecom", response_model=PrefsOut)
def set_wecom(
    body: WecomIn, scope: CompanyScope = Depends(require_role("owner", "operator")), db: Session = Depends(get_db)
) -> PrefsOut:
    """企业微信群机器人 Webhook（企业级）。只接受 https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…"""
    from app.core.security.secrets_box import encrypt_json
    from app.modules.admin.models import CompanyChannel
    from app.modules.admin.notifications import valid_wecom_webhook

    url = body.webhook.strip()
    if url and not valid_wecom_webhook(url):
        raise AppError("请填写企业微信群机器人的 Webhook 地址", code="invalid_webhook")
    row = db.get(CompanyChannel, (scope.company_id, "wecom"))
    if url:
        if row is None:
            row = CompanyChannel(company_id=scope.company_id, channel="wecom", encrypted_config=b"")
            db.add(row)
        row.encrypted_config, row.updated_at = encrypt_json({"webhook": url}), utcnow()
    elif row is not None:
        db.delete(row)
    audit_scope(
        db,
        scope,
        "notification.wecom",
        target_type="company",
        target_id=scope.company_id,
        detail={"enabled": bool(url)},
    )
    db.commit()
    return _prefs_out(db, scope)
