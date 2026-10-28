"""触达与跟进的助手工具：生成 / 修改开发信、发送（需确认）、推进阶段、待跟进列表、周报。"""

from __future__ import annotations

import uuid
from typing import Any, Literal

from pydantic import Field
from sqlalchemy import select

from app.core.db import utcnow
from app.core.errors import AppError
from app.modules.assistant.tools import ToolArgs, ToolContext, ToolError, ToolResult, tool
from app.modules.leads.models import Lead
from app.modules.outreach import service
from app.modules.outreach.models import MailAccount, OutreachDraft


def _lead(ctx: ToolContext, lead_id: uuid.UUID) -> Lead:
    lead = ctx.db.get(Lead, lead_id)
    if lead is None or lead.company_id != ctx.company_id or lead.review_status != "approved":
        raise ToolError("商机不存在")
    return lead


def _draft(ctx: ToolContext, draft_id: uuid.UUID) -> OutreachDraft:
    draft = ctx.db.get(OutreachDraft, draft_id)
    if draft is None or draft.company_id != ctx.company_id:
        raise ToolError("开发信不存在")
    return draft


def _draft_card(draft: OutreachDraft, lead: Lead) -> dict[str, Any]:
    return {
        "card_type": "outreach_draft",
        "payload": {
            "draft_id": str(draft.id),
            "lead_id": str(lead.id),
            "lead_title": lead.title,
            "subject": draft.subject,
            "tone": draft.tone,
            "to_email": draft.to_email,
            "word_count": service.word_count(draft.body),
            "flags": len(draft.flags),
        },
    }


def _draft_data(draft: OutreachDraft) -> dict[str, Any]:
    return {
        "draft_id": str(draft.id),
        "subject": draft.subject,
        "body": draft.body,
        "fact_check_issues": draft.flags,
    }


class DraftArgs(ToolArgs):
    lead_id: uuid.UUID
    tone: Literal["concise", "professional", "warm"] = "professional"
    language: Literal["en", "de", "es", "fr", "pt", "pl"] = "en"


@tool(
    "outreach_draft",
    description="为某条商机生成开发信（英文或目标市场语言），语气可选 concise / professional / warm。",
    args=DraftArgs,
    label="生成开发信",
    side_effect="draft",
)
async def outreach_draft(ctx: ToolContext, args: DraftArgs) -> ToolResult:
    from app.modules.outreach.router import create_draft

    lead = _lead(ctx, args.lead_id)
    try:
        draft = await create_draft(ctx.db, lead, ctx.user, args.tone, args.language)
    except AppError as exc:
        raise ToolError(exc.message) from exc
    return ToolResult(data=_draft_data(draft), card=_draft_card(draft, lead), summary="开发信已生成")


class ReviseArgs(ToolArgs):
    draft_id: uuid.UUID
    instruction: str = Field(min_length=1, max_length=300, description="修改要求，例如「再短一点」「强调 CE 认证」")


@tool(
    "outreach_revise",
    description="按要求修改一封开发信，生成新版本。",
    args=ReviseArgs,
    label="修改开发信",
    side_effect="draft",
)
async def outreach_revise(ctx: ToolContext, args: ReviseArgs) -> ToolResult:
    from app.modules.outreach.router import create_draft

    base = _draft(ctx, args.draft_id)
    lead = _lead(ctx, base.lead_id)
    try:
        draft = await create_draft(
            ctx.db, lead, ctx.user, base.tone, base.language, instruction=args.instruction, base=base
        )
    except AppError as exc:
        raise ToolError(exc.message) from exc
    return ToolResult(data=_draft_data(draft), card=_draft_card(draft, lead), summary="已生成新版本")


class SendArgs(ToolArgs):
    draft_id: uuid.UUID


def _account(ctx: ToolContext) -> MailAccount | None:
    return ctx.db.scalar(
        select(MailAccount)
        .where(MailAccount.company_id == ctx.company_id, MailAccount.verified.is_(True))
        .order_by(MailAccount.created_at)
    )


def _describe_send(ctx: ToolContext, args: SendArgs) -> dict[str, Any]:
    draft = _draft(ctx, args.draft_id)
    account = _account(ctx)
    sender = account.from_address if account else "（未绑定发信邮箱）"
    return {
        "title": "发送开发信",
        "summary": f"发件人：{sender}\n收件人：{draft.to_email or '（未填写）'}\n主题：{draft.subject}",
        "confirm_label": "发送",
        "danger": False,
    }


