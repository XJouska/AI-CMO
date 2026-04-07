import json
import logging
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from sse_starlette.sse import EventSourceResponse
from app.middleware.auth_middleware import get_current_user
from app.services.content_writer import get_content_writer

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/content", tags=["content"])

class ContentRequest(BaseModel):
    conversation_id: str
    platform: str
    content_type: str = "comment"
    tone: str = ""

@router.post("/generate")
async def generate_content(request: ContentRequest, current_user=Depends(get_current_user)):
    cw = get_content_writer()
    brand_voice = current_user.get("brand_voice", "")
    try:
        content = await cw.generate(
            request.conversation_id, current_user["id"],
            request.platform, request.content_type,
            brand_voice, request.tone
        )
        return {"content": content, "platform": request.platform, "content_type": request.content_type}
    except Exception as e:
        logger.exception(f"Content generation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/generate/stream")
async def generate_content_stream(request: ContentRequest, current_user=Depends(get_current_user)):
    cw = get_content_writer()
    brand_voice = current_user.get("brand_voice", "")
    async def event_gen():
        async for chunk in cw.generate_stream(
            request.conversation_id, current_user["id"],
            request.platform, request.content_type,
            brand_voice, request.tone
        ):
            yield {"event": "chunk", "data": json.dumps({"text": chunk})}
        yield {"event": "done", "data": "{}"}
    return EventSourceResponse(event_gen())
