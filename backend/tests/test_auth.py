"""账号与会话：注册、登录、登出、会话过期、限流与锁定。"""

from __future__ import annotations

from datetime import timedelta

import pytest
from freezegun import freeze_time
from sqlalchemy import select

from app.core.db import utcnow
from app.core.security.crypto import hash_password, token_hash, verify_password
from app.modules.auth.models import Session as UserSession
from app.modules.auth.models import User
from tests.factories import PASSWORD, make_company, make_session, make_user


def register(client, email: str = "boss@factory.com", password: str = "Factory123", **extra):  # noqa: S107
    return client.post("/api/v1/auth/register", json={"email": email, "password": password, **extra})


def login(client, email: str, password: str = PASSWORD, ip: str | None = None):
    return client.post("/api/v1/auth/login", json={"email": email, "password": password})


def test_register_returns_session_and_stores_only_hash(client, db) -> None:
    r = register(client, email="Boss@Factory.com", name="王总")
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["user"]["email"] == "boss@factory.com"
    assert body["user"]["companies"] == []
    token = body["token"]
    assert len(token) >= 40
    stored = db.scalar(select(UserSession).where(UserSession.token_hash == token_hash(token)))
    assert stored is not None
    assert token not in stored.token_hash
    user = db.scalar(select(User).where(User.email == "boss@factory.com"))
    assert user.password_hash.startswith("$argon2")
    assert client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"}).json()["name"] == "王总"


@pytest.mark.parametrize(
    "payload",
    [
        {"email": "not-an-email", "password": "Factory123"},
        {"email": "a@b.com", "password": "short1"},
        {"email": "a@b.com", "password": "12345678901"},
        {"email": "a@b.com", "password": "onlyletters"},
        {"email": "a@b.com", "password": "x" * 129 + "1"},
    ],
)
def test_register_validation(client, payload) -> None:
    r = client.post("/api/v1/auth/register", json=payload)
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "validation_error"


def test_register_duplicate_email(client) -> None:
    assert register(client).status_code == 201
    r = register(client, email="BOSS@factory.com")
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "email_taken"


def test_register_rate_limited_per_ip(client) -> None:
    for i in range(10):
        assert register(client, email=f"u{i}@x.com").status_code == 201
    r = register(client, email="u11@x.com")
    assert r.status_code == 429


def test_login_success_and_wrong_password(client, db) -> None:
    user = make_user(db, email="sales@factory.com")
    r = login(client, "SALES@factory.com")
    assert r.status_code == 200
    assert r.json()["user"]["id"] == str(user.id)

    r = login(client, "sales@factory.com", "WrongPass1")
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "invalid_credentials"
    # 账号不存在与密码错误返回相同的错误，避免枚举账号
    r2 = login(client, "nobody@factory.com", "WrongPass1")
    assert r2.status_code == 401
    assert r2.json() == r.json()


def test_login_lists_companies(client, db) -> None:
    user = make_user(db)
    company = make_company(db, user)
    body = login(client, user.email).json()
    assert body["user"]["companies"] == [
        {"id": str(company.id), "name_cn": company.name_cn, "name_en": "", "role": "owner"}
    ]


def test_inactive_user_cannot_login(client, db) -> None:
    user = make_user(db, is_active=False)
    assert login(client, user.email).status_code == 401


def test_account_locks_after_consecutive_failures(client, db) -> None:
    user = make_user(db)
    with freeze_time(utcnow()) as clock:
        for _ in range(5):
            assert login(client, user.email, "WrongPass1").status_code == 401
        r = login(client, user.email)  # 正确密码也被拒绝
        assert r.status_code == 429
        assert r.json()["error"]["code"] == "account_locked"

        clock.tick(timedelta(minutes=14))
        assert login(client, user.email).status_code == 429

        clock.tick(timedelta(minutes=2))
        assert login(client, user.email).status_code == 200
    db.refresh(user)
    assert user.failed_login_count == 0
    assert user.locked_until is None


def test_successful_login_resets_failure_count(client, db) -> None:
    user = make_user(db)
    for _ in range(4):
        login(client, user.email, "WrongPass1")
    assert login(client, user.email).status_code == 200
    for _ in range(4):
        login(client, user.email, "WrongPass1")
    assert login(client, user.email).status_code == 200


def test_login_rate_limited_per_ip(client, db) -> None:
    with freeze_time(utcnow()) as clock:
        for i in range(20):
            login(client, f"guess{i}@x.com", "WrongPass1")
        user = make_user(db)
        r = login(client, user.email)
        assert r.status_code == 429
        assert r.json()["error"]["code"] == "rate_limited"
        clock.tick(timedelta(minutes=16))
        assert login(client, user.email).status_code == 200


def test_logout_revokes_only_current_session(client, db) -> None:
    user = make_user(db)
    t1, t2 = make_session(db, user), make_session(db, user)
    h1, h2 = {"Authorization": f"Bearer {t1}"}, {"Authorization": f"Bearer {t2}"}
    assert client.post("/api/v1/auth/logout", headers=h1).status_code == 204
    assert client.get("/api/v1/auth/me", headers=h1).status_code == 401
    assert client.get("/api/v1/auth/me", headers=h2).status_code == 200


def test_logout_all_devices(client, db) -> None:
    user = make_user(db)
    tokens = [make_session(db, user) for _ in range(3)]
    other = make_session(db, make_user(db))
    assert client.post("/api/v1/auth/logout-all", headers={"Authorization": f"Bearer {tokens[0]}"}).status_code == 204
    for token in tokens:
        assert client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401
    assert client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {other}"}).status_code == 200


def test_session_expires_after_7_days(client, db) -> None:
    r = register(client)
    headers = {"Authorization": f"Bearer {r.json()['token']}"}
    with freeze_time(utcnow() + timedelta(days=6, hours=23)):
        assert client.get("/api/v1/auth/me", headers=headers).status_code == 200
    with freeze_time(utcnow() + timedelta(days=7, minutes=1)):
        assert client.get("/api/v1/auth/me", headers=headers).status_code == 401


@pytest.mark.parametrize("header", ["Token abc", "Bearer", "Bearer   ", "Basic dXNlcjpwYXNz"])
def test_malformed_authorization(client, header) -> None:
    assert client.get("/api/v1/auth/me", headers={"Authorization": header}).status_code == 401


def test_sms_login_reserved(client) -> None:
    r = client.post("/api/v1/auth/sms/send", json={"phone": "+8613812345678"})
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "sms_not_configured"


def test_password_hash_helpers() -> None:
    hashed = hash_password("Factory123")
    assert verify_password("Factory123", hashed)
    assert not verify_password("factory123", hashed)
    assert not verify_password("Factory123", None)
    assert not verify_password("Factory123", "not-a-hash")