@tool(
    "outreach_send",
    description="用已绑定的企业邮箱发送开发信。会先请用户确认收件人和主题。",
    args=SendArgs,
    label="发送开发信",
    requires_confirmation=True,
    describe_confirm=_describe_send,
    side_effect="write",
)
async def outreach_send(ctx: ToolContext, args: SendArgs) -> ToolResult:
    from app.core.deps import CompanyScope
    from app.modules.outreach.router import send_draft

    draft = _draft(ctx, args.draft_id)
    account = _account(ctx)
    if account is None:
        raise ToolError("还没有绑定发信邮箱，可以复制开发信用自己的邮箱发送，或在「我的 → 发信邮箱」中绑定")
    scope = CompanyScope(company=ctx.company, user=ctx.user, role=ctx.role)
    try:
        result = await send_draft(ctx.db, scope, draft, account.id)
    except AppError as exc:
        raise ToolError(exc.message) from exc
    return ToolResult(
        data={"sent": True, "to": draft.to_email, "remaining_today": result.remaining_today},
        summary=f"已发送给 {draft.to_email}",
    )


class StageArgs(ToolArgs):
    lead_id: uuid.UUID
    stage: Literal["viewed", "contacted", "replied", "inquiry", "quoted", "sampling", "won", "lost", "invalid"]
    note: str = Field(default="", max_length=500)
    lost_reason: Literal["", "no_reply", "price", "spec_mismatch", "competitor", "not_real", "other"] = ""


def _describe_stage(ctx: ToolContext, args: StageArgs) -> dict[str, Any]:
    lead = _lead(ctx, args.lead_id)
    reason = f"（{service.LOST_REASONS[args.lost_reason]}）" if args.lost_reason else ""
    return {
        "title": "更新跟进阶段",
        "summary": f"商机：{lead.title}\n变更为：{service.STAGE_LABELS[args.stage]}{reason}",
        "confirm_label": "更新",
        "danger": args.stage in ("lost", "invalid"),
    }


@tool(
    "pipeline_update_stage",
    description="更新商机的跟进阶段（已联系 / 已回复 / 已询价 / 已报价 / 打样中 / 已成交 / 已放弃 / 无效）。",
    args=StageArgs,
    label="更新跟进阶段",
    side_effect="write",
    requires_confirmation=True,
    describe_confirm=_describe_stage,
)
def pipeline_update_stage(ctx: ToolContext, args: StageArgs) -> ToolResult:
    lead = _lead(ctx, args.lead_id)
    try:
        pipe = service.change_stage(
            ctx.db, lead, args.stage, user_id=ctx.user.id, note=args.note, lost_reason=args.lost_reason
        )
    except AppError as exc:
        raise ToolError(exc.message) from exc
    label = service.STAGE_LABELS[pipe.stage]
    return ToolResult(
        data={"lead_id": str(lead.id), "stage": pipe.stage, "label": label}, summary=f"已更新为「{label}」"
    )


class NoArgs(ToolArgs):
    pass


@tool(
    "pipeline_list_due", description="列出到期需要跟进的商机（「今天该跟进哪些？」）。", args=NoArgs, label="查询待跟进"
)
def pipeline_list_due(ctx: ToolContext, args: NoArgs) -> ToolResult:
    now = utcnow()
    items = [
        {
            "lead_id": str(lead.id),
            "title": lead.title,
            "next_action": pipe.next_action,
            "next_action_at": pipe.next_action_at.isoformat() if pipe.next_action_at else None,
            "overdue": bool(pipe.next_action_at and pipe.next_action_at < now),
            "stage": service.STAGE_LABELS[pipe.stage],
        }
        for lead, pipe in service.due_items(ctx.db, ctx.company_id, now, limit=10)
    ]
    return ToolResult(
        data={"count": len(items), "items": items},
        card={"card_type": "follow_ups", "payload": {"items": items}} if items else None,
        summary=f"{len(items)} 条待跟进",
    )


class ReportArgs(ToolArgs):
    week: Literal["this", "last"] = "last"


@tool("report_weekly", description="查看效果周报（本周截至目前，或上一周）。", args=ReportArgs, label="生成周报")
def report_weekly(ctx: ToolContext, args: ReportArgs) -> ToolResult:
    from datetime import timedelta

    day = utcnow().date() - (timedelta(days=7) if args.week == "last" else timedelta())
    start, end = service.week_bounds(day)
    stats = service.weekly_stats(ctx.db, ctx.company_id, start, end)
    tips = service.weekly_suggestions(stats, service.due_today_count(ctx.db, ctx.company_id))
    return ToolResult(
        data={"stats": stats, "markdown": service.weekly_markdown(stats, tips)},
        summary="周报已生成",
    )
