"""第一批助手工具：企业档案与产品。"""

from __future__ import annotations

import uuid
from typing import Any

from pydantic import Field
from sqlalchemy import select

from app.core.security.ssrf import SsrfBlockedError, validate_url
from app.modules.assistant.tools import ToolArgs, ToolContext, ToolError, ToolResult, tool
from app.modules.companies import extraction as extraction_service
from app.modules.companies.extraction import (
    ExtractedCompany,
    ExtractedProduct,
    ExtractionOutput,
    build_changes,
)
from app.modules.companies.models import Product, ProfileExtraction
from app.modules.companies.profile import refresh_completeness


class NoArgs(ToolArgs):
    pass


@tool(
    "profile_get_completeness",
    description="查询当前企业档案的完整度（0-100）和缺失项。用户问档案情况、或需要引导补充档案时使用。",
    args=NoArgs,
    label="查询档案完整度",
)
def profile_get_completeness(ctx: ToolContext, _: NoArgs) -> ToolResult:
    score, missing = refresh_completeness(ctx.db, ctx.company)
    return ToolResult(
        data={"completeness": score, "missing": [{"label": m.label, "weight": m.weight} for m in missing]},
        card={
            "card_type": "profile_completeness",
            "payload": {"completeness": score, "missing": [m.label for m in missing[:5]]},
        },
        summary=f"完整度 {score}%",
    )


class UrlArgs(ToolArgs):
    url: str = Field(min_length=3, max_length=2048, description="企业现有网站地址")


@tool(
    "profile_extract_from_url",
    description="读取企业现有网站，整理出待用户确认的档案变更。用户提供了自己公司的网址时使用。",
    args=UrlArgs,
    label="读取企业网站",
)
def profile_extract_from_url(ctx: ToolContext, args: UrlArgs) -> ToolResult:
    raw = args.url if "://" in args.url else f"https://{args.url}"
    try:
        parsed = validate_url(raw)
    except SsrfBlockedError as exc:
        raise ToolError("该网址无法访问，请提供公开的企业网站地址") from exc
    item = extraction_service.create_extraction(
        ctx.db, ctx.company, ctx.user.id, source="url", payload={"url": parsed.url}
    )
    return ToolResult(
        data={
            "extraction_id": str(item.id),
            "status": "queued",
            "note": "网站内容正在后台整理，完成后用户可在卡片中确认变更",
        },
        card={
            "card_type": "profile_diff",
            "payload": {
                "extraction_id": str(item.id),
                "status": "pending",
                "source": "url",
                "url": parsed.url,
                "count": 0,
            },
        },
        summary="已开始整理网站内容",
    )


class ProfileFieldsArgs(ToolArgs):
    company: ExtractedCompany = Field(default_factory=ExtractedCompany, description="从对话中提取的公司信息")
    certifications: list[str] = Field(default_factory=list, max_length=30)
    contacts: dict[str, str] = Field(default_factory=dict, description="email / phone / whatsapp / address / website")


def _draft_extraction(ctx: ToolContext, output: ExtractionOutput) -> tuple[ProfileExtraction, list[dict[str, Any]]]:
    changes = build_changes(ctx.db, ctx.company, output)
    item = ProfileExtraction(
        company_id=ctx.company_id,
        source="chat",
        status="succeeded",
        input={"conversation_id": str(ctx.conversation_id), "message_id": str(ctx.message_id)},
        result={"changes": changes},
        created_by=ctx.user.id,
        progress=[{"key": "prepare", "label": extraction_service.STEP_LABELS["prepare"], "status": "done"}],
    )
    ctx.db.add(item)
    ctx.db.flush()
    return item, changes


@tool(
    "profile_update_fields",
    description="根据用户在对话中提供的企业信息，生成待确认的档案变更（不会直接修改档案）。只填写用户明确说过的内容。",
    args=ProfileFieldsArgs,
    label="整理档案变更",
)
def profile_update_fields(ctx: ToolContext, args: ProfileFieldsArgs) -> ToolResult:
    output = ExtractionOutput(company=args.company, certifications=args.certifications, contacts=args.contacts)
    item, changes = _draft_extraction(ctx, output)
    return ToolResult(
        data={
            "extraction_id": str(item.id),
            "change_count": len(changes),
            "changes": [{"label": c["label"], "value": c["value"]} for c in changes],
        },
        card={
            "card_type": "profile_diff",
            "payload": {
                "extraction_id": str(item.id),
                "status": "succeeded",
                "source": "chat",
                "count": len(changes),
                "labels": [c["label"] for c in changes[:6]],
            },
        },
        summary=f"整理出 {len(changes)} 项变更",
    )


class ListArgs(ToolArgs):
    limit: int = Field(default=20, ge=1, le=50)


@tool("product_list", description="列出当前企业的产品。", args=ListArgs, label="查询产品")
def product_list(ctx: ToolContext, args: ListArgs) -> ToolResult:
    products = ctx.db.scalars(
        select(Product).where(Product.company_id == ctx.company_id).order_by(Product.created_at).limit(args.limit)
    ).all()
    return ToolResult(
        data={
            "count": len(products),
            "products": [
                {
                    "id": str(p.id),
                    "name_en": p.name_en,
                    "name_cn": p.name_cn,
                    "category": p.category,
                    "keywords_en": p.keywords_en,
                }
                for p in products
            ],
        },
        summary=f"共 {len(products)} 个产品",
    )


class ProductDraftArgs(ToolArgs):
    product: ExtractedProduct


@tool(
    "product_create_draft",
    description="根据用户描述起草一个产品（英文名、类别、关键词等），生成待确认的产品草稿，不直接创建。",
    args=ProductDraftArgs,
    label="起草产品",
)
def product_create_draft(ctx: ToolContext, args: ProductDraftArgs) -> ToolResult:
    item, changes = _draft_extraction(ctx, ExtractionOutput(products=[args.product.model_dump()]))
    if not changes:
        raise ToolError("已有同名产品")
    return ToolResult(
        data={"extraction_id": str(item.id), "product": args.product.model_dump()},
        card={
            "card_type": "product_draft",
            "payload": {"extraction_id": str(item.id), **args.product.model_dump()},
        },
        summary=f"已起草 {args.product.name_en}",
    )


class ProductIdArgs(ToolArgs):
    product_id: uuid.UUID


def _own_product(ctx: ToolContext, product_id: uuid.UUID) -> Product:
    product = ctx.db.get(Product, product_id)
    if product is None or product.company_id != ctx.company_id:
        raise ToolError("产品不存在")
    return product


def _describe_delete(ctx: ToolContext, args: ProductIdArgs) -> dict[str, Any]:
    product = _own_product(ctx, args.product_id)
    return {
        "title": "删除产品",
        "summary": f"将删除产品「{product.name_en}」，删除后无法恢复。",
        "confirm_label": "删除",
        "danger": True,
    }


@tool(
    "product_delete",
    description="删除当前企业的一个产品。这是有副作用的操作，会先请用户确认。",
    args=ProductIdArgs,
    label="删除产品",
    requires_confirmation=True,
    roles=("owner", "operator"),
    describe_confirm=_describe_delete,
)
def product_delete(ctx: ToolContext, args: ProductIdArgs) -> ToolResult:
    product = _own_product(ctx, args.product_id)
    name = product.name_en
    ctx.db.delete(product)
    ctx.db.flush()
    refresh_completeness(ctx.db, ctx.company)
    return ToolResult(data={"deleted": name}, summary=f"已删除 {name}")
