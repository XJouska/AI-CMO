import logging
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.database import get_database
from app.middleware.auth_middleware import get_current_user
from app.services.seo_service import get_seo_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/seo", tags=["seo"])


class SEOCheckRequest(BaseModel):
    url: str


@router.post("/check")
async def start_seo_check(request: SEOCheckRequest, current_user=Depends(get_current_user)):
    """Run a full SEO health check on the given URL."""
    seo = get_seo_service()
    try:
        result = await seo.check(request.url, current_user["id"])
        return {"status": "completed", **result}
    except Exception as e:
        logger.exception(f"SEO check failed: {e}")
        raise HTTPException(status_code=500, detail=f"SEO check failed: {str(e)}")


@router.get("/latest")
async def get_latest_seo(current_user=Depends(get_current_user)):
    db = get_database()
    health = db.get_latest_seo(current_user["id"])
    return {"health": health}


@router.get("/history")
async def get_seo_history(current_user=Depends(get_current_user)):
    db = get_database()
    history = db.get_seo_history(current_user["id"])
    return {"history": history}
