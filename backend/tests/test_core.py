"""骨架测试：健康检查、元信息、统一错误格式、请求 ID、配置校验、日志脱敏、迁移可逆。"""

from __future__ import annotations

import json
import logging

import pytest
from fastapi import APIRouter
from pydantic import BaseModel, ValidationError
from sqlalchemy import inspect

from alembic import command
from app.core.config import APP_VERSION, Settings
from app.core.errors import AppError, ConflictError, NotFoundError
from app.core.logging import JsonFormatter, redact, request_id_var
from tests.conftest import alembic_config


def test_health_ok(client) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ok"}


def test_health_degraded_when_db_down(client, monkeypatch: pytest.MonkeyPatch) -> None:
    import app.main as main_module

    class _Broken:
        def connect(self):
            raise RuntimeError("db down")

    monkeypatch.setattr(main_module, "get_engine", lambda: _Broken())
    response = client.get("/health")
    assert response.status_code == 503
    assert response.json()["status"] == "degraded"


def test_meta(client) -> None:
    body = client.get("/api/v1/meta").json()
    assert body["version"] == APP_VERSION
    assert body["env"] == "test"
    assert body["features"] == {"llm": False}


def test_request_id_generated_and_echoed(client) -> None:
    generated = client.get("/api/v1/meta").headers["x-request-id"]
    assert len(generated) == 32
    echoed = client.get("/api/v1/meta", headers={"X-Request-Id": "trace-abc-12345"})
    assert echoed.headers["x-request-id"] == "trace-abc-12345"
    sanitized = client.get("/api/v1/meta", headers={"X-Request-Id": "bad id\nwith newline"})
    assert sanitized.headers["x-request-id"] != "bad id\nwith newline"


class Payload(BaseModel):
    name: str
    count: int


def _attach_error_routes(app) -> None:
    router = APIRouter()

    @router.get("/boom/app")
    def app_error() -> None:
        raise ConflictError("名称已存在", details={"field": "name"})

    @router.get("/boom/notfound")
    def not_found() -> None:
        raise NotFoundError("找不到该企业")

    @router.get("/boom/custom")
    def custom() -> None:
        raise AppError("自定义", code="custom_code", status_code=418)

    @router.get("/boom/crash")
    def crash() -> None:
        raise RuntimeError("secret internals")

    @router.post("/boom/validate")
    def validate(payload: Payload) -> dict[str, str]:
        return {"name": payload.name}

    app.include_router(router)


def test_unified_error_format(app, client) -> None:
    _attach_error_routes(app)

    r = client.get("/boom/app")
    assert r.status_code == 409
    assert r.json() == {"error": {"code": "conflict", "message": "名称已存在", "details": {"field": "name"}}}

    r = client.get("/boom/notfound")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "not_found"

    r = client.get("/boom/custom")
    assert r.status_code == 418
    assert r.json()["error"]["code"] == "custom_code"

    r = client.get("/boom/crash")
    assert r.status_code == 500
    assert r.json() == {"error": {"code": "internal_error", "message": "服务暂时不可用，请稍后重试"}}
    assert "secret" not in r.text

    r = client.post("/boom/validate", json={"name": "x"})
    assert r.status_code == 422
    body = r.json()["error"]
    assert body["code"] == "validation_error"
    assert body["details"]["fields"][0]["field"] == "count"

    r = client.get("/no-such-route")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "not_found"

    r = client.post("/api/v1/meta")
    assert r.status_code == 405
    assert r.json()["error"]["code"] == "method_not_allowed"


def test_settings_require_mandatory_values(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("SECRET_KEY", raising=False)
    with pytest.raises(ValidationError) as exc:
        Settings()  # type: ignore[call-arg]
    missing = {err["loc"][0] for err in exc.value.errors()}
    assert {"database_url", "secret_key"} <= missing


def test_settings_reject_weak_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SECRET_KEY", "short")
    with pytest.raises(ValidationError):
        Settings()  # type: ignore[call-arg]


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("postgresql://u:p@h/db", "postgresql+psycopg://u:p@h/db"),
        ("postgres://u:p@h/db", "postgresql+psycopg://u:p@h/db"),
        ("postgresql+psycopg://u:p@h/db", "postgresql+psycopg://u:p@h/db"),
    ],
)
def test_settings_normalize_database_url(monkeypatch: pytest.MonkeyPatch, raw: str, expected: str) -> None:
    monkeypatch.setenv("DATABASE_URL", raw)
    assert Settings().database_url == expected  # type: ignore[call-arg]


