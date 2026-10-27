"""密码哈希、会话 token、签名链接。"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import time

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from app.core.config import get_settings

_hasher = PasswordHasher()
# 用于账号不存在时的等时校验，防止通过响应时间枚举账号。
_DUMMY_HASH = _hasher.hash("dummy-password-for-timing")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def new_token() -> str:
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def ip_hash(ip: str) -> str:
    """IP 只存带密钥的哈希。"""
    key = get_settings().secret_key.get_secret_value().encode()
    return hmac.new(key, f"ip:{ip}".encode(), hashlib.sha256).hexdigest()


def sign(message: str) -> str:
    key = get_settings().secret_key.get_secret_value().encode()
    return hmac.new(key, message.encode(), hashlib.sha256).hexdigest()


def _now() -> float:
    return time.time()


def make_signed_query(purpose: str, subject: str, ttl_seconds: int, now: float | None = None) -> str:
    exp = int((now if now is not None else _now()) + ttl_seconds)
    return f"exp={exp}&sig={sign(f'{purpose}:{subject}:{exp}')}"


def verify_signed(purpose: str, subject: str, exp: int, sig: str, now: float | None = None) -> bool:
    if exp < int(now if now is not None else _now()):
        return False
    return hmac.compare_digest(sign(f"{purpose}:{subject}:{exp}"), sig)
