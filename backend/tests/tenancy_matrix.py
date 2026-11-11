"""路由权限登记表。

每个 API 路由必须在 ROUTES 中登记访问级别，否则 test_route_guard 失败：
- public：无需登录（例如健康检查、带签名的下载链接）
- auth：需要登录，与企业无关
- path_company：路径中带 {company_id}，需要是该企业成员
- company：通过 X-Company-Id 确定企业，需要是该企业成员；路径中的资源 ID 必须属于该企业
- staff：需要平台运营人员

`roles` 标注只允许部分企业角色调用的路由（例如只有所有者 / 代运营可以发布官网、管理发信邮箱），
test_route_guard 会用普通成员（member）身份调用并断言 403。

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


def _outreach(db: Session, victim: Tenant) -> dict[str, str]:
    from datetime import date

    from app.core.security.secrets_box import encrypt_json
    from app.modules.outreach.models import MailAccount, OutreachDraft, WeeklyReport

    params = _lead(db, victim)
    draft = OutreachDraft(
        lead_id=params["lead_id"],
        company_id=victim.company.id,
        to_email="buyer@victim.example",
        subject="victim subject",
        body="victim body",
    )
    account = MailAccount(
        company_id=victim.company.id,
        from_address="sales@victim.example",
        encrypted_credentials=encrypt_json(
            {"host": "smtp.victim.example", "port": 465, "username": "u", "password": "p"}
        ),
        verified=True,
    )
    report = WeeklyReport(company_id=victim.company.id, week_start=date(2026, 10, 19), stats={}, markdown="victim")
    db.add_all([draft, account, report])
    db.flush()
    return {**params, "draft_id": str(draft.id), "account_id": str(account.id), "report_id": str(report.id)}


def _ops(db: Session, victim: Tenant) -> dict[str, str]:
    from app.modules.admin.models import DataRequest, Invoice

    invoice = Invoice(company_id=victim.company.id, number=f"INV-{victim.company.id.hex[:8]}", amount_cents=1)
    request = DataRequest(kind="contact_erasure", email="x@victim.example")
    db.add_all([invoice, request])
    db.flush()
    return {
        "company_id": str(victim.company.id),
        "invoice_id": str(invoice.id),
        "request_id": str(request.id),
        "source_key": "web_search",
        "provider": "fake",
    }


def _task(db: Session, victim: Tenant) -> dict[str, str]:
    from app.modules.service.models import ServiceTask

    task = ServiceTask(company_id=victim.company.id, kind="organize")
    db.add(task)
    db.flush()
    return {"task_id": str(task.id)}


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
    # 只允许这些角色调用（其他企业成员角色应得到 403）。None 表示所有成员都可调用。
    roles: tuple[str, ...] | None = None


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
    Route("POST", "/api/v1/auth/password", "auth", body={"current_password": "x", "new_password": "NewPass123"}),
    # 企业
    Route("POST", "/api/v1/companies", "auth", body={"name_cn": "攻击者工厂"}),
    Route("GET", "/api/v1/companies", "auth"),
    Route("GET", "/api/v1/companies/{company_id}", "path_company", _company),
    Route(
        "PATCH",
        "/api/v1/companies/{company_id}",
        "path_company",
        _company,
        {"name_cn": "被篡改"},
        roles=("owner", "operator"),
    ),
    Route("GET", "/api/v1/companies/{company_id}/members", "path_company", _company),
    Route("DELETE", "/api/v1/companies/{company_id}/members/{user_id}", "path_company", _member),
    Route(
        "POST",
        "/api/v1/companies/{company_id}/invites",
        "path_company",
        _company,
        {"role": "member"},
        roles=("owner", "operator"),
    ),
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
    Route("POST", "/api/v1/site/publish", "company", roles=("owner", "operator")),
    Route("POST", "/api/v1/site/unpublish", "company", roles=("owner", "operator")),
    Route("GET", "/api/v1/site/preview-url", "company"),
    Route("POST", "/api/v1/site/health-check", "company"),
    Route("GET", "/api/v1/site/health", "company"),
    Route("PUT", "/api/v1/site/domain", "company", body={"domain": "victim.example"}, roles=("owner", "operator")),
    Route("POST", "/api/v1/site/domain/verify", "company", roles=("owner", "operator")),
    Route("DELETE", "/api/v1/site/domain", "company", roles=("owner", "operator")),
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
    # 触达与跟进
    Route("GET", "/api/v1/leads/{lead_id}/follow-up", "company", _lead),
    Route("POST", "/api/v1/leads/{lead_id}/stage", "company", _lead, {"stage": "contacted"}),
    Route("PUT", "/api/v1/leads/{lead_id}/next-action", "company", _lead, {"next_action": "x"}),
    Route("POST", "/api/v1/leads/{lead_id}/activities", "company", _lead, {"kind": "note", "text": "x"}),
    Route("GET", "/api/v1/follow-ups/due", "company"),
    Route("GET", "/api/v1/leads/{lead_id}/drafts", "company", _lead),
    Route("POST", "/api/v1/leads/{lead_id}/drafts", "company", _lead, {"tone": "concise"}),
    Route("POST", "/api/v1/drafts/{draft_id}/revise", "company", _outreach, {"instruction": "shorter"}),
    Route("PATCH", "/api/v1/drafts/{draft_id}", "company", _outreach, {"subject": "hacked"}),
    Route("POST", "/api/v1/drafts/{draft_id}/mark-sent", "company", _outreach, {"method": "copy"}),
    Route(
        "POST",
        "/api/v1/drafts/{draft_id}/send",
        "company",
        _outreach,
        {
            "mail_account_id": "00000000-0000-0000-0000-000000000000",
            "confirm_to": "buyer@victim.example",
            "confirm_subject": "victim subject",
        },
    ),
    Route("GET", "/api/v1/mail-accounts", "company"),
    Route(
        "POST",
        "/api/v1/mail-accounts",
        "company",
        body={
            "from_address": "a@b.example",
            "smtp_host": "smtp.b.example",
            "username": "a",
            "password": "p",
        },
        roles=("owner", "operator"),
    ),
    Route(
        "PATCH",
        "/api/v1/mail-accounts/{account_id}",
        "company",
        _outreach,
        {"daily_limit": 1},
        roles=("owner", "operator"),
    ),
    Route("DELETE", "/api/v1/mail-accounts/{account_id}", "company", _outreach, roles=("owner", "operator")),
    Route("GET", "/api/v1/email-suppressions", "company"),
    Route("POST", "/api/v1/email-suppressions", "company", body={"email": "x@y.example"}),
    Route("GET", "/api/v1/reports/weekly", "company"),
    Route("GET", "/api/v1/reports/weekly/{report_id}", "company", _outreach),
    Route("GET", "/api/v1/reports/weekly-preview", "company"),
    # 公开：退订（签名链接，见 test_outreach）
    Route("GET", "/api/v1/public/unsubscribe", "public"),
    Route("POST", "/api/v1/public/unsubscribe", "public"),
    # 套餐与用量
    Route("GET", "/api/v1/billing/plans", "company"),
    Route("GET", "/api/v1/billing/usage", "company"),
    Route("GET", "/api/v1/billing/invoices", "company"),
    Route(
        "POST",
        "/api/v1/billing/checkout",
        "company",
        body={"plan_key": "growth", "provider": "fake"},
        roles=("owner", "operator"),
    ),
    # 支付回调：公开（验签 + 金额校验 + 幂等，见 test_ops_billing）
    Route("POST", "/api/v1/public/payments/{provider}/notify", "public", _ops),
    # 合规与通知设置
    Route("GET", "/api/v1/compliance/export", "company", roles=("owner", "operator")),
    Route(
        "POST",
        "/api/v1/compliance/delete-company",
        "company",
        body={"confirm": "DELETE", "company_name": "x"},
        roles=("owner",),
    ),
    Route("GET", "/api/v1/notification-prefs", "company"),
    Route(
        "PATCH", "/api/v1/notification-prefs", "company", body={"group": "leads", "channel": "email", "enabled": False}
    ),
    Route("PUT", "/api/v1/notification-prefs/wecom", "company", body={"webhook": ""}, roles=("owner", "operator")),
    # 内网：Caddy 证书签发 ask（只允许内网来源，见 test_ops_billing）
    Route("GET", "/api/v1/public/internal/tls-ask", "public"),
    # 公开：联系人删除请求（限流 + 蜜罐）、政策版本
    Route("POST", "/api/v1/public/data-requests", "public"),
    Route("GET", "/api/v1/public/policies", "public"),
    # 代运营服务：客户
    Route("GET", "/api/v1/service/overview", "company"),
    Route("POST", "/api/v1/service/business", "company", body={"business": "不锈钢球阀"}),
    Route("POST", "/api/v1/service/onboarding", "company", body={"style_choice": "heavy"}),
    Route("POST", "/api/v1/service/requests", "company", body={"text": "把首页标题改大一点"}),
    Route("POST", "/api/v1/service/approve-site", "company"),
    Route("GET", "/api/v1/site-styles", "auth"),
    # 联系话术包与联系状态
    Route("GET", "/api/v1/leads/{lead_id}/contact-kit", "company", _lead),
    Route("POST", "/api/v1/leads/{lead_id}/contact-kit", "company", _lead),
    Route("POST", "/api/v1/leads/{lead_id}/contact-state", "company", _lead, {"state": "contacted"}),
    # 代运营服务：运营
    Route("GET", "/api/v1/ops/tasks", "staff"),
    Route("PATCH", "/api/v1/ops/tasks/{task_id}", "staff", _task, {"status": "done"}),
    Route("GET", "/api/v1/ops/customers/{company_id}/workbench", "staff", _ops),
    Route("POST", "/api/v1/ops/customers/{company_id}/request-review", "staff", _ops),
    Route("POST", "/api/v1/ops/customers/{company_id}/start-buyers", "staff", _ops),
    Route("PUT", "/api/v1/ops/customers/{company_id}/site-style", "staff", _ops, {"layout": "heavy"}),
    # 运营工作台
    Route("GET", "/api/v1/ops/customers", "staff"),
    Route("GET", "/api/v1/ops/customers/{company_id}", "staff", _ops),
    Route("POST", "/api/v1/ops/customers/{company_id}/join", "staff", _ops),
    Route("POST", "/api/v1/ops/customers/{company_id}/leave", "staff", _ops),
    Route("POST", "/api/v1/ops/companies/{company_id}/subscription", "staff", _ops, {"plan_key": "growth"}),
    Route("PATCH", "/api/v1/ops/invoices/{invoice_id}", "staff", _ops, {"status": "void"}),
    Route("GET", "/api/v1/ops/audit-logs", "staff"),
    Route("GET", "/api/v1/ops/sources", "staff"),
    Route("PATCH", "/api/v1/ops/sources/{source_key}", "staff", _ops, {"enabled": False}),
    Route("GET", "/api/v1/ops/costs", "staff"),
    Route("GET", "/api/v1/ops/evals", "staff"),
    Route("POST", "/api/v1/ops/evals", "staff", body={}),
    Route("GET", "/api/v1/ops/data-requests", "staff"),
    Route("POST", "/api/v1/ops/data-requests/{request_id}", "staff", _ops, {"decision": "done"}),
    # 运营
    Route("GET", "/api/v1/ops/review-queue", "staff"),
    Route("POST", "/api/v1/ops/leads/{lead_id}/review", "staff", _lead, {"decision": "approved"}),
]
