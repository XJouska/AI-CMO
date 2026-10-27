"""端到端测试种子数据：创建固定的运营（staff）账号，用于商机复核等需要 staff 权限的流程。

只在 e2e-backend.sh 中调用（TEST_MODE，独立的 aicmo_e2e 数据库）。
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select

from app.core.config import get_settings
from app.core.db import get_sessionmaker
from app.core.security.crypto import hash_password
from app.modules.auth.models import User

STAFF_EMAIL = "ops-e2e@example.com"
STAFF_PASSWORD = "Operator123"  # noqa: S105 — 仅 TEST_MODE 端到端测试库使用


def main() -> None:
    if not get_settings().test_mode:
        raise SystemExit("e2e_seed 只能在 TEST_MODE 下运行")
    with get_sessionmaker()() as db:
        if db.scalar(select(User).where(User.email == STAFF_EMAIL)) is None:
            db.add(User(email=STAFF_EMAIL, password_hash=hash_password(STAFF_PASSWORD), name="运营", is_staff=True))
            db.commit()


if __name__ == "__main__":
    main()
