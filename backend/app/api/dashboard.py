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


@router.get("/trends")
async def get_trends(current_user=Depends(get_current_user)):
    """Get analysis trends over the last 30 days."""
    db = get_database()
    session = db.get_session()
    try:
        from sqlalchemy import func, cast, Date
        from app.database import Conversation
        from datetime import datetime, timedelta

        thirty_days_ago = datetime.utcnow() - timedelta(days=30)
        rows = session.query(
            cast(Conversation.created_at, Date).label("date"),
            func.count(Conversation.id).label("count"),
        ).filter(
            Conversation.user_id == current_user["id"],
            Conversation.created_at >= thirty_days_ago,
        ).group_by(cast(Conversation.created_at, Date)).order_by("date").all()

        trends = [{"date": str(row.date), "count": row.count} for row in rows]
        return {"trends": trends}
    finally:
        session.close()
