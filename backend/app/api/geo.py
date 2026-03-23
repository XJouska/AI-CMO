import logging
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional

from app.database import get_database
from app.middleware.auth_middleware import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/geo", tags=["geo"])


class GEOScanRequest(BaseModel):
    brand_name: str
    url: Optional[str] = None


@router.post("/scan")
async def start_geo_scan(request: GEOScanRequest, current_user=Depends(get_current_user)):
    """Placeholder for GEO visibility scan. Will use AgentGo to query AI platforms."""
    db = get_database()
    db.add_activity(
        current_user["id"], "geo_scan_requested",
        f"GEO scan requested for: {request.brand_name}",
        {"brand_name": request.brand_name, "url": request.url},
    )
    return {
        "status": "coming_soon",
        "message": "GEO visibility scanning is under development. Check back soon!",
        "brand_name": request.brand_name,
    }


@router.get("/latest")
async def get_latest_geo(current_user=Depends(get_current_user)):
    return {"visibility": None, "message": "No GEO scans yet"}


@router.get("/history")
async def get_geo_history(current_user=Depends(get_current_user)):
    return {"history": [], "message": "No GEO scan history"}
