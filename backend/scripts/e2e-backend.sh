#!/usr/bin/env bash
# 端到端测试用后端：在测试数据库实例上重建 aicmo_e2e 库，迁移后以 TEST_MODE 启动 api 与 worker
# （外部服务全部使用假实现）。
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${E2E_API_PORT:-18000}"
ADMIN_URL="${TEST_DATABASE_URL:-postgresql+psycopg://aicmo:aicmo_test_only@127.0.0.1:55432/aicmo_test}"
export DATABASE_URL="${ADMIN_URL%/*}/aicmo_e2e"
export SECRET_KEY="${SECRET_KEY:-e2e-secret-key-0123456789abcdef-0123456789}"
export APP_ENV=test
export TEST_MODE=1
export LOG_LEVEL=WARNING
STORAGE_DIR="$(mktemp -d)"
export STORAGE_DIR
# 端到端测试会多次注册 / 登录，放宽限流（限流本身由后端单元测试覆盖）
export LOGIN_IP_LIMIT=1000
export REGISTER_IP_LIMIT_PER_HOUR=1000

.venv/bin/python - "$ADMIN_URL" <<'PY'
import sys
from sqlalchemy import create_engine, text
engine = create_engine(sys.argv[1], isolation_level="AUTOCOMMIT")
with engine.connect() as conn:
    conn.execute(text('DROP DATABASE IF EXISTS "aicmo_e2e" WITH (FORCE)'))
    conn.execute(text('CREATE DATABASE "aicmo_e2e"'))
PY

.venv/bin/alembic upgrade head >/dev/null
if [ -f scripts/e2e_seed.py ]; then .venv/bin/python scripts/e2e_seed.py; fi

.venv/bin/python -m app.workers &
WORKER_PID=$!
trap 'kill "$WORKER_PID" 2>/dev/null || true' EXIT INT TERM
.venv/bin/uvicorn app.asgi:app --host 127.0.0.1 --port "$PORT" --log-level warning
