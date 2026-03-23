"""
Public API for external integrations (OpenClaw, etc.)
Authentication via API key (x-api-key header)
"""
import json
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel, Field

from app.database import get_database
from app.services.workflow import AnalysisWorkflow
from app.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/open", tags=["open-api"])


# ======================== API Key Auth ========================

async def verify_api_key(x_api_key: str = Header(..., description="Your API key")) -> dict:
    """Verify API key and return user info"""
    db = get_database()
    user = db.verify_api_key(x_api_key)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid API key")
    if not user.get("is_active"):
        raise HTTPException(status_code=403, detail="Account disabled")
    return user


# ======================== Request/Response Models ========================

class AnalyzeRequest(BaseModel):
    product: str = Field(..., description="Product URL or name to analyze", min_length=1, max_length=500)
    language: str = Field("en", description="Response language: en/zh/ja/ko/es/fr/de/pt/ru/ar")
    max_results: int = Field(10, ge=1, le=20, description="Max recommendations to return")


class PromotionSpot(BaseModel):
    rank: int
    platform: str
    url: str
    title: str
    why_recommend: Optional[str] = None
    suggested_comment: Optional[str] = None
    comment_strategy: Optional[str] = None
    estimated_exposure: Optional[str] = None
    best_timing: Optional[str] = None
    risk_level: Optional[str] = None
    risk_note: Optional[str] = None
    composite_score: Optional[float] = None
    engagement_stats: Optional[dict] = None


class StrategyInfo(BaseModel):
    priority_actions: Optional[list] = None
    weekly_plan: Optional[str] = None
    content_calendar: Optional[str] = None
    kpi_targets: Optional[str] = None
    budget_suggestion: Optional[str] = None


class AnalyzeResponse(BaseModel):
    success: bool
    product_name: str = ""
    product_type: str = ""
    total_found: int = 0
    platforms_searched: int = 0
    promotions: list[PromotionSpot] = []
    strategy: Optional[StrategyInfo] = None
    credits_remaining: int = 0


class QuotaResponse(BaseModel):
    credits_remaining: int
    username: str
    is_premium: bool


# ======================== Endpoints ========================

@router.get("/quota", response_model=QuotaResponse)
async def get_quota(user: dict = Depends(verify_api_key)):
    """Check remaining credits"""
    db = get_database()
    balance = db.get_credit_balance(user["id"])
    return QuotaResponse(
        credits_remaining=balance,
        username=user["username"],
        is_premium=user.get("is_premium", False),
    )


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze_product(request: AnalyzeRequest, user: dict = Depends(verify_api_key)):
    """
    Analyze a product/URL and find the best promotion spots across social media.

    This is the core API: input a product URL or name, get back ranked promotion
    opportunities with suggested comments and strategy.

    Consumes 1 credit per call.
    """
    db = get_database()
    user_id = user["id"]

    # Check credits
    balance = db.get_credit_balance(user_id)
    if balance <= 0:
        raise HTTPException(status_code=402, detail="Insufficient credits")

    # Deduct credit
    success, new_balance = db.deduct_credit(user_id, 1, f"API: {request.product[:50]}")
    if not success:
        raise HTTPException(status_code=402, detail="Failed to deduct credits")

    logger.info(f"[OPEN-API] user={user['username']} product='{request.product[:60]}' lang={request.language}")

    # Validate language
    valid_langs = {"en", "zh", "ja", "ko", "es", "fr", "de", "pt", "ru", "ar"}
    lang = request.language if request.language in valid_langs else "en"

    # Run workflow (non-streaming, collect all results)
    workflow = AnalysisWorkflow()
    promotions = []
    strategy_data = None
    product_name = ""
    product_type = ""
    total_found = 0
    platforms_searched = 0

    try:
        async for event in workflow.run(request.product, user_id, lang):
            if event.event == "product_info":
                product_name = event.data.get("product_name", "")
                product_type = event.data.get("product_type", "")
            elif event.event == "thinking" and "已识别产品" in str(event.data.get("content", "")):
                if not product_name:
                    content = event.data.get("content", "")
                    # Extract from "✅ 已识别产品: Name (Type)"
                    import re
                    m = re.search(r'已识别产品:\s*(.+?)\s*\((.+?)\)', content)
                    if m:
                        product_name = m.group(1)
                        product_type = m.group(2)
            elif event.event == "result":
                d = event.data
                promotions.append(PromotionSpot(
                    rank=d.get("rank", 0),
                    platform=d.get("platform", ""),
                    url=d.get("url", ""),
                    title=d.get("title", ""),
                    why_recommend=d.get("why_recommend"),
                    suggested_comment=d.get("suggested_comment"),
                    comment_strategy=d.get("comment_strategy"),
                    estimated_exposure=d.get("estimated_exposure"),
                    best_timing=d.get("best_timing"),
                    risk_level=d.get("risk_level"),
                    risk_note=d.get("risk_note"),
                    composite_score=d.get("composite_score"),
                    engagement_stats=d.get("engagement_stats"),
                ))
            elif event.event == "strategy":
                d = event.data
                if isinstance(d, dict):
                    strategy_data = StrategyInfo(
                        priority_actions=d.get("priority_actions"),
                        weekly_plan=d.get("weekly_plan"),
                        content_calendar=d.get("content_calendar"),
                        kpi_targets=d.get("kpi_targets"),
                        budget_suggestion=d.get("budget_suggestion"),
                    )
            elif event.event == "done":
                total_found = event.data.get("total_found", 0)
                platforms_searched = event.data.get("platforms_searched", 0)
            elif event.event == "error":
                # Refund on error
                db.refund_credit(user_id, 1, "API refund: analysis failed")
                raise HTTPException(status_code=500, detail=event.data.get("message", "Analysis failed"))

    except HTTPException:
        raise
    except Exception as e:
        db.refund_credit(user_id, 1, "API refund: error")
        logger.exception(f"[OPEN-API] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    # Trim to max_results
    promotions = promotions[:request.max_results]

    return AnalyzeResponse(
        success=True,
        product_name=product_name,
        product_type=product_type,
        total_found=total_found,
        platforms_searched=platforms_searched,
        promotions=promotions,
        strategy=strategy_data,
        credits_remaining=db.get_credit_balance(user_id),
    )


@router.get("/history")
async def get_history(limit: int = 20, user: dict = Depends(verify_api_key)):
    """Get recent analysis history"""
    db = get_database()
    conversations = db.get_conversations(user["id"], limit=limit)
    return {"conversations": conversations}


@router.get("/history/{conversation_id}")
async def get_history_detail(conversation_id: str, user: dict = Depends(verify_api_key)):
    """Get detailed results from a past analysis"""
    db = get_database()
    detail = db.get_conversation_detail(conversation_id, user["id"])
    if not detail:
        raise HTTPException(status_code=404, detail="Not found")
    return detail
