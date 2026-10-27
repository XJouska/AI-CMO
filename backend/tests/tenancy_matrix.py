"""路由权限登记表。

每个 API 路由必须在 ROUTES 中登记访问级别，否则 test_route_guard 失败：
- public：无需登录（例如健康检查、带签名的下载链接）
- auth：需要登录，与企业无关
- path_company：路径中带 {company_id}，需要是该企业成员
- company：通过 X-Company-Id 确定企业，需要是该企业成员；路径中的资源 ID 必须属于该企业
- staff：需要平台运营人员

对于 company / path_company 路由，`setup` 在「受害企业 A」中创建所需资源并返回路径参数，
守卫测试会用「攻击者 B」的身份（自己的企业头 / 冒用 A 的企业头）访问，断言被拒绝。
"""

from __future__ import annotations

import io
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.orm import Session

from tests.factories import Tenant, make_asset, make_product

Setup = Callable[[Session, Tenant], dict[str, str]]


def _none(db: Session, victim: Tenant) -> dict[str, str]:
    return {}


def _company(db: Session, victim: Tenant) -> dict[str, str]:
    return {"company_id": str(victim.company.id)}


def _member(db: Session, victim: Tenant) -> dict[str, str]:
    return {"company_id": str(victim.company.id), "user_id": str(victim.user.id)}


def _product(db: Session, victim: Tenant) -> dict[str, str]:
    return {"product_id": str(make_product(db, victim.company).id)}


def _asset(db: Session, victim: Tenant) -> dict[str, str]:
    return {"asset_id": str(make_asset(db, victim.company).id)}


def _extraction(db: Session, victim: Tenant) -> dict[str, str]:
    from app.modules.companies.models import ProfileExtraction

    item = ProfileExtraction(
        company_id=victim.company.id,
        source="chat",
        status="succeeded",
        result={
            "changes": [
                {
                    "id": "f:usp",
                    "group": "company",
                    "field": "usp",
                    "label": "核心优势",
                    "current": "",
                    "value": "x",
                }
            ]
        },
    )
    db.add(item)
    db.flush()
    return {"extraction_id": str(item.id)}


def _conversation(db: Session, victim: Tenant) -> dict[str, str]:
    from app.modules.assistant.models import Conversation, Message

    conversation = Conversation(company_id=victim.company.id, user_id=victim.user.id, title="victim")
    db.add(conversation)
    db.flush()
    message = Message(
        conversation_id=conversation.id,
        company_id=victim.company.id,
        role="assistant",
        state="completed",
        parent_id=None,
    )
    db.add(message)
    db.flush()
    return {"conversation_id": str(conversation.id), "message_id": str(message.id)}


def _tool_run(db: Session, victim: Tenant) -> dict[str, str]:
    from app.modules.assistant.models import ToolRun

    ids = _conversation(db, victim)
    run = ToolRun(
        message_id=ids["message_id"],
        company_id=victim.company.id,
        user_id=victim.user.id,
        tool_name="product_delete",
        args={"product_id": str(make_product(db, victim.company).id)},
        status="pending_confirm",
    )
    db.add(run)
    db.flush()
    return {"run_id": str(run.id)}


def _site(db: Session, victim: Tenant) -> dict[str, str]:
    from app.modules.sites.content import SiteContent
    from app.modules.sites.models import Notification, Site, SiteInquiry, SiteVersion

    site = Site(company_id=victim.company.id, subdomain=f"victim-{victim.company.id.hex[:8]}", status="published")
    db.add(site)
    db.flush()
    version = SiteVersion(site_id=site.id, company_id=victim.company.id, content=SiteContent().model_dump(mode="json"))
    db.add(version)
    db.flush()
    site.draft_version_id = version.id
    inquiry = SiteInquiry(
        site_id=site.id, company_id=victim.company.id, name="n", email="a@b.com", message="m" * 10, ip_hash="0" * 64
    )
    note = Notification(company_id=victim.company.id, kind="x", title="t")
    db.add_all([inquiry, note])
    db.flush()
    return {
        "version_id": str(version.id),
        "inquiry_id": str(inquiry.id),
        "notification_id": str(note.id),
        "site_id": str(site.id),
        "section": "hero",
    }


