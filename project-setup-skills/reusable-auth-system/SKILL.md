---
name: reusable-auth-system
description: Provides a complete, reusable user authentication system with registration, login, session tokens, admin permissions, referral codes, and credit balance. Use when building a new product that needs user auth, login/register, permissions, or user management.
---

# Reusable Auth System

A battle-tested user authentication system built with FastAPI + SQLAlchemy + PostgreSQL. Includes registration, login, session token auth, admin permissions, referral system, and credit balance management.

## Architecture Overview

- **Auth method**: Random session token (`secrets.token_urlsafe(32)`), stored in PostgreSQL `sessions` table, 24h expiry
- **Password hashing**: SHA256 (consider upgrading to bcrypt for production)
- **Permissions**: Boolean `is_admin` field for two-tier access control
- **Token delivery**: `Authorization: Bearer <token>` header
- **Frontend storage**: `localStorage` with axios interceptor
- **Optional**: Supabase JWT dual-auth (configured via env vars)

## Quick Integration Steps

### 1. Database Models (SQLAlchemy)

```python
from sqlalchemy import Column, Integer, String, Boolean, DateTime
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.sql import func

Base = declarative_base()

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, nullable=False, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    is_active = Column(Boolean, default=True)
    is_premium = Column(Boolean, default=False)
    is_admin = Column(Boolean, default=False)
    credit_balance = Column(Integer, default=0)
    referral_code = Column(String(10), unique=True, nullable=True, index=True)
    referred_by = Column(Integer, nullable=True)

class Session(Base):
    __tablename__ = "sessions"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, nullable=False, index=True)
    token = Column(String(255), unique=True, nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    expires_at = Column(DateTime(timezone=True), nullable=False)
```

### 2. Auth Dependency (FastAPI)

```python
from fastapi import Header, HTTPException, Depends
from typing import Optional

async def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing auth token")
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(status_code=401, detail="Invalid token format")
    token = parts[1]
    db = get_database()
    user = db.verify_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Token invalid or expired")
    return user

async def require_admin(current_user: dict = Depends(get_current_user)) -> dict:
    if not current_user.get("is_admin", False):
        raise HTTPException(status_code=403, detail="Admin required")
    return current_user
```

### 3. Core Database Methods

```python
import hashlib, secrets
from datetime import datetime, timedelta

class Database:
    def hash_password(self, password: str) -> str:
        return hashlib.sha256(password.encode()).hexdigest()

    def create_user(self, username, email, password, referral_code=None) -> Optional[int]:
        # Hash password, generate referral code, handle referral bonus
        # Initial credits: 2 (+ 2 if referred)
        ...

    def authenticate_user(self, email, password) -> Optional[dict]:
        # Verify email + password_hash, return user dict
        ...

    def create_session(self, user_id, expires_in_hours=24) -> str:
        token = secrets.token_urlsafe(32)
        # Store in sessions table with expires_at
        return token

    def verify_token(self, token) -> Optional[dict]:
        # Query sessions where token matches AND expires_at > now
        # Return user dict or None
        ...
```

### 4. API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/auth/register` | No | Register (username, email, password, optional referral_code) |
| POST | `/api/v1/auth/login` | No | Login (email, password) -> token + user |
| GET | `/api/v1/auth/me` | Yes | Get current user info + quota |
| GET | `/api/v1/auth/quota` | Yes | Get user quota |
| GET | `/api/v1/auth/logout` | No | Logout (placeholder) |

**Request/Response models:**

```python
from pydantic import BaseModel, EmailStr, Field

class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    email: EmailStr
    password: str = Field(..., min_length=6)
    referral_code: Optional[str] = None

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class AuthResponse(BaseModel):
    success: bool
    message: str
    token: Optional[str] = None
    user: Optional[dict] = None
```

### 5. Frontend Integration (React + axios)

```typescript
import axios from 'axios';

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL });

const TOKEN_KEY = 'auth_token';

export const saveAuthToken = (token: string): void => {
  localStorage.setItem(TOKEN_KEY, token);
  api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
};

export const clearAuthToken = (): void => {
  localStorage.removeItem(TOKEN_KEY);
  delete api.defaults.headers.common['Authorization'];
};

// Init on load
const initToken = localStorage.getItem(TOKEN_KEY);
if (initToken) {
  api.defaults.headers.common['Authorization'] = `Bearer ${initToken}`;
}

export const register = async (req: RegisterRequest): Promise<AuthResponse> => {
  const res = await api.post('/api/v1/auth/register', req);
  saveAuthToken(res.data.token);
  return res.data;
};

export const login = async (req: LoginRequest): Promise<AuthResponse> => {
  const res = await api.post('/api/v1/auth/login', req);
  saveAuthToken(res.data.token);
  return res.data;
};

export const getCurrentUser = async (): Promise<UserInfo | null> => {
  try { return (await api.get('/api/v1/auth/me')).data; }
  catch { return null; }
};
```

### 6. Admin Routes Pattern

All admin endpoints use `Depends(require_admin)`:

```python
router = APIRouter(prefix="/api/v1/admin", tags=["admin"])

@router.get("/dashboard")
async def get_dashboard(admin: dict = Depends(require_admin)):
    ...

@router.get("/users")
async def get_users_list(admin: dict = Depends(require_admin)):
    ...

@router.post("/users/{user_id}/toggle-admin")
async def toggle_admin(user_id: int, admin: dict = Depends(require_admin)):
    ...
```

## Referral System

- Each user gets a unique 6-char referral code (uppercase + digits) on registration
- When a new user registers with a referral code, both parties get +2 credits
- Stored in `User.referral_code` and `User.referred_by`

## API Key System

For external integrations (e.g., OpenClaw Skills):

```python
class UserApiKey(Base):
    __tablename__ = "user_api_keys"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, nullable=False, index=True)
    key_hash = Column(String(64), unique=True, index=True)  # SHA256
    key_prefix = Column(String(16))  # "sk-yt-XXXX" for display
    name = Column(String(100))
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_used_at = Column(DateTime(timezone=True), nullable=True)
```

Key format: `sk-yt-{secrets.token_urlsafe(32)}`, stored as SHA256 hash.

## Environment Variables

```
DATABASE_URL=postgresql://user:pass@localhost:5432/dbname
SECRET_KEY=your_secret_key
# Optional Supabase dual-auth
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_JWT_SECRET=
```

## Additional Reference

For complete implementation code, see [auth-reference.md](auth-reference.md).
