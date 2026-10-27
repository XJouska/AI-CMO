"""敏感凭据的对称加密（Fernet：AES-128-CBC + HMAC-SHA256）。

- 密钥来自环境变量 MAIL_ENCRYPTION_KEY（Fernet 格式，`Fernet.generate_key()` 生成）；生产环境必须单独配置
- 未配置时（开发 / 测试）从 SECRET_KEY 经 HKDF 派生，用途标签隔离，不与其他签名共用密钥
- 支持密钥轮换：MAIL_ENCRYPTION_KEY 可用逗号分隔多个密钥，第一个用于加密，全部用于解密
- 明文只在内存中短暂存在；接口与日志永不输出（SecretBox.__repr__ 已脱敏）
"""

from __future__ import annotations

import base64
import json
from typing import Any

from cryptography.fernet import Fernet, InvalidToken, MultiFernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.core.config import get_settings


class DecryptionError(Exception):
    pass


def _derived_key() -> bytes:
    secret = get_settings().secret_key.get_secret_value().encode()
    raw = HKDF(algorithm=hashes.SHA256(), length=32, salt=b"aicmo-credentials", info=b"mail-credentials-v1").derive(
        secret
    )
    return base64.urlsafe_b64encode(raw)


def _fernet() -> MultiFernet:
    configured = get_settings().mail_encryption_key
    keys = [k.strip() for k in configured.get_secret_value().split(",") if k.strip()] if configured else []
    return MultiFernet([Fernet(k) for k in keys] if keys else [Fernet(_derived_key())])


def encrypt_json(data: dict[str, Any]) -> bytes:
    return _fernet().encrypt(json.dumps(data, separators=(",", ":")).encode())


def decrypt_json(token: bytes) -> dict[str, Any]:
    try:
        return json.loads(_fernet().decrypt(token))
    except (InvalidToken, ValueError) as exc:
        raise DecryptionError("凭据无法解密（密钥已更换？）") from exc
