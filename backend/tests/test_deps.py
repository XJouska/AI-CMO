"""权限依赖的单元测试：require_staff、require_role（尚未被业务路由使用时也要保证行为正确）。"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.testclient import TestClient

from app.core.deps import CompanyScope, require_role, require_staff
from app.modules.auth.models import User
from tests.factories import add_member, make_session, make_tenant, make_user


def _client_with_probe_routes(app) -> TestClient:
    router = APIRouter()

    @router.get("/probe/staff")
    def staff_only(user: User = Depends(require_staff)) -> dict[str, str]:
        return {"user": str(user.id)}

    @router.get("/probe/owner")
    def owner_only(scope: CompanyScope = Depends(require_role("owner"))) -> dict[str, str]:
        return {"role": scope.role, "company": str(scope.company_id)}

    app.include_router(router)
    return TestClient(app, raise_server_exceptions=False)


def test_require_staff(app, db) -> None:
    client = _client_with_probe_routes(app)
    regular = make_session(db, make_user(db))
    staff = make_session(db, make_user(db, is_staff=True))
    assert client.get("/probe/staff", headers={"Authorization": f"Bearer {regular}"}).status_code == 403
    assert client.get("/probe/staff", headers={"Authorization": f"Bearer {staff}"}).status_code == 200
    assert client.get("/probe/staff").status_code == 401


def test_require_role(app, db) -> None:
    client = _client_with_probe_routes(app)
    owner = make_tenant(db)
    member = make_user(db)
    add_member(db, owner.company, member, "member")
    member_headers = {
        "Authorization": f"Bearer {make_session(db, member)}",
        "X-Company-Id": str(owner.company.id),
    }
    r = client.get("/probe/owner", headers=owner.headers)
    assert r.status_code == 200
    assert r.json() == {"role": "owner", "company": str(owner.company.id)}
    assert client.get("/probe/owner", headers=member_headers).status_code == 403
    bad = {**owner.auth, "X-Company-Id": "not-a-uuid"}
    assert client.get("/probe/owner", headers=bad).json()["error"]["code"] == "company_required"
