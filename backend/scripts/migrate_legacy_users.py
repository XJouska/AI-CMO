"""把旧版网站（ai-cmo-db-1）的账号迁移到新版，老用户可以用原来的密码登录。

- 旧版密码是无盐 SHA-256：迁移时包装成 `legacy-sha256$<hex>`，首次登录成功后自动升级为 argon2。
- 新版已存在同一邮箱的账号：默认跳过；`--replace-password` 时改为旧版密码（用于运营账号等先于迁移创建的账号）。
- 旧版管理员（is_admin）在新版设为运营人员（is_staff）。
- 只迁移账号本身，不迁移旧版的分析数据（新旧产品功能不同）。

用法（需要能同时连到新旧两个数据库）：
    LEGACY_DATABASE_URL=postgresql+psycopg://ai_cmo:***@host:5434/ai_cmo \\
        python scripts/migrate_legacy_users.py [--dry-run] [--only EMAIL] [--replace-password EMAIL]
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import create_engine, select, text

from app.core.db import get_sessionmaker
from app.core.security.crypto import legacy_password_hash
from app.modules.auth.models import User

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="只显示将要做的变更")
    parser.add_argument(
        "--replace-password", action="append", default=[], metavar="EMAIL", help="新版已存在该邮箱时，改用旧版密码"
    )
    parser.add_argument("--only", action="append", default=[], metavar="EMAIL", help="只处理指定邮箱（可重复）")
    args = parser.parse_args()
    replace = {e.lower() for e in args.replace_password}
    only = {e.lower() for e in args.only}

    url = os.environ.get("LEGACY_DATABASE_URL")
    if not url:
        print("缺少环境变量 LEGACY_DATABASE_URL", file=sys.stderr)
        return 2
    legacy = create_engine(url)
    with legacy.connect() as conn:
        rows = conn.execute(
            text(
                "select email, username, password_hash, coalesce(is_active, true), coalesce(is_admin, false)"
                " from users order by id"
            )
        ).all()

    created = updated = skipped = 0
    with get_sessionmaker()() as db:
        for email, username, pw_hash, is_active, is_admin in rows:
            email = (email or "").strip().lower()
            if only and email not in only:
                continue
            if not EMAIL_RE.match(email) or not re.fullmatch(r"[0-9a-f]{64}", pw_hash or ""):
                print(f"跳过（数据不完整）：{email or '<空邮箱>'}")
                skipped += 1
                continue
            existing = db.scalar(select(User).where(User.email == email))
            if existing is None:
                print(f"新建：{email}{'（运营）' if is_admin else ''}")
                db.add(
                    User(
                        email=email,
                        password_hash=legacy_password_hash(pw_hash),
                        name=(username or "")[:64],
                        is_active=bool(is_active),
                        is_staff=bool(is_admin),
                    )
                )
                created += 1
            elif email in replace:
                print(f"更新密码为旧版密码：{email}")
                existing.password_hash = legacy_password_hash(pw_hash)
                existing.failed_login_count = 0
                existing.locked_until = None
                existing.is_staff = existing.is_staff or bool(is_admin)
                updated += 1
            else:
                print(f"跳过（新版已存在）：{email}")
                skipped += 1
        if args.dry_run:
            db.rollback()
            print("（演练模式，未写入）")
        else:
            db.commit()
    print(f"完成：新建 {created}，更新 {updated}，跳过 {skipped}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
