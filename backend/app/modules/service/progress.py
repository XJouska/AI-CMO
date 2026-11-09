"""服务进度：根据资料、网站、买家数据算出客户当前所处阶段，以及「下一步你要做的事」。

阶段（客户首页的进度条）：
  materials  资料已收到   向导已提交
  building   网站制作中   运营正在整理资料 / 生成网站
  review     网站待你确认 运营已发给客户确认，客户尚未确认
  live       网站已上线   网站已发布
  buyers     正在找买家   运营已开始为客户找买家
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.db import utcnow
from app.modules.companies.models import Asset, Company
from app.modules.leads.models import Lead
from app.modules.service.models import TASK_KINDS, ServiceProfile, ServiceTask
from app.modules.sites.models import Site, SiteInquiry

# 资料类别：客户在向导和「我的资料」中按类别上传。required 为建站必需的类别。
MATERIAL_CATEGORIES: dict[str, dict[str, Any]] = {
    "factory_photo": {"label": "工厂和车间照片", "required": True, "images_only": True},
    "product_photo": {"label": "产品照片", "required": True, "images_only": True},
    "catalog": {"label": "产品目录或说明书", "required": False, "images_only": False},
    "certificate": {"label": "证书", "required": False, "images_only": False},
    "business_card": {"label": "名片", "required": True, "images_only": False},
    "logo": {"label": "Logo", "required": False, "images_only": True},
}

# 客户可选的网站风格（与官网版式一一对应，见 sites/styles.py）
STYLE_CHOICES = ("heavy", "precision", "building", "consumer", "heritage", "tech", "own")

STAGES = ("materials", "building", "review", "live", "buyers")
# 承诺的网站制作时间（工作日），显示在客户首页
BUILD_DAYS = 3


def get_or_create(db: Session, company_id: uuid.UUID) -> ServiceProfile:
    """并发请求（首页、我的网站同时打开）可能同时创建：用 ON CONFLICT DO NOTHING 避免主键冲突。"""
    profile = db.get(ServiceProfile, company_id)
    if profile is None:
        db.execute(
            pg_insert(ServiceProfile)
            .values(company_id=company_id, updated_at=utcnow())
            .on_conflict_do_nothing(index_elements=["company_id"])
        )
        profile = db.get(ServiceProfile, company_id, populate_existing=True)
        assert profile is not None
    return profile


def material_counts(db: Session, company_id: uuid.UUID) -> dict[str, int]:
    rows = db.execute(select(Asset.kind, func.count()).where(Asset.company_id == company_id).group_by(Asset.kind)).all()
    return {kind: count for kind, count in rows}


def missing_materials(counts: dict[str, int]) -> list[str]:
    return [key for key, meta in MATERIAL_CATEGORIES.items() if meta["required"] and not counts.get(key)]


def open_task(
    db: Session,
    company_id: uuid.UUID,
    kind: str,
    *,
    note: str = "",
    asset_ids: list[str] | None = None,
    user_id: uuid.UUID | None = None,
) -> ServiceTask:
    """同一企业同一类未完成的任务只保留一条（修改网站除外：每次修改意见单独一条）。"""
    if kind != "revise_site":
        existing = db.scalar(
            select(ServiceTask).where(
                ServiceTask.company_id == company_id,
                ServiceTask.kind == kind,
                ServiceTask.status.in_(("open", "doing")),
            )
        )
        if existing is not None:
            return existing
    task = ServiceTask(company_id=company_id, kind=kind, note=note, asset_ids=asset_ids or [], created_by=user_id)
    db.add(task)
    db.flush()
    return task


def close_tasks(db: Session, company_id: uuid.UUID, kind: str) -> None:
    for task in db.scalars(
        select(ServiceTask).where(
            ServiceTask.company_id == company_id, ServiceTask.kind == kind, ServiceTask.status.in_(("open", "doing"))
        )
    ):
        task.status = "done"
        task.done_at = utcnow()


@dataclass
class Snapshot:
    profile: ServiceProfile
    site: Site | None
    counts: dict[str, int]
    open_revisions: int


def snapshot(db: Session, company: Company) -> Snapshot:
    profile = get_or_create(db, company.id)
    site = db.scalar(select(Site).where(Site.company_id == company.id))
    revisions = (
        db.scalar(
            select(func.count())
            .select_from(ServiceTask)
            .where(
                ServiceTask.company_id == company.id,
                ServiceTask.kind == "revise_site",
                ServiceTask.status.in_(("open", "doing")),
            )
        )
        or 0
    )
    return Snapshot(profile=profile, site=site, counts=material_counts(db, company.id), open_revisions=revisions)


def stage_of(s: Snapshot) -> str:
    if s.profile.submitted_at is None:
        return "start"
    if s.profile.buyers_started_at is not None and s.site is not None and s.site.status == "published":
        return "buyers"
    if s.site is not None and s.site.status == "published":
        return "live"
    if s.profile.review_requested_at is not None and s.open_revisions == 0:
        return "review"
    if s.site is not None and s.site.draft_version_id is not None:
        return "building"
    return "materials"


def waiting_on(stage: str, s: Snapshot) -> str:
    """当前卡在谁那里：customer（等客户）/ team（等我们）/ none。"""
    if stage == "start":
        return "customer"
    if stage == "review":
        return "customer"
    if stage in ("materials", "building"):
        return "customer" if missing_materials(s.counts) and stage == "materials" else "team"
    return "none"


def next_step(stage: str, s: Snapshot) -> dict[str, str]:
    """「下一步你要做的事」卡片：title / body / action（按钮文字）/ link。action 为空表示客户只需等待。"""
    missing = missing_materials(s.counts)
    if stage == "start":
        return {
            "title": "先告诉我们你的工厂",
            "body": "只需要 3 步：填工厂名、上传照片、选网站风格。",
            "action": "开始",
            "link": "/start",
        }
    if stage == "building" and s.open_revisions:
        return {"title": "我们正在按你的意见修改网站", "body": "改好后会再请你看一遍。", "action": "", "link": ""}
    if missing and stage in ("materials", "building"):
        names = "、".join(MATERIAL_CATEGORIES[k]["label"] for k in missing)
        return {
            "title": f"还差：{names}",
            "body": "补齐后我们就能开始做网站。用手机直接拍照上传就行。",
            "action": "去上传",
            "link": "/materials",
        }
    if stage == "materials":
        return {
            "title": "资料已收到，我们正在整理",
            "body": f"我们会在 {BUILD_DAYS} 个工作日内做好你的英文网站，做好后通知你。",
            "action": "",
            "link": "",
        }
    if stage == "building":
        if s.open_revisions:
            return {"title": "我们正在按你的意见修改网站", "body": "改好后会再请你看一遍。", "action": "", "link": ""}
        return {
            "title": "你的英文网站正在制作",
            "body": f"预计 {BUILD_DAYS} 个工作日内完成，做好后会通知你来看。",
            "action": "",
            "link": "",
        }
    if stage == "review":
        return {
            "title": "网站做好了，请你看一看",
            "body": "没问题就点「确认上线」；想改哪里，点「我要修改」告诉我们。",
            "action": "去看网站",
            "link": "/my-site",
        }
    if stage == "live":
        return {
            "title": "网站已上线",
            "body": "我们正在为你准备找海外买家，找到后会第一时间推送给你。",
            "action": "看我的网站",
            "link": "/my-site",
        }
    return {
        "title": "正在为你找海外买家",
        "body": "每找到一个合适的买家，我们都会附上中英文的联系话术。",
        "action": "看买家",
        "link": "/buyers",
    }


def week_numbers(db: Session, company_id: uuid.UUID) -> dict[str, int]:
    since = utcnow() - timedelta(days=7)
    buyers = (
        db.scalar(
            select(func.count())
            .select_from(Lead)
            .where(Lead.company_id == company_id, Lead.review_status == "approved", Lead.reviewed_at >= since)
        )
        or 0
    )
    total_buyers = (
        db.scalar(
            select(func.count())
            .select_from(Lead)
            .where(Lead.company_id == company_id, Lead.review_status == "approved")
        )
        or 0
    )
    inquiries = (
        db.scalar(
            select(func.count())
            .select_from(SiteInquiry)
            .where(SiteInquiry.company_id == company_id, SiteInquiry.status != "spam", SiteInquiry.created_at >= since)
        )
        or 0
    )
    return {"buyers_week": buyers, "buyers_total": total_buyers, "inquiries_week": inquiries}


def task_label(kind: str) -> str:
    return TASK_KINDS.get(kind, kind)
