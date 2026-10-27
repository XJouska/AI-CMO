"""路由权限守卫：
1. 应用中的每个路由都必须在 tenancy_matrix.ROUTES 中登记（新增路由忘记登记 → 测试失败）
2. 按访问级别自动验证：未登录 401；非成员 403；跨企业访问资源 404；非 staff 403
"""

from __future__ import annotations

import re

import pytest
from sqlalchemy.orm import Session

from app.main import create_app
from tests.factories import make_tenant
from tests.tenancy_matrix import ROUTES, Route

PARAM_RE = re.compile(r"{(\w+)}")


def app_routes() -> set[tuple[str, str]]:
    """通过 OpenAPI 文档枚举全部接口（公开、稳定的方式；FastAPI 内部路由结构可能变化）。"""
    schema = create_app().openapi()
    found: set[tuple[str, str]] = set()
    for path, operations in schema["paths"].items():
        for method in operations:
            if method.upper() in {"GET", "POST", "PUT", "PATCH", "DELETE"}:
                found.add((method.upper(), path))
    return found


def test_every_route_is_registered() -> None:
    registered = {(r.method, r.path) for r in ROUTES}
    missing = app_routes() - registered
    stale = registered - app_routes()
    assert not missing, f"以下路由未在 tests/tenancy_matrix.py 登记访问级别：{sorted(missing)}"
    assert not stale, f"tenancy_matrix 中登记了不存在的路由：{sorted(stale)}"


def test_levels_are_valid() -> None:
    assert {r.level for r in ROUTES} <= {"public", "auth", "path_company", "company", "staff"}


def _fill(path: str, params: dict[str, str]) -> str:
    def repl(match: re.Match[str]) -> str:
        return params.get(match.group(1), "00000000-0000-0000-0000-000000000000")

    return PARAM_RE.sub(repl, path)


def _call(client, route: Route, path: str, headers: dict[str, str]):
    kwargs: dict[str, object] = {"headers": headers}
    if route.files is not None:
        kwargs["files"] = route.files
    elif route.body is not None:
        kwargs["json"] = route.body
    return client.request(route.method, path, **kwargs)


PROTECTED = [r for r in ROUTES if r.level != "public"]


@pytest.mark.parametrize("route", PROTECTED, ids=lambda r: f"{r.method} {r.path}")
def test_requires_login(client, db: Session, route: Route) -> None:
    victim = make_tenant(db)
    path = _fill(route.path, route.setup(db, victim))
    for headers in ({}, {"Authorization": "Bearer invalid-token"}, {"X-Company-Id": str(victim.company.id)}):
        response = _call(client, route, path, headers)
        assert response.status_code == 401, (route, headers, response.text)
        assert response.json()["error"]["code"] == "unauthorized"


COMPANY_ROUTES = [r for r in ROUTES if r.level == "company"]


@pytest.mark.parametrize("route", COMPANY_ROUTES, ids=lambda r: f"{r.method} {r.path}")
def test_company_routes_reject_non_members(client, db: Session, route: Route) -> None:
    victim = make_tenant(db)
    attacker = make_tenant(db)
    path = _fill(route.path, route.setup(db, victim))

    # 冒用受害企业的 X-Company-Id → 403
    response = _call(client, route, path, attacker.as_company(victim.company))
    assert response.status_code == 403, response.text

    # 缺少企业头 → 400
    response = _call(client, route, path, attacker.auth)
    assert response.status_code == 400, response.text
    assert response.json()["error"]["code"] == "company_required"


ID_ROUTES = [r for r in COMPANY_ROUTES if PARAM_RE.search(r.path)]


@pytest.mark.parametrize("route", ID_ROUTES, ids=lambda r: f"{r.method} {r.path}")
def test_company_resources_not_visible_across_tenants(client, db: Session, route: Route) -> None:
    victim = make_tenant(db)
    attacker = make_tenant(db)
    path = _fill(route.path, route.setup(db, victim))
    # 用自己企业的身份访问别家企业的资源 ID → 404（不暴露资源是否存在）
    response = _call(client, route, path, attacker.headers)
    assert response.status_code == 404, response.text


PATH_COMPANY_ROUTES = [r for r in ROUTES if r.level == "path_company"]


@pytest.mark.parametrize("route", PATH_COMPANY_ROUTES, ids=lambda r: f"{r.method} {r.path}")
def test_path_company_routes_reject_non_members(client, db: Session, route: Route) -> None:
    victim = make_tenant(db)
    attacker = make_tenant(db)
    path = _fill(route.path, route.setup(db, victim))
    response = _call(client, route, path, attacker.headers)
    assert response.status_code == 403, response.text


STAFF_ROUTES = [r for r in ROUTES if r.level == "staff"]


@pytest.mark.parametrize(
    "route", STAFF_ROUTES or [None], ids=lambda r: f"{r.method} {r.path}" if r else "none"
)
def test_staff_routes_reject_regular_users(client, db: Session, route: Route | None) -> None:
    if route is None:
        pytest.skip("尚无 staff 路由")
    user = make_tenant(db)
    path = _fill(route.path, route.setup(db, user))
    response = _call(client, route, path, user.headers)
    assert response.status_code == 403, response.text
