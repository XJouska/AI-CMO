import logging
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from sse_starlette.sse import EventSourceResponse

from app.database import get_database
from app.middleware.auth_middleware import get_current_user
from app.services.llm import LLMService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/ai-chat", tags=["ai-chat"])
llm = LLMService()


class ChatRequest(BaseModel):
    message: str
    conversation_id: Optional[str] = None


@router.post("/message")
async def chat_message(request: ChatRequest, current_user=Depends(get_current_user)):
    db = get_database()
    user_id = current_user["id"]
    response_lang = current_user.get("response_language", "en")

    db.save_chat_message(user_id, "user", request.message, request.conversation_id)

    history = db.get_chat_messages(user_id, request.conversation_id, limit=20)

    context_parts = []
    if request.conversation_id:
        detail = db.get_conversation_detail(request.conversation_id, user_id)
        if detail:
            context_parts.append(f"Analysis for: {detail.get('input_value', '')}")
            if detail.get('recommendations'):
                rec_summary = ", ".join([
                    f"#{r['rank']} {r['platform']}: {r['title']}"
                    for r in detail['recommendations'][:5]
                ])
                context_parts.append(f"Top recommendations: {rec_summary}")

    system_prompt = f"""You are AI-CMO, an intelligent marketing assistant. Help users understand their marketing analysis results and provide actionable advice.

Respond in the user's preferred language: {response_lang}.

{chr(10).join(context_parts) if context_parts else "No specific analysis context."}

Be concise, practical, and data-driven in your responses."""

    messages = [{"role": "system", "content": system_prompt}]
    for msg in history[-10:]:
        messages.append({"role": msg["role"], "content": msg["content"]})

    async def generate():
        full_response = ""
        try:
            async for chunk in llm.chat_stream(messages):
                full_response += chunk
                yield {"event": "content", "data": chunk}
            db.save_chat_message(user_id, "assistant", full_response, request.conversation_id)
            yield {"event": "done", "data": ""}
        except Exception as e:
            logger.error(f"Chat error: {e}")
            yield {"event": "error", "data": str(e)}

    return EventSourceResponse(generate())


@router.get("/history/{conversation_id}")
async def get_chat_history(conversation_id: str, current_user=Depends(get_current_user)):
    db = get_database()
    messages = db.get_chat_messages(current_user["id"], conversation_id)
    return {"messages": messages}
