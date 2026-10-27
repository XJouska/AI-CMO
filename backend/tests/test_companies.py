"""企业、成员、邀请。"""

from __future__ import annotations

from datetime import timedelta

from freezegun import freeze_time
from sqlalchemy import select

from app.core.db import utcnow
from app.modules.companies.models import CompanyMember, CompanyProfile, Invite
from tests.factories import add_member, make_session, make_tenant, make_user


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_create_company_makes_owner_and_profile(client, db) -> None:
    user = make_user(db)
    token = make_session(db, user)
    r = client.post(
        "/api/v1/companies",
        json={"name_cn": "  宁波阀门厂 ", "name_en": "Ningbo Valve"},
        headers=bearer(token),
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["name_cn"] == "宁波阀门厂"
    assert body["role"] == "owner"
    assert db.get(CompanyProfile, body["id"]) is not None
    listed = client.get("/api/v1/companies", headers=bearer(token)).json()
    assert [c["id"] for c in listed] == [body["id"]]


def test_create_company_validation(client, db) -> None:
    token = make_session(db, make_user(db))
    assert client.post("/api/v1/companies", json={"name_cn": "x"}, headers=bearer(token)).status_code == 422


def test_company_limit(client, db, monkeypatch) -> None:
    from app.modules.companies import router as company_router

    monkeypatch.setattr(company_router, "MAX_COMPANIES_PER_USER", 1)
    token = make_session(db, make_user(db))
    assert client.post("/api/v1/companies", json={"name_cn": "第一家"}, headers=bearer(token)).status_code == 201
    r = client.post("/api/v1/companies", json={"name_cn": "第二家"}, headers=bearer(token))
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "company_limit"


def test_get_and_patch_company_by_role(client, db) -> None:
    owner = make_tenant(db)
    member = make_user(db)
    add_member(db, owner.company, member, "member")
    member_headers = bearer(make_session(db, member))
    path = f"/api/v1/companies/{owner.company.id}"

    assert client.get(path, headers=member_headers).json()["role"] == "member"
    assert client.patch(path, json={"name_cn": "新名字"}, headers=member_headers).status_code == 403
    r = client.patch(path, json={"name_cn": "新名字", "name_en": "New Name"}, headers=owner.auth)
    assert r.status_code == 200
    assert r.json()["name_en"] == "New Name"
    profile = client.get("/api/v1/profile", headers=owner.headers).json()
    assert profile["field_sources"]["name_en"]["source"] == "manual"


def test_inactive_company_not_accessible(client, db) -> None:
    tenant = make_tenant(db)
    tenant.company.status = "suspended"
    db.flush()
    assert client.get("/api/v1/profile", headers=tenant.headers).status_code == 403
    assert client.get("/api/v1/companies", headers=tenant.auth).json() == []


def test_invalid_company_header(client, db) -> None:
    tenant = make_tenant(db)
    r = client.get("/api/v1/profile", headers={**tenant.auth, "X-Company-Id": "not-a-uuid"})
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "company_required"


def test_invite_flow(client, db) -> None:
    owner = make_tenant(db)
    r = client.post(f"/api/v1/companies/{owner.company.id}/invites", json={}, headers=owner.auth)
    assert r.status_code == 201
    token = r.json()["token"]
    assert db.scalar(select(Invite).where(Invite.company_id == owner.company.id)).token_hash != token

    joiner = make_user(db)
    joiner_headers = bearer(make_session(db, joiner))
    preview = client.get(f"/api/v1/invites/{token}", headers=joiner_headers)
    assert preview.json()["company_name"] == owner.company.name_cn

    accepted = client.post(f"/api/v1/invites/{token}/accept", headers=joiner_headers)
    assert accepted.status_code == 200
    assert accepted.json()["role"] == "member"

    # 一次性：再次使用失败
    other = bearer(make_session(db, make_user(db)))
    assert client.post(f"/api/v1/invites/{token}/accept", headers=other).status_code == 404

    members = client.get(f"/api/v1/companies/{owner.company.id}/members", headers=joiner_headers).json()
    assert {m["role"] for m in members} == {"owner", "member"}
    assert [m["is_me"] for m in members if m["user_id"] == str(joiner.id)] == [True]


def test_invite_expires(client, db) -> None:
    owner = make_tenant(db)
    token = client.post(f"/api/v1/companies/{owner.company.id}/invites", json={}, headers=owner.auth).json()["token"]
    joiner = bearer(make_session(db, make_user(db), days=30))
    with freeze_time(utcnow() + timedelta(hours=73)):
        r = client.post(f"/api/v1/invites/{token}/accept", headers=joiner)
        assert r.status_code == 404
        assert r.json()["error"]["code"] == "invite_invalid"


def test_invite_existing_member_conflict(client, db) -> None:
    owner = make_tenant(db)
    token = client.post(f"/api/v1/companies/{owner.company.id}/invites", json={}, headers=owner.auth).json()["token"]
    assert client.post(f"/api/v1/invites/{token}/accept", headers=owner.auth).status_code == 409


def test_member_cannot_invite(client, db) -> None:
    owner = make_tenant(db)
    member = make_user(db)
    add_member(db, owner.company, member)
    r = client.post(f"/api/v1/companies/{owner.company.id}/invites", json={}, headers=bearer(make_session(db, member)))
    assert r.status_code == 403


def test_operator_invites_restricted_to_staff(client, db) -> None:
    owner = make_tenant(db)
    r = client.post(f"/api/v1/companies/{owner.company.id}/invites", json={"role": "operator"}, headers=owner.auth)
    assert r.status_code == 403

    staff_owner = make_tenant(db, is_staff=True)
    token = client.post(
        f"/api/v1/companies/{staff_owner.company.id}/invites",
        json={"role": "operator"},
        headers=staff_owner.auth,
    ).json()["token"]
    regular = bearer(make_session(db, make_user(db)))
    assert client.post(f"/api/v1/invites/{token}/accept", headers=regular).status_code == 403
    staff = bearer(make_session(db, make_user(db, is_staff=True)))
    assert client.post(f"/api/v1/invites/{token}/accept", headers=staff).json()["role"] == "operator"


def test_remove_member(client, db) -> None:
    owner = make_tenant(db)
    member = make_user(db)
    add_member(db, owner.company, member)
    path = f"/api/v1/companies/{owner.company.id}/members"
    member_headers = bearer(make_session(db, member))
    assert client.delete(f"{path}/{owner.user.id}", headers=member_headers).status_code == 403
    assert client.delete(f"{path}/{owner.user.id}", headers=owner.auth).status_code == 400
    assert client.delete(f"{path}/{member.id}", headers=owner.auth).status_code == 204
    assert db.get(CompanyMember, {"company_id": owner.company.id, "user_id": member.id}) is None
    assert client.delete(f"{path}/{member.id}", headers=owner.auth).status_code == 404
    assert (
        client.get("/api/v1/profile", headers=member_headers | {"X-Company-Id": str(owner.company.id)}).status_code
        == 403
    )
