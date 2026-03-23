import logging
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional

from app.database import get_database
from app.middleware.auth_middleware import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/seo", tags=["seo"])


class SEOCheckRequest(BaseModel):
    url: str


@router.post("/check")
async def start_seo_check(request: SEOCheckRequest, current_user=Depends(get_current_user)):
    """Placeholder for SEO health check. Will integrate PageSpeed Insights + AgentGo scraping."""
    db = get_database()
    db.add_activity(
        current_user["id"], "seo_check_requested",
        f"SEO check requested for: {request.url}",
        {"url": request.url},
    )
    return {
        "status": "coming_soon",
        "message": "SEO health checking is under development. Check back soon!",
        "url": request.url,
    }


@router.get("/latest")
async def get_latest_seo(current_user=Depends(get_current_user)):
    return {"health": None, "message": "No SEO checks yet"}


@router.get("/history")
async def get_seo_history(current_user=Depends(get_current_user)):
    return {"history": [], "message": "No SEO check history"}
