import logging
from datetime import datetime

from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel, EmailStr
from typing import Optional

from app.database import get_database, User
from app.middleware.auth_middleware import get_current_user
from app.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


def _get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip.strip()
    return request.client.host if request.client else ""


def _ip_to_country(ip: str) -> str:
    if not ip or ip in ("127.0.0.1", "::1", "localhost"):
        return ""
    try:
        import httpx
        resp = httpx.get(f"http://ip-api.com/json/{ip}?fields=country,countryCode", timeout=3)
        if resp.status_code == 200:
            data = resp.json()
            return data.get("country", "")
    except Exception:
        pass
    return ""


def _update_user_ip(user_id: int, ip: str, is_register: bool = False):
    try:
        db = get_database()
        s = db.get_session()
        try:
            user = s.query(User).filter(User.id == user_id).first()
            if user:
                user.last_login_ip = ip
                user.last_login_at = datetime.utcnow()
                if is_register:
                    user.register_ip = ip
                if not user.country and ip:
                    user.country = _ip_to_country(ip)
                s.commit()
        finally:
            s.close()
    except Exception as e:
        logger.warning(f"Failed to update user IP: {e}")


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
async def register(request: RegisterRequest, req: Request):
    db = get_database()
    user_id = db.create_user(
        request.username, request.email, request.password,
        referral_code=request.referral_code,
        response_language=request.response_language,
    )
    if not user_id:
        raise HTTPException(status_code=400, detail="Username or email already exists")
    ip = _get_client_ip(req)
    _update_user_ip(user_id, ip, is_register=True)
    token = db.create_session(user_id)
    user = db.get_user_by_id(user_id)
    return AuthResponse(
        success=True, message="Registration successful",
        token=token, user=user,
    )


@router.post("/login", response_model=AuthResponse)
async def login(request: LoginRequest, req: Request):
    db = get_database()
    user = db.authenticate_user(request.email, request.password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user["is_active"]:
        raise HTTPException(status_code=403, detail="Account disabled")
    ip = _get_client_ip(req)
    _update_user_ip(user["id"], ip)
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
    primary_url: Optional[str] = None


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
    if request.primary_url is not None:
        updates["primary_url"] = request.primary_url
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


# ---- Google OAuth ----

class GoogleAuthRequest(BaseModel):
    credential: str


@router.post("/google", response_model=AuthResponse)
async def google_auth(request: GoogleAuthRequest, req: Request):
    """Verify Google ID token and login/register user."""
    if not settings.google_client_id:
        raise HTTPException(status_code=501, detail="Google login not configured")

    try:
        from google.oauth2 import id_token
        from google.auth.transport import requests as google_requests
        idinfo = id_token.verify_oauth2_token(
            request.credential, google_requests.Request(), settings.google_client_id
        )
    except Exception as e:
        logger.warning(f"Google token verification failed: {e}")
        raise HTTPException(status_code=401, detail="Invalid Google token")

    email = idinfo.get("email")
    name = idinfo.get("name", "")
    if not email:
        raise HTTPException(status_code=400, detail="No email in Google token")

    db = get_database()
    ip = _get_client_ip(req)
    user = db.authenticate_by_email(email)
    if user:
        _update_user_ip(user["id"], ip)
        token = db.create_session(user["id"])
        return AuthResponse(success=True, message="Login successful", token=token, user=user)

    username = name.replace(" ", "_").lower()[:40] or email.split("@")[0]
    import secrets
    password = secrets.token_urlsafe(24)
    user_id = db.create_user(username, email, password)
    if not user_id:
        base = username
        for i in range(1, 10):
            user_id = db.create_user(f"{base}_{i}", email, password)
            if user_id:
                break
    if not user_id:
        raise HTTPException(status_code=500, detail="Failed to create account")

    _update_user_ip(user_id, ip, is_register=True)
    token = db.create_session(user_id)
    user = db.get_user_by_id(user_id)
    return AuthResponse(success=True, message="Account created via Google", token=token, user=user)


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


@router.delete("/api-keys/{key_id}/permanent")
async def delete_api_key(key_id: int, current_user=Depends(get_current_user)):
    """Permanently delete an API key"""
    db = get_database()
    success = db.delete_api_key(key_id, current_user["id"])
    if not success:
        raise HTTPException(status_code=404, detail="API key not found")
    return {"success": True, "message": "API key deleted"}