def test_settings_llm_flag(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LLM_API_KEY", "sk-test")
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("TEST_MODE", "0")
    settings = Settings()  # type: ignore[call-arg]
    assert settings.llm_enabled is True
    assert settings.is_production is True
    assert "sk-test" not in repr(settings)


def test_production_hides_docs(monkeypatch: pytest.MonkeyPatch) -> None:
    from fastapi.testclient import TestClient

    from app.core import config
    from app.main import create_app

    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("TEST_MODE", "0")
    config.get_settings.cache_clear()
    try:
        with TestClient(create_app()) as prod_client:
            assert prod_client.get("/docs").status_code == 404
            assert prod_client.get("/openapi.json").status_code == 404
    finally:
        monkeypatch.setenv("APP_ENV", "test")
        monkeypatch.setenv("TEST_MODE", "1")
        config.get_settings.cache_clear()


def test_cors_enabled_when_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    from fastapi.testclient import TestClient

    from app.core import config
    from app.main import create_app

    monkeypatch.setenv("CORS_ORIGINS", '["https://app.example.com"]')
    config.get_settings.cache_clear()
    try:
        with TestClient(create_app()) as cors_client:
            r = cors_client.options(
                "/api/v1/meta",
                headers={"Origin": "https://app.example.com", "Access-Control-Request-Method": "GET"},
            )
            assert r.headers["access-control-allow-origin"] == "https://app.example.com"
    finally:
        config.get_settings.cache_clear()


@pytest.mark.parametrize(
    ("raw", "must_not_contain"),
    [
        ("Authorization: Bearer abc.def.ghi", "abc.def.ghi"),
        ("login token=deadbeefcafe ok", "deadbeefcafe"),
        ('{"password": "hunter2"}', "hunter2"),
        ("api_key=sk-12345", "sk-12345"),
        ("user alice.smith@example.com signed in", "alice.smith"),
        ("phone 13812345678 verified", "13812345678"),
        ("intl +8613812345678", "8613812345678"),
    ],
)
def test_redaction(raw: str, must_not_contain: str) -> None:
    assert must_not_contain not in redact(raw)


def test_redaction_keeps_useful_context() -> None:
    assert redact("user alice@example.com") == "user a***@example.com"
    assert redact("order 2026") == "order 2026"


def test_json_formatter_includes_request_id_and_redacts() -> None:
    token = request_id_var.set("req-1234567890")
    try:
        record = logging.LogRecord("x", logging.INFO, __file__, 1, "mail bob@example.com", None, None)
        record.status = 200
        payload = json.loads(JsonFormatter().format(record))
    finally:
        request_id_var.reset(token)
    assert payload["request_id"] == "req-1234567890"
    assert payload["msg"] == "mail b***@example.com"
    assert payload["status"] == 200


def test_json_formatter_redacts_exceptions() -> None:
    try:
        raise ValueError("token=topsecret")
    except ValueError:
        import sys

        record = logging.LogRecord("x", logging.ERROR, __file__, 1, "fail", None, sys.exc_info())
    payload = json.loads(JsonFormatter().format(record))
    assert "topsecret" not in payload["exc"]


def test_migrations_roundtrip(engine) -> None:
    with engine.begin() as conn:
        command.downgrade(alembic_config(conn), "base")
        command.upgrade(alembic_config(conn), "head")
        assert "alembic_version" in inspect(conn).get_table_names()


def test_db_dependency_rolls_back_on_error(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.core import db as db_module

    events: list[str] = []

    class _FakeSession:
        def rollback(self) -> None:
            events.append("rollback")

        def close(self) -> None:
            events.append("close")

    monkeypatch.setattr(db_module, "get_sessionmaker", lambda: _FakeSession)
    gen = db_module.get_db()
    next(gen)
    with pytest.raises(RuntimeError):
        gen.throw(RuntimeError("boom"))
    assert events == ["rollback", "close"]


def test_test_mode_forbidden_in_production(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("TEST_MODE", "1")
    with pytest.raises(ValidationError, match="TEST_MODE"):
        Settings()  # type: ignore[call-arg]
