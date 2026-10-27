"""官网健康检查：规则引擎（思路参考旧版 seo_service），输出评分与可执行的修复建议。"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.sites.content import SiteContent
from app.modules.sites.models import Site, SiteHealthReport, SiteVersion


@dataclass(frozen=True)
class Issue:
    key: str
    severity: str  # high / medium / low
    title: str
    fix: str
    section: str
    penalty: int

    def as_dict(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "severity": self.severity,
            "title": self.title,
            "fix": self.fix,
            "section": self.section,
        }


def check_content(content: SiteContent, *, https: bool, pages: dict[str, str]) -> list[Issue]:
    issues: list[Issue] = []
    title = content.seo.title or content.company_name
    if not 10 <= len(title) <= 60:
        issues.append(
            Issue(
                "seo_title_length",
                "medium",
                "网页标题长度不合适",
                "把 SEO 标题控制在 10–60 个字符，包含公司名和主营产品",
                "seo",
                8,
            )
        )
    description = content.seo.description
    if not 50 <= len(description) <= 160:
        issues.append(
            Issue(
                "seo_description_length",
                "medium",
                "网页描述长度不合适",
                "把 SEO 描述控制在 50–160 个字符，写清楚产品和优势",
                "seo",
                8,
            )
        )
    if not content.seo.keywords:
        issues.append(Issue("seo_keywords", "low", "缺少关键词", "补充 5–10 个英文产品关键词", "seo", 3))
    index = pages.get("index.html", "")
    h1_count = len(re.findall(r"<h1[\s>]", index))
    if h1_count != 1:
        issues.append(
            Issue("h1", "medium", "首页一级标题数量不正确", "首页应只有一个主标题（首页横幅标题）", "hero", 6)
        )
    for html in pages.values():
        for tag in re.findall(r"<img\b[^>]*>", html):
            if not re.search(r'\balt="[^"]+"', tag):
                issues.append(Issue("img_alt", "low", "图片缺少替代文字", "为图片补充英文说明", "products", 3))
                break
    if not https:
        issues.append(Issue("https", "high", "网站未启用 HTTPS", "绑定域名后完成证书签发", "domain", 15))
    if not (content.contact.email or content.contact.phone):
        issues.append(Issue("contact", "high", "联系方式不可见", "在联系我们分区补充邮箱或电话", "contact", 15))
    if not content.certificates.items:
        issues.append(
            Issue(
                "certificates", "medium", "缺少资质证书", "在企业档案中补充认证（如 ISO 9001、CE）", "certificates", 10
            )
        )
    if not content.factory.image_asset_ids:
        issues.append(
            Issue("factory_images", "medium", "缺少工厂实拍图片", "上传车间、设备、质检等真实照片", "factory", 10)
        )
    if not content.products.items:
        issues.append(Issue("products", "high", "没有产品", "至少添加一个主营产品", "products", 15))
    elif not any(item.image_asset_id for item in content.products.items):
        issues.append(Issue("product_images", "medium", "产品没有图片", "为主要产品上传清晰的产品图", "products", 8))
    if not content.about.body:
        issues.append(Issue("about", "medium", "缺少公司介绍", "补充英文公司介绍", "about", 8))
    return issues


def score(issues: list[Issue]) -> int:
    return max(0, 100 - sum(issue.penalty for issue in issues))


def run_health_check(
    db: Session, site: Site, version: SiteVersion, pages: dict[str, str] | None = None
) -> SiteHealthReport:
    from app.core.config import get_settings
    from app.modules.sites import render
    from app.modules.sites.service import render_context

    content = SiteContent.model_validate(version.content)
    if pages is None:
        ctx, _ = render_context(db, site, version, preview=True)
        pages = render.render_pages(ctx)
    https = get_settings().sites_scheme == "https"
    issues = check_content(content, https=https, pages=pages)
    report = SiteHealthReport(
        site_id=site.id, company_id=site.company_id, score=score(issues), issues=[i.as_dict() for i in issues]
    )
    db.add(report)
    db.flush()
    return report


def latest_report(db: Session, site: Site) -> SiteHealthReport | None:
    return db.scalar(
        select(SiteHealthReport).where(SiteHealthReport.site_id == site.id).order_by(SiteHealthReport.created_at.desc())
    )
