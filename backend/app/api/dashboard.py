from fastapi import APIRouter, Depends
from app.database import get_database
from app.middleware.auth_middleware import get_current_user

router = APIRouter(prefix="/api/v1/dashboard", tags=["dashboard"])


@router.get("/overview")
async def get_overview(current_user=Depends(get_current_user)):
    db = get_database()
    return db.get_dashboard_overview(current_user["id"])


@router.get("/recent-activity")
async def get_recent_activity(current_user=Depends(get_current_user)):
    db = get_database()
    activities = db.get_recent_activities(current_user["id"])
    return {"activities": activities}
