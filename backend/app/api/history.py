from fastapi import APIRouter, Depends

from app.database import get_database
from app.middleware.auth_middleware import get_current_user

router = APIRouter(prefix="/api/v1/chat", tags=["history"])


@router.get("/history")
async def get_history(current_user=Depends(get_current_user)):
    db = get_database()
    conversations = db.get_conversations(current_user["id"])
    return {"conversations": conversations}


@router.get("/history/{conv_id}")
async def get_history_detail(conv_id: str, current_user=Depends(get_current_user)):
    db = get_database()
    detail = db.get_conversation_detail(conv_id, current_user["id"])
    if not detail:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Not found")
    return detail


@router.delete("/history/{conv_id}")
async def delete_history(conv_id: str, current_user=Depends(get_current_user)):
    db = get_database()
    success = db.delete_conversation(conv_id, current_user["id"])
    if not success:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Not found")
    return {"success": True}
