"""账号与会话接口。"""

from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_db, utcnow
from app.core.deps import AuthContext, get_auth
from app.core.errors import ConflictError, RateLimitedError, ServiceUnavailableError, UnauthorizedError
from app.core.security.crypto import hash_password, ip_hash, new_token, token_hash, verify_password
from app.modules.auth.models import LoginAttempt, User
from app.modules.auth.models import Session as UserSession
from app.modules.companies.models import Company, CompanyMember

router = APIRouter(prefix="/auth", tags=["auth"])


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    name: str = Field(default="", max_length=64)

    @field_validator("password")
    @classmethod
    def _strength(cls, value: str) -> str:
        if value.isdigit() or value.isalpha():
            raise ValueError("密码需同时包含字母和数字")
        return value


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class CompanyBrief(BaseModel):
    id: str
    name_cn: str
    name_en: str
    role: str


class UserOut(BaseModel):
    id: str
    email: str
    name: str
    is_staff: bool
    companies: list[CompanyBrief]


class SessionOut(BaseModel):
    token: str
    expires_at: str
    user: UserOut


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def user_out(db: Session, user: User) -> UserOut:
    rows = db.execute(
        select(Company, CompanyMember.role)
        .join(CompanyMember, CompanyMember.company_id == Company.id)
        .where(CompanyMember.user_id == user.id, Company.status == "active")
        .order_by(CompanyMember.created_at)
    ).all()
    return UserOut(
        id=str(user.id),
        email=user.email,
        name=user.name,
        is_staff=user.is_staff,
        companies=[CompanyBrief(id=str(c.id), name_cn=c.name_cn, name_en=c.name_en, role=role) for c, role in rows],
    )


def _open_session(db: Session, user: User, request: Request) -> SessionOut:
    token = new_token()
    expires = utcnow() + timedelta(days=get_settings().session_ttl_days)
    db.add(
        UserSession(
            user_id=user.id,
            token_hash=token_hash(token),
            expires_at=expires,
            user_agent=request.headers.get("user-agent", "")[:255],
            ip_hash=ip_hash(client_ip(request)),
        )
    )
    db.flush()
    return SessionOut(token=token, expires_at=expires.isoformat(), user=user_out(db, user))


def _recent_attempts(db: Session, ip: str, kind: str, window: timedelta) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(LoginAttempt)
            .where(
                LoginAttempt.ip_hash == ip,
                LoginAttempt.kind == kind,
                LoginAttempt.created_at > utcnow() - window,
            )
        )
        or 0
    )


@router.post("/register", response_model=SessionOut, status_code=201)
def register(body: RegisterIn, request: Request, db: Session = Depends(get_db)) -> SessionOut:
    ip = ip_hash(client_ip(request))
    if _recent_attempts(db, ip, "register", timedelta(hours=1)) >= get_settings().register_ip_limit_per_hour:
        raise RateLimitedError("注册太频繁，请稍后再试")
    db.add(LoginAttempt(ip_hash=ip, email="", success=True, kind="register"))
    email = body.email.lower()
    if db.scalar(select(User.id).where(User.email == email)):
        db.commit()
        raise ConflictError("该邮箱已注册，请直接登录", code="email_taken")
    user = User(email=email, password_hash=hash_password(body.password), name=body.name.strip())
    db.add(user)
    db.flush()
    out = _open_session(db, user, request)
    db.commit()
    return out


@router.post("/login", response_model=SessionOut)
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)) -> SessionOut:
    settings = get_settings()
    ip = ip_hash(client_ip(request))
    email = body.email.lower()
    if _recent_attempts(db, ip, "login", timedelta(minutes=15)) >= settings.login_ip_limit:
        raise RateLimitedError("登录尝试太频繁，请 15 分钟后再试")

    user = db.scalar(select(User).where(User.email == email).with_for_update())
    now = utcnow()
    if user is not None and user.locked_until is not None and user.locked_until > now:
        db.add(LoginAttempt(ip_hash=ip, email=email, success=False))
        db.commit()
        raise RateLimitedError("密码错误次数过多，账号已临时锁定，请 15 分钟后再试", code="account_locked")

    ok = verify_password(body.password, user.password_hash if user else None)
    db.add(LoginAttempt(ip_hash=ip, email=email, success=ok and user is not None))
    if user is None or not ok or not user.is_active:
        if user is not None and not ok:
            user.failed_login_count += 1
            if user.failed_login_count >= settings.login_fail_lock_threshold:
                user.locked_until = now + timedelta(minutes=settings.login_lock_minutes)
                user.failed_login_count = 0
        db.commit()
        raise UnauthorizedError("邮箱或密码不正确", code="invalid_credentials")

    user.failed_login_count = 0
    user.locked_until = None
    out = _open_session(db, user, request)
    db.commit()
    return out


@router.get("/me", response_model=UserOut)
def me(auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)) -> UserOut:
    return user_out(db, auth.user)


@router.post("/logout", status_code=204)
def logout(auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)) -> Response:
    auth.session.revoked_at = utcnow()
    db.commit()
    return Response(status_code=204)


@router.post("/logout-all", status_code=204)
def logout_all(auth: AuthContext = Depends(get_auth), db: Session = Depends(get_db)) -> Response:
    db.execute(
        update(UserSession)
        .where(UserSession.user_id == auth.user.id, UserSession.revoked_at.is_(None))
        .values(revoked_at=utcnow())
    )
    db.commit()
    return Response(status_code=204)


class SmsSendIn(BaseModel):
    phone: str = Field(pattern=r"^\+?\d{6,15}$")


@router.post("/sms/send", status_code=202)
def sms_send(_: SmsSendIn) -> None:
    """手机号验证码登录（预留接口，计划 07 接入短信服务）。"""
    raise ServiceUnavailableError("短信登录暂未开通，请使用邮箱登录", code="sms_not_configured")
