"""身份与权限依赖：current_user、current_company、require_role、require_staff。

- 未登录 / 会话失效：401
- 请求头 X-Company-Id 缺失或格式错误：400；不是该企业成员：403
- 业务资源不属于当前企业：由各模块返回 404（不暴露资源是否存在）
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from dataclasses import dataclass

from fastapi import Depends, Header, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db, utcnow
from app.core.errors import AppError, ForbiddenError, UnauthorizedError
from app.core.security.crypto import token_hash
from app.modules.auth.models import Session as UserSession
from app.modules.auth.models import User
from app.modules.companies.models import Company, CompanyMember


@dataclass
class AuthContext:
    user: User
    session: UserSession


@dataclass
class CompanyScope:
    company: Company
    user: User
    role: str

    @property
    def company_id(self) -> uuid.UUID:
        return self.company.id


def _bearer(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    scheme, _, value = header.partition(" ")
    if scheme.lower() != "bearer" or not value.strip():
        return None
    return value.strip()


def get_auth(request: Request, db: Session = Depends(get_db)) -> AuthContext:
    token = _bearer(request)
    if not token:
        raise UnauthorizedError("请先登录")
    row = db.execute(
        select(UserSession, User)
        .join(User, User.id == UserSession.user_id)
        .where(UserSession.token_hash == token_hash(token))
    ).first()
    if row is None:
        raise UnauthorizedError("登录已过期，请重新登录")
    session, user = row
    if session.revoked_at is not None or session.expires_at <= utcnow() or not user.is_active:
        raise UnauthorizedError("登录已过期，请重新登录")
    return AuthContext(user=user, session=session)


def current_user(auth: AuthContext = Depends(get_auth)) -> User:
    return auth.user


def require_staff(user: User = Depends(current_user)) -> User:
    if not user.is_staff:
        raise ForbiddenError("没有权限执行此操作")
    return user


def membership(db: Session, company_id: uuid.UUID, user_id: uuid.UUID) -> CompanyMember | None:
    return db.get(CompanyMember, {"company_id": company_id, "user_id": user_id})


def load_scope(db: Session, user: User, company_id: uuid.UUID) -> CompanyScope:
    member = membership(db, company_id, user.id)
    company = db.get(Company, company_id) if member else None
    if member is None or company is None or company.status != "active":
        raise ForbiddenError("你不是该企业的成员")
    return CompanyScope(company=company, user=user, role=member.role)


def current_company(
    x_company_id: str | None = Header(default=None, alias="X-Company-Id"),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> CompanyScope:
    if not x_company_id:
        raise AppError("请先选择企业", code="company_required")
    try:
        company_id = uuid.UUID(x_company_id)
    except ValueError as exc:
        raise AppError("企业标识格式不正确", code="company_required") from exc
    return load_scope(db, user, company_id)


def require_role(*roles: str) -> Callable[..., CompanyScope]:
    def dependency(scope: CompanyScope = Depends(current_company)) -> CompanyScope:
        if scope.role not in roles:
            raise ForbiddenError("没有权限执行此操作")
        return scope

    return dependency


# 能管理企业设置、成员、邀请的角色（operator 为我方代运营人员）
MANAGER_ROLES = ("owner", "operator")
