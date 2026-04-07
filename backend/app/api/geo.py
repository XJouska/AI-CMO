import logging
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List

from app.database import get_database
from app.middleware.auth_middleware import get_current_user
from app.services.geo_service import get_geo_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/geo", tags=["geo"])


class GEOScanRequest(BaseModel):
    brand_name: str
    url: Optional[str] = None
    keywords: List[str] = []


@router.post("/scan")
async def start_geo_scan(request: GEOScanRequest, current_user=Depends(get_current_user)):
    """Run a GEO visibility scan across AI search platforms."""
    geo = get_geo_service()
    try:
        result = await geo.scan(request.brand_name, request.keywords, current_user["id"], url=request.url)
        return {"status": "completed", **result}
    except Exception as e:
        logger.exception(f"GEO scan failed: {e}")
        raise HTTPException(status_code=500, detail=f"GEO scan failed: {str(e)}")


@router.get("/latest")
async def get_latest_geo(current_user=Depends(get_current_user)):
    db = get_database()
    records = db.get_latest_geo(current_user["id"])
    overall = 0
    if records:
        scores = [r.get("visibility_score", 0) for r in records]
        overall = round(sum(scores) / len(scores)) if scores else 0
    return {"visibility": records, "overall_score": overall}


@router.get("/history")
async def get_geo_history(current_user=Depends(get_current_user)):
    db = get_database()
    history = db.get_geo_history(current_user["id"])
    return {"history": history}
