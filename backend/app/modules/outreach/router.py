"""触达与跟进接口：跟进阶段、跟进记录、开发信、发信邮箱、屏蔽名单、待跟进、周报、退订。"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from typing import Any, Literal

from email_validator import EmailNotValidError, validate_email
from fastapi import APIRouter, Depends, Query
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_db, utcnow
from app.core.deps import MANAGER_ROLES, CompanyScope, current_company, require_role
from app.core.errors import AppError, NotFoundError
from app.core.providers import providers
from app.core.security.secrets_box import DecryptionError, decrypt_json, encrypt_json
from app.modules.leads.models import Lead
from app.modules.outreach import service
from app.modules.outreach.dns_check import check_domain
from app.modules.outreach.models import (
    EmailSuppression,
    LeadActivity,
    LeadPipeline,
    MailAccount,
    OutreachDraft,
    WeeklyReport,
)
from app.services.mailer import MailSendError, OutgoingMail, SmtpCredentials

router = APIRouter(tags=["outreach"])

MAX_DRAFT_VERSIONS = 20
MAX_MAIL_ACCOUNTS = 3


def _own_lead(db: Session, scope: CompanyScope, lead_id: uuid.UUID) -> Lead:
    lead = db.get(Lead, lead_id)
    if lead is None or lead.company_id != scope.company_id or lead.review_status != "approved":
        raise NotFoundError("商机不存在")
    return lead


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _normalize_email(value: str) -> str:
    try:
        return validate_email(value.strip(), check_deliverability=False).normalized.lower()
    except EmailNotValidError as exc:
        raise AppError("邮箱格式不正确", code="invalid_email") from exc


# ── 跟进阶段与记录 ─────────────────────────────────────────────────────


class PipelineOut(BaseModel):
    lead_id: str
    stage: str
    stage_label: str
    allowed_next: list[str]
    next_action: str
    next_action_at: str | None
    overdue: bool
    lost_reason: str
    deal_value: int | None
    currency: str


def pipeline_out(pipe: LeadPipeline, now: datetime | None = None) -> PipelineOut:
    now = now or utcnow()
    return PipelineOut(
        lead_id=str(pipe.lead_id),
        stage=pipe.stage,
        stage_label=service.STAGE_LABELS[pipe.stage],
        allowed_next=service.allowed_next(pipe.stage),
        next_action=pipe.next_action,
        next_action_at=_iso(pipe.next_action_at),
        overdue=bool(pipe.next_action_at and pipe.next_action_at < now),
        lost_reason=pipe.lost_reason,
        deal_value=pipe.deal_value,
        currency=pipe.currency,
    )


class ActivityOut(BaseModel):
    id: str
    kind: str
    content: dict[str, Any]
    user_id: str | None
    created_at: str


def activity_out(a: LeadActivity) -> ActivityOut:
    return ActivityOut(
        id=str(a.id),
        kind=a.kind,
        content=a.content,
        user_id=str(a.user_id) if a.user_id else None,
        created_at=a.created_at.isoformat(),
    )


class FollowUpOut(BaseModel):
    pipeline: PipelineOut
    activities: list[ActivityOut]
    stages: dict[str, str]
    lost_reasons: dict[str, str]


@router.get("/leads/{lead_id}/follow-up", response_model=FollowUpOut)
def get_follow_up(
    lead_id: uuid.UUID, scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)
) -> FollowUpOut:
    lead = _own_lead(db, scope, lead_id)
    pipe = service.get_pipeline(db, lead)
    db.commit()
    activities = db.scalars(
        select(LeadActivity).where(LeadActivity.lead_id == lead.id).order_by(LeadActivity.created_at.desc()).limit(100)
    ).all()
    return FollowUpOut(
        pipeline=pipeline_out(pipe),
        activities=[activity_out(a) for a in activities],
        stages=service.STAGE_LABELS,
        lost_reasons=service.LOST_REASONS,
    )


class StageIn(BaseModel):
    stage: Literal["new", "viewed", "contacted", "replied", "inquiry", "quoted", "sampling", "won", "lost", "invalid"]
    note: str = Field(default="", max_length=500)
    lost_reason: str = Field(default="", max_length=32)
    deal_value: int | None = Field(default=None, ge=0, le=1_000_000_000)


@router.post("/leads/{lead_id}/stage", response_model=PipelineOut)
def update_stage(
    lead_id: uuid.UUID, body: StageIn, scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)
) -> PipelineOut:
    lead = _own_lead(db, scope, lead_id)
    pipe = service.change_stage(
        db,
        lead,
        body.stage,
        user_id=scope.user.id,
        note=body.note,
        lost_reason=body.lost_reason,
        deal_value=body.deal_value,
    )
    db.commit()
    return pipeline_out(pipe)


class NextActionIn(BaseModel):
    next_action: str = Field(default="", max_length=200)
    next_action_at: datetime | None = None

    @field_validator("next_action_at")
    @classmethod
    def _aware(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        return value


@router.put("/leads/{lead_id}/next-action", response_model=PipelineOut)
def update_next_action(
    lead_id: uuid.UUID,
    body: NextActionIn,
    scope: CompanyScope = Depends(current_company),
    db: Session = Depends(get_db),
) -> PipelineOut:
    lead = _own_lead(db, scope, lead_id)
    pipe = service.set_next_action(db, lead, body.next_action, body.next_action_at, scope.user.id)
    db.commit()
    return pipeline_out(pipe)


class ActivityIn(BaseModel):
    kind: Literal["note", "reply", "call"]
    text: str = Field(min_length=1, max_length=2000)


@router.post("/leads/{lead_id}/activities", response_model=ActivityOut, status_code=201)
def add_activity(
    lead_id: uuid.UUID, body: ActivityIn, scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)
) -> ActivityOut:
    lead = _own_lead(db, scope, lead_id)
    activity = service.add_activity(db, lead, body.kind, {"text": body.text.strip()}, scope.user.id)
    if body.kind == "reply":
        # 记录了对方回复：自动推进到「已回复」（已在更后阶段则不变）
        service.change_stage(db, lead, "replied", user_id=scope.user.id, auto=True)
    db.commit()
    return activity_out(activity)


# ── 待跟进 ─────────────────────────────────────────────────────────────


class DueItem(BaseModel):
    lead_id: str
    title: str
    type: str
    score: int
    pipeline: PipelineOut


@router.get("/follow-ups/due", response_model=list[DueItem])
def list_due(scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)) -> list[DueItem]:
    now = utcnow()
    return [
        DueItem(lead_id=str(lead.id), title=lead.title, type=lead.type, score=lead.score, pipeline=pipeline_out(p, now))
        for lead, p in service.due_items(db, scope.company_id, now)
    ]


# ── 开发信 ─────────────────────────────────────────────────────────────


class DraftOut(BaseModel):
    id: str
    lead_id: str
    tone: str
    language: str
    to_email: str
    subject: str
    body: str
    version: int
    status: str
    flags: list[dict[str, str]]
    word_count: int
    mailto: str
    created_at: str
    sent_at: str | None


def draft_out(d: OutreachDraft) -> DraftOut:
    return DraftOut(
        id=str(d.id),
        lead_id=str(d.lead_id),
        tone=d.tone,
        language=d.language,
        to_email=d.to_email,
        subject=d.subject,
        body=d.body,
        version=d.version,
        status=d.status,
        flags=d.flags,
        word_count=service.word_count(d.body),
        mailto=service.mailto_link(d.to_email, d.subject, d.body),
        created_at=d.created_at.isoformat(),
        sent_at=_iso(d.sent_at),
    )


def _own_draft(db: Session, scope: CompanyScope, draft_id: uuid.UUID) -> OutreachDraft:
    draft = db.get(OutreachDraft, draft_id)
    if draft is None or draft.company_id != scope.company_id:
        raise NotFoundError("开发信不存在")
    return draft


def _version_count(db: Session, lead_id: uuid.UUID) -> int:
    return len(db.scalars(select(OutreachDraft.id).where(OutreachDraft.lead_id == lead_id)).all())


class DraftIn(BaseModel):
    tone: Literal["concise", "professional", "warm"] = "professional"
    language: Literal["en", "de", "es", "fr", "pt", "pl"] = "en"


async def create_draft(
    db: Session, lead: Lead, scope_user: Any, tone: str, language: str, *, instruction: str = "", base: Any = None
) -> OutreachDraft:
    from app.modules.billing.service import require_ai

    require_ai(db, lead.company_id, "outreach", estimate_tokens=2_000)
    if _version_count(db, lead.id) >= MAX_DRAFT_VERSIONS:
        raise AppError(f"每条商机最多保存 {MAX_DRAFT_VERSIONS} 个版本", code="draft_limit")
    from app.services.metering import metering

    ctx = service.draft_context(db, lead, scope_user.name)
    with metering(db, lead.company_id):
        result, flags = await service.generate_email(
            ctx, tone, language, instruction=instruction, previous=base.body if base is not None else ""
        )
    latest = db.scalar(
        select(OutreachDraft.version).where(OutreachDraft.lead_id == lead.id).order_by(OutreachDraft.version.desc())
    )
    draft = OutreachDraft(
        lead_id=lead.id,
        company_id=lead.company_id,
        tone=tone,
        language=language,
        to_email=base.to_email if base is not None else ctx.to_email,
        subject=result.subject,
        body=result.body,
        version=(latest or 0) + 1,
        flags=flags,
    )
    db.add(draft)
    db.flush()
    service.add_activity(
        db, lead, "email_draft", {"draft_id": str(draft.id), "tone": tone, "version": draft.version}, scope_user.id
    )
    return draft


@router.get("/leads/{lead_id}/drafts", response_model=list[DraftOut])
def list_drafts(
    lead_id: uuid.UUID, scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)
) -> list[DraftOut]:
    lead = _own_lead(db, scope, lead_id)
    rows = db.scalars(
        select(OutreachDraft).where(OutreachDraft.lead_id == lead.id).order_by(OutreachDraft.version.desc())
    ).all()
    return [draft_out(d) for d in rows]


@router.post("/leads/{lead_id}/drafts", response_model=DraftOut, status_code=201)
async def new_draft(
    lead_id: uuid.UUID, body: DraftIn, scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)
) -> DraftOut:
    lead = _own_lead(db, scope, lead_id)
    draft = await create_draft(db, lead, scope.user, body.tone, body.language)
    db.commit()
    return draft_out(draft)


class ReviseIn(BaseModel):
    instruction: str = Field(min_length=1, max_length=300)


@router.post("/drafts/{draft_id}/revise", response_model=DraftOut, status_code=201)
async def revise_draft(
    draft_id: uuid.UUID, body: ReviseIn, scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)
) -> DraftOut:
    base = _own_draft(db, scope, draft_id)
    lead = _own_lead(db, scope, base.lead_id)
    draft = await create_draft(
        db, lead, scope.user, base.tone, base.language, instruction=body.instruction.strip(), base=base
    )
    db.commit()
    return draft_out(draft)


class DraftPatch(BaseModel):
    to_email: str | None = Field(default=None, max_length=254)
    subject: str | None = Field(default=None, min_length=1, max_length=200)
    body: str | None = Field(default=None, min_length=1, max_length=6000)


@router.patch("/drafts/{draft_id}", response_model=DraftOut)
def edit_draft(
    draft_id: uuid.UUID, body: DraftPatch, scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)
) -> DraftOut:
    draft = _own_draft(db, scope, draft_id)
    draft = db.scalar(
        select(OutreachDraft)
        .where(OutreachDraft.id == draft.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    assert draft is not None
    if draft.status in ("sent", "sending"):
        raise AppError("已发送的开发信不能修改", code="draft_sent")
    if body.to_email is not None:
        draft.to_email = _normalize_email(body.to_email) if body.to_email.strip() else ""
    if body.subject is not None:
        draft.subject = body.subject.strip()
    if body.body is not None:
        draft.body = body.body.strip()
    if body.subject is not None or body.body is not None:
        lead = _own_lead(db, scope, draft.lead_id)
        ctx = service.draft_context(db, lead, scope.user.name)
        draft.flags = service.email_fact_check(f"{draft.subject}\n{draft.body}", ctx)
    draft.updated_at = utcnow()
    db.commit()
    return draft_out(draft)


class ManualSentIn(BaseModel):
    method: Literal["copy", "mailto"]


@router.post("/drafts/{draft_id}/mark-sent", response_model=DraftOut)
def mark_sent(
    draft_id: uuid.UUID,
    body: ManualSentIn,
    scope: CompanyScope = Depends(current_company),
    db: Session = Depends(get_db),
) -> DraftOut:
    """用户用自己的邮箱发出（复制 / mailto）后确认：记录跟进并推进到「已联系」。"""
    draft = _own_draft(db, scope, draft_id)
    lead = _own_lead(db, scope, draft.lead_id)
    draft = db.scalar(
        select(OutreachDraft)
        .where(OutreachDraft.id == draft.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    assert draft is not None
    if draft.status == "sending":
        raise AppError("这封开发信正在发送中", code="draft_sending", status_code=409)
    if draft.status != "sent":
        draft.status, draft.sent_at = "sent", utcnow()
        service.add_activity(
            db,
            lead,
            "email_sent",
            {"draft_id": str(draft.id), "method": body.method, "to": draft.to_email, "subject": draft.subject},
            scope.user.id,
        )
        service.change_stage(db, lead, "contacted", user_id=scope.user.id, auto=True)
    db.commit()
    return draft_out(draft)


class SendIn(BaseModel):
    mail_account_id: uuid.UUID
    # 前端在确认对话框中展示的收件人与主题，服务端核对一致才发送（防止确认后内容被篡改）
    confirm_to: str = Field(max_length=254)
    confirm_subject: str = Field(max_length=200)


class SendOut(BaseModel):
    draft: DraftOut
    pipeline: PipelineOut
    remaining_today: int


async def send_draft(db: Session, scope: CompanyScope, draft: OutreachDraft, account_id: uuid.UUID) -> SendOut:
    """发送分两阶段，防止并发重复发送与突破限额：

    1. 占位（加锁事务）：锁定草稿与发信邮箱 → 检查状态、屏蔽名单、每日上限、套餐额度 → 草稿置为 sending，
       并立即写入发送记录与用量（计入限额）→ 提交释放锁。并发的第二个请求会看到 sending 而被拒绝，
       同时它看到的已发送数量已包含这次占位。
    2. 发送：调用邮件服务器。成功 → 草稿置为 sent；失败 → 撤销占位（草稿回到 draft，删除发送记录与用量）。
    """
    from app.modules.admin.audit import audit_scope, record_usage
    from app.modules.billing.service import check_quota, require_feature

    lead = _own_lead(db, scope, draft.lead_id)
    draft = db.scalar(
        select(OutreachDraft)
        .where(OutreachDraft.id == draft.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    assert draft is not None
    if draft.status in ("sent", "sending"):
        raise AppError("这封开发信已经发送过", code="draft_sent", status_code=409)
    account = db.scalar(
        select(MailAccount)
        .where(MailAccount.id == account_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if account is None or account.company_id != scope.company_id:
        raise NotFoundError("发信邮箱不存在")
    if not draft.to_email:
        raise AppError("请先填写收件人邮箱", code="recipient_required")
    service.check_can_send(db, account, draft.to_email)
    require_feature(db, scope.company_id, "outreach")
    check_quota(db, scope.company_id, "emails_sent")
    try:
        creds = SmtpCredentials(**decrypt_json(account.encrypted_credentials))
    except (DecryptionError, TypeError) as exc:
        raise AppError("发信邮箱凭据失效，请重新绑定", code="mail_account_broken") from exc
    mail = OutgoingMail(
        from_address=account.from_address,
        from_name=account.from_name,
        to=draft.to_email,
        subject=draft.subject,
        body=draft.body,
        unsubscribe_url=service.unsubscribe_url(scope.company_id, draft.to_email),
    )
    # ── 阶段 1：占位 ──
    draft.status = "sending"
    activity = service.add_activity(
        db,
        lead,
        "email_sent",
        {
            "draft_id": str(draft.id),
            "method": "smtp",
            "mail_account_id": str(account.id),
            "to": draft.to_email,
            "subject": draft.subject,
            "status": "sending",
        },
        scope.user.id,
    )
    usage = record_usage(db, scope.company_id, "emails_sent", 1, {"draft_id": str(draft.id)})
    db.commit()

    # ── 阶段 2：发送 ──
    try:
        message_id = await providers.mailer().send(creds, mail)
    except MailSendError as exc:
        draft.status = "draft"
        account.last_error = exc.code
        db.delete(activity)
        if usage is not None:
            db.delete(usage)
        db.commit()
        raise AppError(exc.message, code=f"mail_{exc.code}", status_code=502) from exc
    draft.status, draft.sent_at = "sent", utcnow()
    account.last_error = ""
    activity.content = {**activity.content, "status": "sent", "message_id": message_id}
    pipe = service.change_stage(db, lead, "contacted", user_id=scope.user.id, auto=True)
    audit_scope(
        db,
        scope,
        "email.send",
        target_type="outreach_draft",
        target_id=draft.id,
        detail={"to": draft.to_email, "mail_account_id": str(account.id)},
    )
    limit = min(account.daily_limit, get_settings().mail_daily_limit_max)
    remaining = max(limit - service.sent_today(db, account), 0)
    db.commit()
    return SendOut(draft=draft_out(draft), pipeline=pipeline_out(pipe), remaining_today=remaining)


@router.post("/drafts/{draft_id}/send", response_model=SendOut)
async def send(
    draft_id: uuid.UUID, body: SendIn, scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)
) -> SendOut:
    draft = _own_draft(db, scope, draft_id)
    if body.confirm_to.strip().lower() != draft.to_email or body.confirm_subject.strip() != draft.subject:
        raise AppError("开发信内容已变化，请重新确认", code="confirmation_mismatch", status_code=409)
    return await send_draft(db, scope, draft, body.mail_account_id)


# ── 发信邮箱 ───────────────────────────────────────────────────────────


class MailAccountOut(BaseModel):
    id: str
    provider: str
    from_address: str
    from_name: str
    smtp_host: str
    smtp_port: int
    username: str
    daily_limit: int
    sent_today: int
    verified: bool
    last_error: str
    dns: dict[str, Any]


def mail_account_out(db: Session, account: MailAccount) -> MailAccountOut:
    """只返回服务器与用户名用于展示；密码 / 授权码永不返回。"""
    try:
        creds = decrypt_json(account.encrypted_credentials)
    except DecryptionError:
        creds = {}
    return MailAccountOut(
        id=str(account.id),
        provider=account.provider,
        from_address=account.from_address,
        from_name=account.from_name,
        smtp_host=str(creds.get("host", "")),
        smtp_port=int(creds.get("port", 0) or 0),
        username=str(creds.get("username", "")),
        daily_limit=account.daily_limit,
        sent_today=service.sent_today(db, account),
        verified=account.verified,
        last_error=account.last_error,
        dns=account.dns_hints,
    )


class MailAccountIn(BaseModel):
    from_address: str = Field(max_length=254)
    from_name: str = Field(default="", max_length=120)
    smtp_host: str = Field(min_length=3, max_length=253)
    smtp_port: Literal[465, 587] = 465
    username: str = Field(min_length=1, max_length=254)
    password: str = Field(min_length=1, max_length=512, repr=False)
    daily_limit: int = Field(default=30, ge=1, le=500)


@router.get("/mail-accounts", response_model=list[MailAccountOut])
def list_mail_accounts(
    scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)
) -> list[MailAccountOut]:
    rows = db.scalars(
        select(MailAccount).where(MailAccount.company_id == scope.company_id).order_by(MailAccount.created_at)
    ).all()
    return [mail_account_out(db, a) for a in rows]


@router.post("/mail-accounts", response_model=MailAccountOut, status_code=201)
async def create_mail_account(
    body: MailAccountIn, scope: CompanyScope = Depends(require_role(*MANAGER_ROLES)), db: Session = Depends(get_db)
) -> MailAccountOut:
    """绑定前先用凭据登录一次 SMTP 验证（同时完成地址校验）；验证失败不保存。"""
    count = len(db.scalars(select(MailAccount.id).where(MailAccount.company_id == scope.company_id)).all())
    if count >= MAX_MAIL_ACCOUNTS:
        raise AppError(f"最多绑定 {MAX_MAIL_ACCOUNTS} 个发信邮箱", code="mail_account_limit")
    from_address = _normalize_email(body.from_address)
    creds = SmtpCredentials(
        host=body.smtp_host.strip(), port=body.smtp_port, username=body.username.strip(), password=body.password
    )
    try:
        await providers.mailer().verify(creds)
    except MailSendError as exc:
        raise AppError(exc.message, code=f"mail_{exc.code}") from exc
    dns = await check_domain(from_address.rsplit("@", 1)[1], providers.mail_dns())
    account = MailAccount(
        company_id=scope.company_id,
        provider="smtp",
        from_address=from_address,
        from_name=body.from_name.strip(),
        encrypted_credentials=encrypt_json(
            {"host": creds.host, "port": creds.port, "username": creds.username, "password": creds.password}
        ),
        daily_limit=min(body.daily_limit, get_settings().mail_daily_limit_max),
        verified=True,
        dns_hints=dns,
    )
    db.add(account)
    db.flush()
    from app.modules.admin.audit import audit_scope

    audit_scope(
        db,
        scope,
        "mail_account.create",
        target_type="mail_account",
        target_id=account.id,
        detail={"from": from_address},
    )
    db.commit()
    return mail_account_out(db, account)


class MailAccountPatch(BaseModel):
    from_name: str | None = Field(default=None, max_length=120)
    daily_limit: int | None = Field(default=None, ge=1, le=500)


@router.patch("/mail-accounts/{account_id}", response_model=MailAccountOut)
def update_mail_account(
    account_id: uuid.UUID,
    body: MailAccountPatch,
    scope: CompanyScope = Depends(require_role(*MANAGER_ROLES)),
    db: Session = Depends(get_db),
) -> MailAccountOut:
    account = db.get(MailAccount, account_id)
    if account is None or account.company_id != scope.company_id:
        raise NotFoundError("发信邮箱不存在")
    if body.from_name is not None:
        account.from_name = body.from_name.strip()
    if body.daily_limit is not None:
        account.daily_limit = min(body.daily_limit, get_settings().mail_daily_limit_max)
    db.commit()
    return mail_account_out(db, account)


@router.delete("/mail-accounts/{account_id}", status_code=204)
def delete_mail_account(
    account_id: uuid.UUID, scope: CompanyScope = Depends(require_role(*MANAGER_ROLES)), db: Session = Depends(get_db)
) -> None:
    account = db.get(MailAccount, account_id)
    if account is None or account.company_id != scope.company_id:
        raise NotFoundError("发信邮箱不存在")
    from app.modules.admin.audit import audit_scope

    audit_scope(db, scope, "mail_account.delete", target_type="mail_account", target_id=account.id)
    db.delete(account)
    db.commit()


# ── 屏蔽名单 ───────────────────────────────────────────────────────────


class SuppressionOut(BaseModel):
    email: str
    reason: str
    created_at: str


class SuppressionIn(BaseModel):
    email: str = Field(max_length=254)


@router.get("/email-suppressions", response_model=list[SuppressionOut])
def list_suppressions(
    scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)
) -> list[SuppressionOut]:
    rows = db.scalars(
        select(EmailSuppression)
        .where(EmailSuppression.company_id == scope.company_id)
        .order_by(EmailSuppression.created_at.desc())
        .limit(500)
    ).all()
    return [SuppressionOut(email=r.email, reason=r.reason, created_at=r.created_at.isoformat()) for r in rows]


@router.post("/email-suppressions", status_code=204)
def add_suppression(
    body: SuppressionIn, scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)
) -> None:
    service.suppress(db, scope.company_id, _normalize_email(body.email), "manual")
    db.commit()


# ── 周报 ───────────────────────────────────────────────────────────────


class ReportOut(BaseModel):
    id: str
    week_start: str
    stats: dict[str, Any]
    markdown: str
    created_at: str


def report_out(r: WeeklyReport) -> ReportOut:
    return ReportOut(
        id=str(r.id),
        week_start=r.week_start.isoformat(),
        stats=r.stats,
        markdown=r.markdown,
        created_at=r.created_at.isoformat(),
    )


@router.get("/reports/weekly", response_model=list[ReportOut])
def list_reports(scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)) -> list[ReportOut]:
    rows = db.scalars(
        select(WeeklyReport)
        .where(WeeklyReport.company_id == scope.company_id)
        .order_by(WeeklyReport.week_start.desc())
        .limit(52)
    ).all()
    return [report_out(r) for r in rows]


@router.get("/reports/weekly/{report_id}", response_model=ReportOut)
def get_report(
    report_id: uuid.UUID, scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)
) -> ReportOut:
    report = db.get(WeeklyReport, report_id)
    if report is None or report.company_id != scope.company_id:
        raise NotFoundError("周报不存在")
    return report_out(report)


@router.get("/reports/weekly-preview", response_model=ReportOut)
def preview_report(
    week_of: date | None = None, scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)
) -> ReportOut:
    """本周截至目前的统计（不保存）。"""
    report = service.build_weekly_report(db, scope.company_id, week_of or utcnow().date())
    out = report_out(report)
    db.rollback()
    return out


# ── 退订（公开，签名链接）──────────────────────────────────────────────

_UNSUB_PAGE = """<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport"
content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Unsubscribe</title>
<style>body{{font:16px/1.5 system-ui,sans-serif;max-width:480px;margin:15vh auto;padding:0 24px;color:#222}}
button{{font:inherit;padding:10px 20px;border-radius:8px;border:1px solid #222;background:#222;color:#fff}}</style>
</head><body>{content}</body></html>"""


def _unsub_valid(c: str, e: str, exp: int, sig: str) -> uuid.UUID:
    try:
        company_id = uuid.UUID(c)
    except ValueError as exc:
        raise NotFoundError("链接无效") from exc
    if not service.verify_unsubscribe(c, e, exp, sig):
        raise NotFoundError("链接无效或已过期")
    return company_id


@router.get("/public/unsubscribe", response_class=HTMLResponse)
def unsubscribe_page(
    c: str = Query(max_length=64), e: str = Query(max_length=254), exp: int = Query(), sig: str = Query(max_length=128)
) -> HTMLResponse:
    """展示确认按钮（GET 不改变状态，防止邮件安全网关预取链接误退订）。"""
    from html import escape
    from urllib.parse import urlencode

    _unsub_valid(c, e, exp, sig)
    action = "/api/v1/public/unsubscribe?" + urlencode({"c": c, "e": e, "exp": exp, "sig": sig})
    form = (
        f"<p>Stop receiving emails at <b>{escape(e)}</b> from this sender?</p>"
        f'<form method="post" action="{escape(action)}"><button type="submit">Unsubscribe</button></form>'
    )
    return HTMLResponse(_UNSUB_PAGE.format(content=form), headers={"Cache-Control": "no-store"})


@router.post("/public/unsubscribe", response_class=HTMLResponse)
def unsubscribe(
    c: str = Query(max_length=64),
    e: str = Query(max_length=254),
    exp: int = Query(),
    sig: str = Query(max_length=128),
    db: Session = Depends(get_db),
) -> HTMLResponse:
    """一键退订（RFC 8058 List-Unsubscribe-Post 与页面按钮共用）。"""
    company_id = _unsub_valid(c, e, exp, sig)
    from app.modules.companies.models import Company

    if db.get(Company, company_id) is not None:
        service.suppress(db, company_id, e, "unsubscribe")
        db.commit()
    return HTMLResponse(
        _UNSUB_PAGE.format(
            content="<p>You have been unsubscribed. You will not receive further emails from this sender.</p>"
        ),
        headers={"Cache-Control": "no-store"},
    )


# ── 联系话术包（按联系方式，中英文对照）───────────────────────────────


class KitItemOut(BaseModel):
    id: str
    channel: str
    channel_label: str
    target: str
    subject: str
    body: str
    subject_zh: str
    body_zh: str
    open_link: str
    flags: list[dict[str, Any]]
    created_at: str


class KitResponse(BaseModel):
    lead_id: str
    channels: list[str]
    items: list[KitItemOut]
    contact_state: str


def _kit_item(d: OutreachDraft, buyer: Any) -> KitItemOut:
    from app.modules.outreach import kit

    target = kit.contact_target(buyer, d.channel) or (d.to_email if d.channel == "email" else "")
    return KitItemOut(
        id=str(d.id),
        channel=d.channel,
        channel_label=kit.CHANNELS[d.channel]["label"],
        target=target,
        subject=d.subject,
        body=d.body,
        subject_zh=d.subject_zh,
        body_zh=d.body_zh,
        open_link=kit.open_link(d.channel, target, d.subject, d.body),
        flags=d.flags,
        created_at=d.created_at.isoformat(),
    )


# 客户可标记的联系状态 → 跟进阶段
CONTACT_STATES = {"contacted": "contacted", "replied": "replied", "not_interested": "lost"}


def _contact_state(stage: str) -> str:
    if stage in ("lost", "invalid"):
        return "not_interested"
    if stage in ("new", "viewed"):
        return "none"
    if stage == "contacted":
        return "contacted"
    return "replied"


def _kit_response(db: Session, lead: Lead) -> KitResponse:
    from app.modules.leads.models import Buyer
    from app.modules.outreach import kit

    buyer = db.get(Buyer, lead.buyer_id) if lead.buyer_id else None
    pipe = db.scalar(select(LeadPipeline).where(LeadPipeline.lead_id == lead.id))
    return KitResponse(
        lead_id=str(lead.id),
        channels=kit.available_channels(buyer),
        items=[_kit_item(d, buyer) for d in kit.latest_kit(db, lead.id)],
        contact_state=_contact_state(pipe.stage if pipe else "new"),
    )


@router.get("/leads/{lead_id}/contact-kit", response_model=KitResponse)
def get_contact_kit(
    lead_id: uuid.UUID, scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)
) -> KitResponse:
    lead = _own_lead(db, scope, lead_id)
    return _kit_response(db, lead)


@router.post("/leads/{lead_id}/contact-kit", response_model=KitResponse, status_code=201)
async def create_contact_kit(
    lead_id: uuid.UUID, scope: CompanyScope = Depends(current_company), db: Session = Depends(get_db)
) -> KitResponse:
    from app.modules.outreach import kit

    lead = _own_lead(db, scope, lead_id)
    if _version_count(db, lead.id) >= MAX_DRAFT_VERSIONS * 5:
        raise AppError("这个买家的话术版本太多了", code="draft_limit")
    await kit.build_kit(db, lead, scope.user)
    db.commit()
    return _kit_response(db, lead)


class ContactStateIn(BaseModel):
    state: Literal["contacted", "replied", "not_interested"]


@router.post("/leads/{lead_id}/contact-state", response_model=KitResponse)
def set_contact_state(
    lead_id: uuid.UUID,
    body: ContactStateIn,
    scope: CompanyScope = Depends(current_company),
    db: Session = Depends(get_db),
) -> KitResponse:
    """老板标记：已联系 / 对方回复了 / 没兴趣。按跟进阶段规则推进（不倒退；已结束的可重新打开为已联系）。"""
    lead = _own_lead(db, scope, lead_id)
    target = CONTACT_STATES[body.state]
    pipe = service.get_pipeline(db, lead)
    if pipe.stage != target and _contact_state(pipe.stage) != body.state:
        if target in service.allowed_next(pipe.stage):
            service.change_stage(
                db,
                lead,
                target,
                user_id=scope.user.id,
                lost_reason="other" if target == "lost" else "",
            )
        elif body.state == "contacted":
            pass  # 已经在更靠后的阶段（例如已回复），不倒退
        else:
            raise AppError("这个状态现在不能修改", code="invalid_stage_transition", status_code=409)
    db.commit()
    return _kit_response(db, lead)
