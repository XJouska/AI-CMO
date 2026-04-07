import logging
from fastapi import APIRouter, Depends
from app.database import get_database
from app.middleware.auth_middleware import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/terminal", tags=["terminal"])

@router.get("/recent")
async def get_recent_logs(current_user=Depends(get_current_user)):
    db = get_database()
    activities = db.get_recent_activities(current_user["id"], limit=30)
    logs = []
    for a in reversed(activities):
        ts = a.get("created_at", "")[:19].replace("T", " ")
        logs.append({"timestamp": ts, "message": a.get("title", ""), "type": a.get("event_type", "info")})
    return {"logs": logs}