def _lead(db: Session, victim: Tenant) -> dict[str, str]:
    from app.modules.leads.models import Lead, Watch

    watch = Watch(company_id=victim.company.id, name="victim")
    lead = Lead(company_id=victim.company.id, type="tender", title="victim", review_status="approved")
    db.add_all([watch, lead])
    db.flush()
    return {"watch_id": str(watch.id), "lead_id": str(lead.id)}


def png_bytes() -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (4, 4), (255, 0, 0)).save(buf, format="PNG")
    return buf.getvalue()


@dataclass(frozen=True)
class Route:
    method: str
    path: str
    level: str
    setup: Setup = _none
    body: dict[str, Any] | None = None
    files: dict[str, Any] | None = field(default=None, hash=False)


CONV = "/api/v1/assistant/conversations/{conversation_id}"

ROUTES: list[Route] = [
    # 系统
    Route("GET", "/health", "public"),
    Route("GET", "/api/v1/meta", "public"),
    # 账号
    Route("POST", "/api/v1/auth/register", "public"),
    Route("POST", "/api/v1/auth/login", "public"),
    Route("POST", "/api/v1/auth/sms/send", "public"),
    Route("GET", "/api/v1/auth/me", "auth"),
    Route("POST", "/api/v1/auth/logout", "auth"),
    Route("POST", "/api/v1/auth/logout-all", "auth"),
    # 企业
    Route("POST", "/api/v1/companies", "auth", body={"name_cn": "攻击者工厂"}),
    Route("GET", "/api/v1/companies", "auth"),
    Route("GET", "/api/v1/companies/{company_id}", "path_company", _company),
    Route("PATCH", "/api/v1/companies/{company_id}", "path_company", _company, {"name_cn": "被篡改"}),
    Route("GET", "/api/v1/companies/{company_id}/members", "path_company", _company),
    Route("DELETE", "/api/v1/companies/{company_id}/members/{user_id}", "path_company", _member),
    Route("POST", "/api/v1/companies/{company_id}/invites", "path_company", _company, {"role": "member"}),
    Route("GET", "/api/v1/invites/{token}", "auth"),
    Route("POST", "/api/v1/invites/{token}/accept", "auth"),
    # 企业档案
    Route("GET", "/api/v1/profile", "company"),
    Route("PATCH", "/api/v1/profile", "company", body={"usp": "x"}),
    # 产品
    Route("GET", "/api/v1/products", "company"),
    Route("POST", "/api/v1/products", "company", body={"name_en": "X"}),
    Route("GET", "/api/v1/products/{product_id}", "company", _product),
    Route("PATCH", "/api/v1/products/{product_id}", "company", _product, {"name_en": "Hacked"}),
    Route("DELETE", "/api/v1/products/{product_id}", "company", _product),
    # 资料
    Route("POST", "/api/v1/assets", "company", files={"file": ("a.png", png_bytes(), "image/png")}),
    Route("GET", "/api/v1/assets", "company"),
    Route("GET", "/api/v1/assets/{asset_id}/download-url", "company", _asset),
    Route("DELETE", "/api/v1/assets/{asset_id}", "company", _asset),
    Route("GET", "/api/v1/files/{asset_id}", "public"),  # 依赖签名，见 test_assets
    # AI 建档
    Route("POST", "/api/v1/extractions", "company", body={"source": "chat", "text": "我们是做不锈钢阀门的工厂"}),
    Route("GET", "/api/v1/extractions/{extraction_id}", "company", _extraction),
    Route("POST", "/api/v1/extractions/{extraction_id}/apply", "company", _extraction, {"accept": ["f:usp"]}),
    # 助手
    Route("POST", "/api/v1/assistant/conversations", "company", body={}),
    Route("GET", "/api/v1/assistant/conversations", "company"),
    Route("PATCH", f"{CONV}", "company", _conversation, {"title": "x"}),
    Route("DELETE", f"{CONV}", "company", _conversation),
    Route("GET", f"{CONV}/messages", "company", _conversation),
    Route("POST", f"{CONV}/messages", "company", _conversation, {"text": "hi"}),
    Route("POST", f"{CONV}/messages/{{message_id}}/retry", "company", _conversation),
    Route("POST", f"{CONV}/messages/{{message_id}}/cancel", "company", _conversation),
    Route("POST", f"{CONV}/messages/{{message_id}}/feedback", "company", _conversation, {"value": "like"}),
    Route("GET", "/api/v1/assistant/tool-runs/{run_id}", "company", _tool_run),
    Route("POST", "/api/v1/assistant/tool-runs/{run_id}/confirm", "company", _tool_run),
    Route("POST", "/api/v1/assistant/tool-runs/{run_id}/reject", "company", _tool_run),
    # 官网（每个企业一个官网：通过 X-Company-Id 确定，「跨企业」用例验证资源 ID 不可见）
    Route("GET", "/api/v1/site", "company"),
    Route("PATCH", "/api/v1/site", "company", body={"template": "consumer"}),
    Route("POST", "/api/v1/site/generate", "company", body={}),
    Route("GET", "/api/v1/site/draft", "company"),
    Route("PUT", "/api/v1/site/sections/{section}", "company", _site, {"data": {"headline": "x"}}),
    Route("POST", "/api/v1/site/sections/{section}/rewrite", "company", _site, {"instruction": "改一下"}),
    Route("POST", "/api/v1/site/flags/ack", "company", body={"section": "hero", "field": "x", "text": "y"}),
    Route("GET", "/api/v1/site/versions", "company"),
    Route("POST", "/api/v1/site/versions/{version_id}/restore", "company", _site),
    Route("POST", "/api/v1/site/publish", "company"),
    Route("POST", "/api/v1/site/unpublish", "company"),
    Route("GET", "/api/v1/site/preview-url", "company"),
    Route("POST", "/api/v1/site/health-check", "company"),
    Route("GET", "/api/v1/site/health", "company"),
    Route("PUT", "/api/v1/site/domain", "company", body={"domain": "victim.example"}),
    Route("POST", "/api/v1/site/domain/verify", "company"),
    Route("DELETE", "/api/v1/site/domain", "company"),
    Route("GET", "/api/v1/site/inquiries", "company"),
    Route("GET", "/api/v1/site/inquiries/{inquiry_id}", "company", _site),
    Route("PATCH", "/api/v1/site/inquiries/{inquiry_id}", "company", _site, {"status": "spam"}),
    Route("GET", "/api/v1/notifications", "company"),
    Route("POST", "/api/v1/notifications/{notification_id}/read", "company", _site),
    # 公开：询盘（限流 + 蜜罐，见 test_sites）、预览（签名，见 test_sites）
    Route("POST", "/api/v1/public/sites/{site_id}/inquiries", "public"),
    Route("GET", "/api/v1/public/site-preview/{site_id}/{version_id}/{page}", "public"),
    # 商机
    Route("GET", "/api/v1/watches", "company"),
    Route("POST", "/api/v1/watches", "company", body={"name": "x"}),
    Route("POST", "/api/v1/watches/from-profile", "company"),
    Route("PATCH", "/api/v1/watches/{watch_id}", "company", _lead, {"name": "hacked"}),
    Route("DELETE", "/api/v1/watches/{watch_id}", "company", _lead),
    Route("POST", "/api/v1/watches/{watch_id}/run", "company", _lead),
    Route("GET", "/api/v1/watches/{watch_id}/runs", "company", _lead),
    Route("GET", "/api/v1/lead-sources", "company"),
    Route("GET", "/api/v1/leads", "company"),
    Route("GET", "/api/v1/leads/{lead_id}", "company", _lead),
    Route("POST", "/api/v1/leads/{lead_id}/feedback", "company", _lead, {"verdict": "useful"}),
    # 运营
    Route("GET", "/api/v1/ops/review-queue", "staff"),
    Route("POST", "/api/v1/ops/leads/{lead_id}/review", "staff", _lead, {"decision": "approved"}),
]
