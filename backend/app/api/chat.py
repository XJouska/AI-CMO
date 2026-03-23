import json
import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from app.database import get_database
from app.middleware.auth_middleware import get_current_user
from app.services.workflow import AnalysisWorkflow
from app.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/chat", tags=["chat"])


class AnalyzeRequest(BaseModel):
    input: str


@router.post("/analyze")
async def analyze(request: AnalyzeRequest, current_user=Depends(get_current_user)):
    """
    SSE streaming endpoint: receive user input, return real-time analysis stream
    """
    db = get_database()
    user_id = current_user["id"]
    username = current_user.get("username", "unknown")

    logger.info(f"[ANALYZE] user={username}(id={user_id}) input='{request.input[:80]}'")

    # Check credit balance
    balance = db.get_credit_balance(user_id)
    if balance <= 0:
        logger.warning(f"[ANALYZE] user={username} insufficient credits (balance={balance})")
        raise HTTPException(status_code=402, detail="Insufficient credits")

    # Deduct 1 credit
    success, new_balance = db.deduct_credit(user_id, 1, f"Analysis: {request.input[:50]}")
    if not success:
        raise HTTPException(status_code=402, detail="Failed to deduct credits")
    logger.info(f"[ANALYZE] user={username} credit deducted: {balance} -> {new_balance}")

    # Create conversation record
    import re
    inp = request.input.strip()
    is_url = bool(re.match(r'https?://', inp))
    if not is_url and re.match(r'^[a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}', inp) and ' ' not in inp:
        is_url = True
    input_type = "url" if is_url else "keyword"
    title = request.input[:80] if len(request.input) <= 80 else request.input[:77] + "..."
    conv_id = db.create_conversation(user_id, input_type, request.input, title)
    logger.info(f"[ANALYZE] conversation created: {conv_id}")

    # Run workflow and stream results
    response_language = current_user.get("response_language", "en")
    async def event_generator():
        workflow = AnalysisWorkflow()
        all_recommendations = []
        strategy_data = None

        try:
            async for event in workflow.run(request.input, user_id, response_language):
                yield {
                    "event": event.event,
                    "data": json.dumps(event.data, ensure_ascii=False),
                }

                # Collect results for DB persistence
                if event.event == "result":
                    all_recommendations.append(event.data)
                elif event.event == "strategy":
                    strategy_data = event.data
                elif event.event == "error":
                    # Refund credit on error
                    db.refund_credit(user_id, 1, "Refund: analysis failed")
                    db.update_conversation(conv_id, status="failed")

            if all_recommendations:
                try:
                    db.save_recommendations(conv_id, all_recommendations)
                    if strategy_data:
                        db.save_strategy(conv_id, strategy_data)
                    db.update_conversation(conv_id, status="completed",
                                           product_profile=all_recommendations[0].get("profile") if all_recommendations else None)
                    db.add_activity(
                        user_id, "analysis_completed", f"Analysis completed: {title}",
                        {"conversation_id": conv_id, "recommendation_count": len(all_recommendations)},
                    )
                except Exception as e:
                    logger.error(f"Failed to persist results: {e}")

        except Exception as e:
            logger.exception(f"Stream error: {e}")
            db.refund_credit(user_id, 1, "Refund: stream error")
            db.update_conversation(conv_id, status="failed")
            yield {
                "event": "error",
                "data": json.dumps({"message": str(e)}),
            }

    return EventSourceResponse(event_generator())


@router.get("/history")
async def get_history(current_user=Depends(get_current_user)):
    """Get user's analysis history"""
    db = get_database()
    conversations = db.get_conversations(current_user["id"])
    return {"conversations": conversations}


@router.get("/history/{conv_id}")
async def get_history_detail(conv_id: str, current_user=Depends(get_current_user)):
    """Get detailed analysis result"""
    db = get_database()
    detail = db.get_conversation_detail(conv_id, current_user["id"])
    if not detail:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Filter premium content for free users
    if not current_user.get("is_premium"):
        recs = detail.get("recommendations", [])
        for rec in recs:
            if rec.get("is_premium_only"):
                rec["suggested_comment"] = "🔒 Premium only"
                rec["comment_strategy"] = "🔒 Premium only"
                rec["why_recommend"] = rec["why_recommend"][:100] + "... 🔒"

    return detail


@router.delete("/history/{conv_id}")
async def delete_history(conv_id: str, current_user=Depends(get_current_user)):
    """Delete a conversation"""
    db = get_database()
    success = db.delete_conversation(conv_id, current_user["id"])
    if not success:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"success": True, "message": "Deleted"}
