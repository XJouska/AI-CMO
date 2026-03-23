from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, EmailStr
from typing import Optional

from app.database import get_database
from app.middleware.auth_middleware import get_current_user

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


class RegisterRequest(BaseModel):
    username: str
    email: EmailStr
    password: str
    referral_code: Optional[str] = None
    response_language: str = "en"  # en/zh/ja/ko/es/fr/de/pt/ru/ar


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class AuthResponse(BaseModel):
    success: bool
    message: str
    token: Optional[str] = None
    user: Optional[dict] = None


@router.post("/register", response_model=AuthResponse)
async def register(request: RegisterRequest):
    db = get_database()
    user_id = db.create_user(
        request.username, request.email, request.password,
        referral_code=request.referral_code,
        response_language=request.response_language,
    )
    if not user_id:
        raise HTTPException(status_code=400, detail="Username or email already exists")
    token = db.create_session(user_id)
    user = db.get_user_by_id(user_id)
    return AuthResponse(
        success=True, message="Registration successful",
        token=token, user=user,
    )


@router.post("/login", response_model=AuthResponse)
async def login(request: LoginRequest):
    db = get_database()
    user = db.authenticate_user(request.email, request.password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user["is_active"]:
        raise HTTPException(status_code=403, detail="Account disabled")
    token = db.create_session(user["id"])
    return AuthResponse(
        success=True, message="Login successful",
        token=token, user=user,
    )


@router.get("/me")
async def get_me(current_user=Depends(get_current_user)):
    return {"success": True, "user": current_user}


class UpdateSettingsRequest(BaseModel):
    response_language: Optional[str] = None
    brand_voice: Optional[str] = None


@router.put("/settings")
async def update_settings(request: UpdateSettingsRequest, current_user=Depends(get_current_user)):
    db = get_database()
    updates = {}
    if request.response_language:
        valid_langs = {"en", "zh", "ja", "ko", "es", "fr", "de", "pt", "ru", "ar"}
        if request.response_language not in valid_langs:
            raise HTTPException(status_code=400, detail=f"Invalid language. Choose from: {', '.join(sorted(valid_langs))}")
        updates["response_language"] = request.response_language
    if request.brand_voice is not None:
        updates["brand_voice"] = request.brand_voice
    if updates:
        session = db.get_session()
        try:
            from app.database import User
            user = session.query(User).filter(User.id == current_user["id"]).first()
            if user:
                for k, v in updates.items():
                    setattr(user, k, v)
                session.commit()
        finally:
            session.close()
    updated_user = db.get_user_by_id(current_user["id"])
    return {"success": True, "user": updated_user}


@router.post("/logout")
async def logout(current_user=Depends(get_current_user)):
    return {"success": True, "message": "Logged out"}


# ---- API Key Management ----

class CreateApiKeyRequest(BaseModel):
    name: str = "Default"


@router.post("/api-keys")
async def create_api_key(request: CreateApiKeyRequest, current_user=Depends(get_current_user)):
    """Generate a new API key for external access"""
    db = get_database()
    raw_key = db.generate_api_key(current_user["id"], request.name)
    if not raw_key:
        raise HTTPException(status_code=500, detail="Failed to create API key")
    return {
        "success": True,
        "api_key": raw_key,
        "message": "Save this key securely — it won't be shown again",
    }


@router.get("/api-keys")
async def list_api_keys(current_user=Depends(get_current_user)):
    """List all API keys (shows prefix only)"""
    db = get_database()
    keys = db.list_api_keys(current_user["id"])
    return {"api_keys": keys}


@router.delete("/api-keys/{key_id}")
async def revoke_api_key(key_id: int, current_user=Depends(get_current_user)):
    """Revoke an API key"""
    db = get_database()
    success = db.revoke_api_key(key_id, current_user["id"])
    if not success:
        raise HTTPException(status_code=404, detail="API key not found")
    return {"success": True, "message": "API key revoked"}
