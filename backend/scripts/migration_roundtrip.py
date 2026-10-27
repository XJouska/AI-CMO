"""在独立的空数据库上执行 alembic upgrade head → downgrade base → upgrade head。

数据库地址：MIGRATION_TEST_DATABASE_URL，默认在测试实例上临时创建 aicmo_migration_check 库。
"""

from __future__ import annotations

import os
import subprocess
import sys

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ADMIN_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+psycopg://aicmo:aicmo_test_only@127.0.0.1:55432/aicmo_test"
)
DB_NAME = "aicmo_migration_check"


def main() -> int:
    admin = create_engine(ADMIN_URL, isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.execute(text(f'DROP DATABASE IF EXISTS "{DB_NAME}" WITH (FORCE)'))
        conn.execute(text(f'CREATE DATABASE "{DB_NAME}"'))
    target = make_url(ADMIN_URL).set(database=DB_NAME).render_as_string(hide_password=False)
    env = {
        **os.environ,
        "DATABASE_URL": target,
        "SECRET_KEY": os.environ.get("SECRET_KEY", "x" * 40),
    }
    try:
        for args in (["upgrade", "head"], ["downgrade", "base"], ["upgrade", "head"], ["check"]):
            print("alembic", *args, flush=True)
            subprocess.run([sys.executable, "-m", "alembic", *args], cwd=BACKEND, env=env, check=True)  # noqa: S603
    except subprocess.CalledProcessError as exc:
        print(f"迁移检查失败：{exc}", file=sys.stderr)
        return 1
    finally:
        with admin.connect() as conn:
            conn.execute(text(f'DROP DATABASE IF EXISTS "{DB_NAME}" WITH (FORCE)'))
        admin.dispose()
    print("迁移检查通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
