from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.database import get_database
from app.middleware.auth_middleware import get_current_user

router = APIRouter(prefix="/api/v1/competitors", tags=["competitors"])


class AddCompetitorRequest(BaseModel):
    name: str
    url: str
    description: str = ""


@router.post("")
async def add_competitor(request: AddCompetitorRequest,
                         current_user=Depends(get_current_user)):
    db = get_database()
    comp_id = db.add_competitor(
        current_user["id"], request.name, request.url, request.description
    )
    return {"success": True, "id": comp_id}


@router.get("")
async def list_competitors(current_user=Depends(get_current_user)):
    db = get_database()
    competitors = db.get_competitors(current_user["id"])
    return {"competitors": competitors}


@router.delete("/{comp_id}")
async def delete_competitor(comp_id: str, current_user=Depends(get_current_user)):
    db = get_database()
    success = db.delete_competitor(comp_id, current_user["id"])
    if not success:
        raise HTTPException(status_code=404, detail="Competitor not found")
    return {"success": True}
