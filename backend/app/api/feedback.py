from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional

from app.database import get_database
from app.middleware.auth_middleware import get_current_user

router = APIRouter(prefix="/api/v1/feedback", tags=["feedback"])


class FeedbackRequest(BaseModel):
    is_useful: bool
    comment: Optional[str] = ""


@router.post("/recommendations/{rec_id}")
async def submit_feedback(rec_id: str, request: FeedbackRequest,
                          current_user=Depends(get_current_user)):
    db = get_database()
    success = db.save_recommendation_feedback(
        rec_id, current_user["id"], request.is_useful, request.comment or ""
    )
    if not success:
        raise HTTPException(status_code=500, detail="Failed to save feedback")
    return {"success": True}
