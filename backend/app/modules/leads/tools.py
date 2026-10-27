"""商机相关的助手工具。"""

from __future__ import annotations

import uuid
from typing import Any, Literal

from pydantic import Field
from sqlalchemy import func, select

from app.core.errors import AppError
from app.modules.assistant.tools import ToolArgs, ToolContext, ToolError, ToolResult, tool
from app.modules.leads import pipeline
from app.modules.leads.models import Lead, Watch
from app.modules.leads.router import draft_from_profile
from app.modules.leads.scoring import DIMENSION_LABELS


class NoArgs(ToolArgs):
    pass


def _lead_brief(lead: Lead) -> dict[str, Any]:
    return {
        "id": str(lead.id),
        "type": lead.type,
        "title": lead.title,
        "market": lead.market,
        "score": lead.score,
        "summary": lead.summary_cn[:200],
        "deadline": lead.deadline.date().isoformat() if lead.deadline else None,
    }


def _describe_create(ctx: ToolContext, args: NoArgs) -> dict[str, Any]:
    return {
        "title": "开启商机监控",
        "summary": "将根据企业档案中的产品和出口市场创建每日监控计划，并立即运行一次。",
        "confirm_label": "开启",
        "danger": False,
    }


@tool(
    "watch_create_from_profile",
    description="根据企业档案自动创建商机监控计划并立即运行。会先请用户确认。",
    args=NoArgs,
    label="创建商机监控",
    requires_confirmation=True,
    describe_confirm=_describe_create,
)
def watch_create_from_profile(ctx: ToolContext, args: NoArgs) -> ToolResult:
    try:
        watch = draft_from_profile(ctx.db, ctx.company)
    except AppError as exc:
        raise ToolError(exc.message) from exc
    watch.status, watch.is_active = "active", True
    pipeline.start_run(ctx.db, watch, "manual")
    return ToolResult(
        data={"watch_id": str(watch.id), "keywords": watch.keywords_en, "markets": watch.markets},
        card={
            "card_type": "watch",
            "payload": {
                "watch_id": str(watch.id),
                "name": watch.name,
                "keywords": watch.keywords_en,
                "markets": watch.markets,
            },
        },
        summary="已开启监控",
    )


class WatchUpdateArgs(ToolArgs):
    watch_id: uuid.UUID | None = Field(default=None, description="不填则修改第一个监控计划")
    add_keywords: list[str] = Field(default_factory=list, max_length=10)
    remove_keywords: list[str] = Field(default_factory=list, max_length=10)
    markets: list[str] | None = Field(default=None, max_length=20)
    frequency: Literal["daily", "weekly"] | None = None


@tool("watch_update", description="修改商机监控的关键词、目标市场或频率。", args=WatchUpdateArgs, label="修改监控")
def watch_update(ctx: ToolContext, args: WatchUpdateArgs) -> ToolResult:
    stmt = select(Watch).where(Watch.company_id == ctx.company_id)
    watch = ctx.db.scalar(stmt.where(Watch.id == args.watch_id) if args.watch_id else stmt.order_by(Watch.created_at))
    if watch is None:
        raise ToolError("还没有监控计划")
    remove = {k.lower() for k in args.remove_keywords}
    keywords = [k for k in watch.keywords_en if k.lower() not in remove]
    watch.keywords_en = list(dict.fromkeys([*keywords, *[k.strip()[:60] for k in args.add_keywords if k.strip()]]))[:20]
    if args.markets is not None:
        watch.markets = list(dict.fromkeys(m.strip()[:60] for m in args.markets if m.strip()))[:20]
    if args.frequency:
        watch.frequency = args.frequency
    return ToolResult(
        data={"keywords": watch.keywords_en, "markets": watch.markets, "frequency": watch.frequency},
        summary="已更新监控",
    )


class SearchArgs(ToolArgs):
    query: str = Field(default="", max_length=100, description="关键词（标题、摘要中匹配）")
    market: str = Field(default="", max_length=60)
    type: Literal["tender", "rfq", "buyer_intent", "prospect", "site_inquiry", ""] = ""
    limit: int = Field(default=5, ge=1, le=10)


@tool(
    "lead_search",
    description="查询已有的商机（只包含复核通过的）。例如「看看德国的阀门招标」。",
    args=SearchArgs,
    label="查询商机",
)
def lead_search(ctx: ToolContext, args: SearchArgs) -> ToolResult:
    stmt = select(Lead).where(Lead.company_id == ctx.company_id, Lead.review_status == "approved")
    if args.market:
        stmt = stmt.where(func.lower(Lead.market) == args.market.lower())
    if args.type:
        stmt = stmt.where(Lead.type == args.type)
    if args.query:
        like = f"%{args.query.lower()}%"
        stmt = stmt.where(func.lower(Lead.title).like(like) | func.lower(Lead.summary_cn).like(like))
    leads = ctx.db.scalars(stmt.order_by(Lead.score.desc(), Lead.created_at.desc()).limit(args.limit)).all()
    return ToolResult(
        data={"count": len(leads), "leads": [_lead_brief(lead) for lead in leads]},
        card={"card_type": "lead_list", "payload": {"leads": [_lead_brief(lead) for lead in leads]}} if leads else None,
        summary=f"找到 {len(leads)} 条商机",
    )


class ExplainArgs(ToolArgs):
    lead_id: uuid.UUID


@tool("lead_explain", description="解释为什么推荐某条商机（匹配理由与评分明细）。", args=ExplainArgs, label="解读商机")
def lead_explain(ctx: ToolContext, args: ExplainArgs) -> ToolResult:
    lead = ctx.db.get(Lead, args.lead_id)
    if lead is None or lead.company_id != ctx.company_id or lead.review_status != "approved":
        raise ToolError("商机不存在")
    return ToolResult(
        data={
            **_lead_brief(lead),
            "reasons": lead.reasons,
            "suggested_action": lead.suggested_action,
            "score_detail": {DIMENSION_LABELS[k]: v for k, v in lead.score_detail.items()},
        },
        card={"card_type": "lead_list", "payload": {"leads": [_lead_brief(lead)]}},
        summary=lead.title,
    )


@tool("lead_run_now", description="立即运行一次商机监控。", args=NoArgs, label="运行商机监控")
def lead_run_now(ctx: ToolContext, args: NoArgs) -> ToolResult:
    watches = ctx.db.scalars(select(Watch).where(Watch.company_id == ctx.company_id, Watch.is_active.is_(True))).all()
    if not watches:
        raise ToolError("还没有开启的监控计划，可以先让我根据档案创建一个")
    runs = [pipeline.start_run(ctx.db, w, "manual") for w in watches[:3]]
    return ToolResult(
        data={"runs": len(runs), "note": "监控在后台运行，新商机复核后会出现在「商机」页"},
        summary=f"已启动 {len(runs)} 个监控",
    )
