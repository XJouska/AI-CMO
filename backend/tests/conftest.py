"""测试公共夹具。

- 测试数据库：TEST_DATABASE_URL（默认 127.0.0.1:55432 的隔离容器 aicmo-v2-testdb）
- 会话开始时对测试库执行 alembic upgrade head
- 每个用例在一个外层事务中运行，结束后回滚；业务代码中的 commit 落在 SAVEPOINT 上
- 外部服务一律使用假实现：FakeLLM、FakeFetcher、MemoryStorage
"""

from __future__ import annotations

import os
from collections.abc import Iterator

os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault(
    "TEST_DATABASE_URL", "postgresql+psycopg://aicmo:aicmo_test_only@127.0.0.1:55432/aicmo_test"
)
os.environ["DATABASE_URL"] = os.environ["TEST_DATABASE_URL"]
os.environ.setdefault("SECRET_KEY", "test-secret-key-0123456789abcdef-0123456789")
os.environ.setdefault("LOG_LEVEL", "WARNING")
os.environ["TEST_MODE"] = "1"

import pytest
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import Connection, create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from alembic import command
from app.core.config import get_settings
from app.core.db import get_db
from app.core.providers import providers
from app.services.fakes import FakeLLM
from app.services.fetcher import FakeFetcher
from app.services.storage import MemoryStorage
from app.workers import handlers  # noqa: F401  注册任务处理函数

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def alembic_config(connection: Connection | None = None) -> Config:
    cfg = Config(os.path.join(BACKEND_DIR, "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(BACKEND_DIR, "alembic"))
    cfg.attributes["skip_logging"] = True
    cfg.attributes["database_url"] = os.environ["DATABASE_URL"]
    if connection is not None:
        cfg.attributes["connection"] = connection
    return cfg


@pytest.fixture(scope="session")
def engine() -> Iterator[Engine]:
    eng = create_engine(get_settings().database_url, pool_pre_ping=True)
    with eng.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    with eng.begin() as conn:
        command.upgrade(alembic_config(conn), "head")
    yield eng
    eng.dispose()


@pytest.fixture
def db(engine: Engine) -> Iterator[Session]:
    connection = engine.connect()
    outer = connection.begin()
    session = Session(bind=connection, join_transaction_mode="create_savepoint", expire_on_commit=False)
    try:
        yield session
    finally:
        session.close()
        if outer.is_active:
            outer.rollback()
        connection.close()


@pytest.fixture(autouse=True)
def fake_providers() -> Iterator[dict[str, object]]:
    fakes: dict[str, object] = {"llm": FakeLLM(), "fetcher": FakeFetcher(), "storage": MemoryStorage()}
    providers.reset()
    providers.set(**fakes)
    yield fakes
    providers.reset()


@pytest.fixture
def llm(fake_providers: dict[str, object]) -> FakeLLM:
    return fake_providers["llm"]  # type: ignore[return-value]


@pytest.fixture
def fetcher(fake_providers: dict[str, object]) -> FakeFetcher:
    return fake_providers["fetcher"]  # type: ignore[return-value]


@pytest.fixture
def storage(fake_providers: dict[str, object]) -> MemoryStorage:
    return fake_providers["storage"]  # type: ignore[return-value]


@pytest.fixture
def app(db: Session):
    from app.main import create_app

    application = create_app()

    def _override_db() -> Iterator[Session]:
        yield db

    application.dependency_overrides[get_db] = _override_db
    return application


@pytest.fixture
def client(app) -> Iterator[TestClient]:
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client
