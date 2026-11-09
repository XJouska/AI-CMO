"""官网：生成与事实校验、渲染安全、构建发布（原子切换）、版本回滚、域名、询盘、健康检查、助手工具。"""

from __future__ import annotations

import io
import json
import os
import re
import uuid
from pathlib import Path

import pytest
from PIL import Image
from sqlalchemy import select

from app.core.jobs import run_pending
from app.modules.sites import domains, render, service, styles
from app.modules.sites.content import SiteContent, fact_check, known_facts
from app.modules.sites.health import check_content, score
from app.modules.sites.models import Notification, Site, SiteInquiry
from app.services.llm import LLMError
from tests.factories import complete_profile, make_product, make_tenant


@pytest.fixture(autouse=True)
def sites_dir(tmp_path, monkeypatch):
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "sites_output_dir", str(tmp_path / "sites"))
    monkeypatch.setattr(get_settings(), "sites_base_domain", "sites.aicmo.test")
    return tmp_path / "sites"


def ready_tenant(db, **profile):
    tenant = make_tenant(db)
    complete_profile(db, tenant.company, **profile)
    make_product(
        db,
        tenant.company,
        name_en="Stainless Steel Ball Valve",
        keywords_en=["ball valve"],
        images=[],
        applications=["water treatment"],
        moq="100 pcs",
        specs={"Size": "DN15-DN100"},
    )
    return tenant


def generate(client, db, tenant, **body):
    r = client.post("/api/v1/site/generate", json=body, headers=tenant.headers)
    assert r.status_code == 202, r.text
    run_pending(db)
    return client.get("/api/v1/site", headers=tenant.headers).json()


def publish(client, db, tenant):
    r = client.post("/api/v1/site/publish", headers=tenant.headers)
    assert r.status_code == 202, r.text
    run_pending(db)
    return client.get("/api/v1/site", headers=tenant.headers).json()


# ── 生成 ───────────────────────────────────────────────────────────────


def test_generation_requires_profile_completeness(client, db) -> None:
    tenant = make_tenant(db)
    r = client.post("/api/v1/site/generate", json={}, headers=tenant.headers)
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "profile_incomplete"
    r = client.get("/api/v1/site", headers=tenant.headers)
    assert r.status_code == 200 and r.json() is None


def test_generate_creates_draft_from_profile(client, db, llm) -> None:
    tenant = ready_tenant(db)
    site = generate(client, db, tenant, template="building")
    assert site["task"]["status"] == "idle"
    assert [s["status"] for s in site["task"]["progress"]] == ["done", "done", "done"]
    assert site["template_key"] == "building"
    assert site["status"] == "draft"
    assert site["has_unpublished_changes"] is True
    assert site["subdomain_host"].endswith(".sites.aicmo.test")
    assert site["subdomain_host"].startswith("demo-valve-co-ltd-")

    draft = client.get("/api/v1/site/draft", headers=tenant.headers).json()
    content = draft["content"]
    # 档案直出的分区不经过 LLM
    assert content["certificates"]["items"] == ["ISO 9001", "CE"]
    assert content["contact"]["email"] == "sales@demo-valve.example"
    assert {s["label"] for s in content["factory"]["stats"]} == {"Established", "Employees", "Factory Area", "Capacity"}
    assert content["products"]["items"][0]["name"] == "Stainless Steel Ball Valve"
    # 档案数据以不可信数据形式传给 LLM
    prompt = llm.calls[0]["messages"]
    assert "<data>" in prompt[1]["content"] and "untrusted" in prompt[0]["content"]


def test_fabricated_facts_are_flagged(client, db, llm) -> None:
    tenant = ready_tenant(db)
    llm.script(
        "site.generate",
        {
            "hero": {
                "headline": "Trusted by 500 clients worldwide since 2008",
                "subheadline": "ISO 14001 and FDA certified",
            },
            "about": {"body": "We have 120 employees and an ISO 9001 system."},
            "cases": {"items": [{"title": "Supplier to Siemens", "body": "Valves for a 2 GW plant."}]},
            "seo": {"title": "Demo Valve", "description": "x"},
        },
    )
    generate(client, db, tenant)
    flags = client.get("/api/v1/site/draft", headers=tenant.headers).json()["flags"]
    texts = {(f["section"], f["text"]) for f in flags}
    assert ("hero", "500") in {(s, t.split()[0]) for s, t in texts}
    assert ("hero", "ISO 14001") in texts
    assert ("hero", "FDA") in texts
    assert ("cases", "Supplier to Siemens") in texts
    # 档案中存在的事实不标记
    assert not any(t.startswith("2008") or t.startswith("120") or t == "ISO 9001" for _, t in texts)
    site = client.get("/api/v1/site", headers=tenant.headers).json()
    assert site["unresolved_flags"] == len(flags)

    target = next(f for f in flags if f["text"] == "FDA")
    acked = client.post(
        "/api/v1/site/flags/ack", json={k: target[k] for k in ("section", "field", "text")}, headers=tenant.headers
    ).json()
    assert next(f for f in acked["flags"] if f["text"] == "FDA")["ack"] is True
    assert client.get("/api/v1/site", headers=tenant.headers).json()["unresolved_flags"] == len(flags) - 1
    assert (
        client.post(
            "/api/v1/site/flags/ack", json={"section": "x", "field": "y", "text": "z"}, headers=tenant.headers
        ).status_code
        == 404
    )


def test_fact_check_unit() -> None:
    profile = {
        "founded_year": 2008,
        "employees": "120",
        "certifications": ["ISO 9001"],
        "main_customers_public": ["ACME"],
        "factory_area": "15,000 m²",
    }
    facts = known_facts(profile, [{"moq": "100 pcs", "specs": {"Pressure": "PN16"}}])
    content = SiteContent.model_validate(
        {
            "hero": {"headline": "Since 2008, 15000 m² factory, MOQ 100", "subheadline": "Over 30 years of experience"},
            "about": {"body": "<p>ISO 9001 and CE certified. 1 stop shop.</p>"},
            "cases": {"items": [{"title": "Valves for ACME", "body": "x"}, {"title": "Big Corp", "body": "y"}]},
        }
    )
    flags = fact_check(content, facts)
    assert {f["text"] for f in flags} == {"30 years", "CE", "Big Corp"}


def test_generation_llm_failure_retries_then_fails(client, db, llm) -> None:
    from app.core.jobs import Job

    tenant = ready_tenant(db)
    llm.script("site.generate", LLMError("x"), "not json", LLMError("x"))
    client.post("/api/v1/site/generate", json={}, headers=tenant.headers)
    for _ in range(3):
        db.execute(Job.__table__.update().values(run_after=Job.created_at))
        run_pending(db)
    site = client.get("/api/v1/site", headers=tenant.headers).json()
    assert site["task"]["status"] == "failed"
    assert site["task"]["error"] == "处理失败，请稍后重试"
    # 失败后可以重新生成
    assert client.post("/api/v1/site/generate", json={}, headers=tenant.headers).status_code == 202


def test_concurrent_tasks_rejected(client, db) -> None:
    tenant = ready_tenant(db)
    client.post("/api/v1/site/generate", json={}, headers=tenant.headers)
    r = client.post("/api/v1/site/generate", json={}, headers=tenant.headers)
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "site_busy"


def test_llm_output_is_validated_and_clamped() -> None:
    base = service.facts_sections(
        {"name_en": "X", "contacts": {}}, [{"id": "p1", "name_en": "V", "keywords_en": [], "images": []}]
    )
    clamped = service.clamp_content({"hero": {"headline": "H" * 500}, "seo": {"title": "T" * 200}})
    assert len(clamped.hero.headline) == 120 and len(clamped.seo.title) == 70
    assembled = service.assemble(
        {
            "products": {"items": [{"product_id": "p1", "summary": "S" * 900}, {"product_id": "evil", "summary": "x"}]},
            "certificates": {"items": ["FAKE CERT"]},
            "contact": {"email": "attacker@evil.example"},
        },
        base,
    )
    assert [p.product_id for p in assembled.products.items] == ["p1"]  # LLM 不能新增产品
    assert len(assembled.products.items[0].summary) == 600
    assert assembled.certificates.items == []  # 证书只来自档案
    assert assembled.contact.email == ""  # 联系方式只来自档案


# ── 编辑、改写、版本 ───────────────────────────────────────────────────


def test_section_edit_creates_new_version_and_restore(client, db) -> None:
    tenant = ready_tenant(db)
    generate(client, db, tenant)
    first = client.get("/api/v1/site/draft", headers=tenant.headers).json()
    r = client.put(
        "/api/v1/site/sections/hero",
        json={"data": {"headline": "New Headline", "cta": "Get a Quote"}},
        headers=tenant.headers,
    )
    assert r.status_code == 200
    assert r.json()["content"]["hero"]["headline"] == "New Headline"
    versions = client.get("/api/v1/site/versions", headers=tenant.headers).json()
    assert [v["note"] for v in versions] == ["编辑：hero", "AI 生成"]
    assert versions[0]["is_draft"] is True

    restored = client.post(f"/api/v1/site/versions/{first['id']}/restore", headers=tenant.headers).json()
    assert restored["content"]["hero"]["headline"] == first["content"]["hero"]["headline"]
    assert len(client.get("/api/v1/site/versions", headers=tenant.headers).json()) == 3  # 历史不丢失

    assert client.put("/api/v1/site/sections/unknown", json={"data": {}}, headers=tenant.headers).status_code == 404
    bad = client.put("/api/v1/site/sections/hero", json={"data": {"headline": "x" * 500}}, headers=tenant.headers)
    assert bad.status_code == 422


def test_restore_rejects_other_company_versions(client, db) -> None:
    a, b = ready_tenant(db), ready_tenant(db)
    generate(client, db, a)
    generate(client, db, b)
    a_version = client.get("/api/v1/site/draft", headers=a.headers).json()["id"]
    assert client.post(f"/api/v1/site/versions/{a_version}/restore", headers=b.headers).status_code == 404


def test_ai_rewrite_section(client, db, llm) -> None:
    tenant = ready_tenant(db)
    generate(client, db, tenant)
    before = client.get("/api/v1/site/draft", headers=tenant.headers).json()["content"]["hero"]["headline"]
    r = client.post(
        "/api/v1/site/sections/hero/rewrite", json={"instruction": "更突出工厂直供"}, headers=tenant.headers
    )
    assert r.status_code == 202
    run_pending(db)
    after = client.get("/api/v1/site/draft", headers=tenant.headers).json()
    assert after["content"]["hero"]["headline"] == before + " — Factory Direct"
    assert after["note"] == "AI 改写：hero"
    assert "更突出工厂直供" in llm.calls[-1]["messages"][1]["content"]
    bad = client.post("/api/v1/site/sections/contact/rewrite", json={"instruction": "改一下"}, headers=tenant.headers)
    assert bad.json()["error"]["code"] == "invalid_section"


def test_rewrite_products_keeps_product_list(client, db, llm) -> None:
    tenant = ready_tenant(db)
    generate(client, db, tenant)
    draft = client.get("/api/v1/site/draft", headers=tenant.headers).json()["content"]
    pid = draft["products"]["items"][0]["product_id"]
    llm.script(
        "site.rewrite",
        {
            "title": "X",
            "items": [
                {"product_id": pid, "name": "Hacked", "summary": "Better summary"},
                {"product_id": "new", "name": "Injected", "summary": "x"},
            ],
        },
    )
    client.post("/api/v1/site/sections/products/rewrite", json={"instruction": "写得更专业"}, headers=tenant.headers)
    run_pending(db)
    items = client.get("/api/v1/site/draft", headers=tenant.headers).json()["content"]["products"]["items"]
    assert [(i["product_id"], i["name"], i["summary"]) for i in items] == [
        (pid, "Stainless Steel Ball Valve", "Better summary")
    ]


# ── 渲染安全 ───────────────────────────────────────────────────────────

XSS = "<script>alert(1)</script><img src=x onerror=alert(1)>"


def parse_tags(html: str) -> list[tuple[str, list[tuple[str, str | None]]]]:
    """用标准 HTML 解析器列出页面中真实存在的标签（转义后的文本不会被解析为标签）。"""
    from html.parser import HTMLParser

    found: list[tuple[str, list[tuple[str, str | None]]]] = []

    class Collector(HTMLParser):
        def handle_starttag(self, tag, attrs):
            found.append((tag, attrs))

    Collector().feed(html)
    return found


def test_render_escapes_everything_and_sanitizes_rich_text() -> None:
    content = SiteContent.model_validate(
        {
            "company_name": XSS,
            "hero": {"headline": XSS, "subheadline": '"><svg onload=alert(1)>'},
            "about": {
                "body": "<p>Hello <strong>B2B</strong></p><script>alert(1)</script>"
                '<a href="javascript:alert(1)">x</a><a href="https://ok.example">ok</a>'
                '<iframe src="https://evil"></iframe><p onclick="x()">c</p>'
            },
            "faq": {"items": [{"q": XSS, "a": "<img src=x onerror=alert(1)>Answer"}]},
            "products": {"items": [{"name": XSS, "summary": XSS}]},
            "seo": {"title": "</title><script>x</script>", "description": "</script><script>alert(1)</script>"},
            "contact": {"email": 'a@b.com"><script>', "address": XSS},
        }
    )
    ctx = render.RenderContext(
        content=content,
        template="industrial",
        base_url="https://demo.sites.aicmo.test/",
        site_id="s",
        inquiry_action="/__inquiry/s",
        images={},
        products={},
    )
    pages = render.render_pages(ctx)
    for path, html in pages.items():
        assert "<script>alert" not in html, path
        tags = parse_tags(html)
        assert not [t for t in tags if any(name.startswith("on") for name, _ in t[1])], path  # 没有事件属性
        scripts = [t for t in tags if t[0] == "script"]
        assert all(dict(t[1]).get("type") == "application/ld+json" for t in scripts), path
        assert not [t for t in tags if t[0] in {"svg", "iframe", "object", "embed"}], path
        for _, attrs in tags:
            for name, value in attrs:
                if name in {"href", "src", "action"}:
                    assert not (value or "").lower().startswith(("javascript:", "data:")), (path, value)
        assert "<svg" not in html, path
        assert "<iframe" not in html, path
        assert "javascript:" not in html, path
        assert 'onclick="x()"' not in html, path
        # JSON-LD 中无法闭合 script 标签
        ld = re.findall(r'<script type="application/ld\+json">(.*?)</script>', html, re.S)
        assert ld and all("<" not in block for block in ld), path
        json.loads(ld[0])
    index = pages["index.html"]
    assert "<strong>B2B</strong>" in index  # 白名单标签保留
    assert 'href="https://ok.example"' in index and 'rel="nofollow noopener noreferrer"' in index
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in index


def test_render_templates_and_products() -> None:
    content = SiteContent.model_validate(
        {
            "company_name": "Demo",
            "hero": {"headline": "Valves"},
            "products": {
                "items": [
                    {"product_id": "p1", "name": "Ball Valve", "summary": "s"},
                    {"product_id": "p2", "name": "Ball Valve", "summary": "dup name"},
                ]
            },
            "certificates": {"items": ["ISO 9001"]},
        }
    )
    # 旧模板 key 映射到新版式；每种版式都能渲染，且只有一个 h1
    cases = [(t, None) for t in ("industrial", "building", "consumer")] + [
        ("industrial", {"layout": layout})
        for layout in ("heavy", "precision", "building", "consumer", "heritage", "tech")
    ]
    for template, style in cases:
        ctx = render.RenderContext(
            content=content,
            template=template,
            base_url="https://d.example/",
            site_id="s",
            inquiry_action="/__inquiry/s",
            images={},
            products={"p1": {"specs": {"Size": "DN50"}, "moq": "10", "lead_time": "", "applications": []}},
            style=style or {},
        )
        pages = render.render_pages(ctx)
        assert set(pages) == {"index.html", "products/ball-valve.html", "products/ball-valve-2.html", "thank-you.html"}
        layout = (style or {}).get("layout") or styles.LEGACY_TEMPLATE[template]
        assert f'class="ly-{layout} ' in pages["index.html"]
        assert pages["index.html"].count("<h1") == 1
        assert "DN50" in pages["products/ball-valve.html"]
        assert 'href="../assets/site.css"' in pages["products/ball-valve.html"]
        assert 'href="../assets/theme.css"' in pages["products/ball-valve.html"]
        assert 'action="/__inquiry/s"' in pages["index.html"]
        assert 'name="website"' in pages["index.html"]  # 蜜罐字段


def test_safe_host_and_slug() -> None:
    assert render.safe_host("Demo.Sites.Example.") == "demo.sites.example"
    for bad in ("../etc", "a/b", "", "a..b", "-a.com", "x" * 300):
        with pytest.raises(ValueError):
            render.safe_host(bad)
    assert render.slugify("Ball Valve (DN50)!", "p") == "ball-valve-dn50"
    assert render.slugify("球阀", "product-1") == "product-1"


# ── 发布 ───────────────────────────────────────────────────────────────


def png(width=1200, height=800) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (width, height), (200, 100, 50)).save(buf, format="PNG")
    return buf.getvalue()


def test_publish_writes_static_site_and_switches_atomically(client, db, sites_dir, storage) -> None:
    tenant = ready_tenant(db)
    asset_id = client.post(
        "/api/v1/assets", files={"file": ("p.png", png(), "image/png")}, data={"kind": "image"}, headers=tenant.headers
    ).json()["id"]
    product = client.get("/api/v1/products", headers=tenant.headers).json()[0]
    client.patch(f"/api/v1/products/{product['id']}", json={"images": [asset_id]}, headers=tenant.headers)
    generate(client, db, tenant)
    site = publish(client, db, tenant)
    assert site["status"] == "published"
    assert site["has_unpublished_changes"] is False
    assert site["health_score"] is not None
    assert [s["status"] for s in site["task"]["progress"]] == ["done", "done", "done"]

    live = sites_dir / "live" / site["subdomain_host"]
    assert live.is_symlink()
    first_target = os.readlink(live)
    files = {str(p.relative_to(live)) for p in Path(live).rglob("*") if p.is_file()}
    assert {"index.html", "thank-you.html", "sitemap.xml", "robots.txt", "assets/site.css", "assets/theme.css"} <= files
    webps = sorted(f for f in files if f.endswith(".webp"))
    assert [w.rsplit("-", 1)[1] for w in webps] == ["1200.webp", "480.webp", "960.webp"]  # 不放大原图
    index = (live / "index.html").read_text()
    assert 'srcset="./assets/img/' in index
    product_page = next(p for p in files if p.startswith("products/"))
    assert 'src="../assets/img/' in (live / product_page).read_text()
    assert f"https://{site['subdomain_host']}/" in (live / "sitemap.xml").read_text()
    assert "Sitemap:" in (live / "robots.txt").read_text()

    # 修改后再次发布：软链接原子切换到新版本目录，旧版本目录仍在（可回滚）
    client.put("/api/v1/site/sections/hero", json={"data": {"headline": "Second Version"}}, headers=tenant.headers)
    assert client.get("/api/v1/site", headers=tenant.headers).json()["has_unpublished_changes"] is True
    publish(client, db, tenant)
    assert os.readlink(live) != first_target
    assert Path(first_target).exists()
    assert "Second Version" in (live / "index.html").read_text()
    assert not [p for p in (sites_dir / "live").iterdir() if p.name.startswith(".")]  # 没有残留的临时链接


def test_publish_requires_manager_and_draft(client, db) -> None:
    from tests.factories import add_member, make_session, make_user

    tenant = ready_tenant(db)
    assert client.post("/api/v1/site/publish", headers=tenant.headers).status_code == 404
    generate(client, db, tenant)
    member = make_user(db)
    add_member(db, tenant.company, member, "member")
    headers = {"Authorization": f"Bearer {make_session(db, member)}", "X-Company-Id": str(tenant.company.id)}
    assert client.post("/api/v1/site/publish", headers=headers).status_code == 403


def test_unpublish_removes_live_link(client, db, sites_dir) -> None:
    tenant = ready_tenant(db)
    generate(client, db, tenant)
    site = publish(client, db, tenant)
    r = client.post("/api/v1/site/unpublish", headers=tenant.headers)
    assert r.json()["status"] == "draft"
    assert not (sites_dir / "live" / site["subdomain_host"]).exists()


def test_write_version_rejects_path_escape(sites_dir) -> None:
    with pytest.raises(ValueError):
        render.write_version(uuid.uuid4(), uuid.uuid4(), {"../../evil.html": "x"}, {}, "https://a.example/")
    with pytest.raises(ValueError):
        render.write_version(uuid.uuid4(), uuid.uuid4(), {"index.html": "x"}, {"../x.webp": b""}, "https://a.example/")


# ── 预览 ───────────────────────────────────────────────────────────────


def test_preview_is_signed_sandboxed_and_scoped(client, db) -> None:
    tenant = ready_tenant(db)
    generate(client, db, tenant)
    url = client.get("/api/v1/site/preview-url", headers=tenant.headers).json()["url"]
    r = client.get(url)
    assert r.status_code == 200
    assert "sandbox" in r.headers["content-security-policy"]
    assert "script-src" not in r.headers["content-security-policy"]
    assert r.headers["x-robots-tag"] == "noindex"
    assert "<style>" in r.text  # 预览内联样式
    assert "?exp=" in r.text  # 站内链接携带签名
    other = ready_tenant(db)
    generate(client, db, other)
    other_draft = client.get("/api/v1/site/draft", headers=other.headers).json()["id"]
    tampered = re.sub(r"/[0-9a-f-]{36}/index.html", f"/{other_draft}/index.html", url)
    assert client.get(tampered).status_code == 404
    assert client.get(url.replace("index.html", "missing.html")).status_code == 404


# ── 询盘 ───────────────────────────────────────────────────────────────


FORM = {
    "name": "John",
    "email": "john@buyer.example",
    "company_name": "Buyer GmbH",
    "country": "Germany",
    "product_ref": "Ball Valve",
    "message": "Please quote 500 pcs DN50 ball valves.",
}


def published_site(client, db):
    tenant = ready_tenant(db)
    generate(client, db, tenant)
    site = publish(client, db, tenant)
    return tenant, site


def post_inquiry(client, site_id, data, ip="203.0.113.10"):
    return client.post(
        f"/api/v1/public/sites/{site_id}/inquiries", data=data, follow_redirects=False, headers={"X-Forwarded-For": ip}
    )


def test_inquiry_flow_creates_record_and_notification(client, db) -> None:
    tenant, site = published_site(client, db)
    r = post_inquiry(client, site["id"], FORM)
    assert r.status_code == 303
    assert r.headers["location"] == "/thank-you.html"
    inquiry = db.scalar(select(SiteInquiry).where(SiteInquiry.site_id == uuid.UUID(site["id"])))
    assert inquiry.status == "new"
    assert len(inquiry.ip_hash) == 64 and "203.0.113" not in inquiry.ip_hash
    note = db.scalar(select(Notification).where(Notification.company_id == tenant.company.id))
    assert note.title == "网站收到询价：Buyer GmbH"
    notifications = client.get("/api/v1/notifications", headers=tenant.headers).json()
    assert notifications[0]["read"] is False
    client.post(f"/api/v1/notifications/{notifications[0]['id']}/read", headers=tenant.headers)
    assert client.get("/api/v1/notifications", headers=tenant.headers).json()[0]["read"] is True

    listed = client.get("/api/v1/site/inquiries", headers=tenant.headers).json()
    assert listed[0]["company_name"] == "Buyer GmbH"
    assert client.get("/api/v1/site", headers=tenant.headers).json()["new_inquiry_count"] == 1
    detail = client.get(f"/api/v1/site/inquiries/{listed[0]['id']}", headers=tenant.headers).json()
    assert detail["status"] == "read"


def test_inquiry_xss_is_stored_as_text(client, db) -> None:
    tenant, site = published_site(client, db)
    post_inquiry(client, site["id"], {**FORM, "message": "<script>alert(1)</script> please quote", "name": "<b>x</b>"})
    item = client.get("/api/v1/site/inquiries", headers=tenant.headers).json()[0]
    assert item["message"] == "<script>alert(1)</script> please quote"  # 原样保存，前端按文本显示


@pytest.mark.parametrize(
    ("data", "location"),
    [
        ({**FORM, "email": "not-an-email"}, "/?inquiry=invalid#contact"),
        ({**FORM, "message": "short"}, "/?inquiry=invalid#contact"),
        ({**FORM, "name": "x" * 101}, "/?inquiry=invalid#contact"),
        ({k: v for k, v in FORM.items() if k != "email"}, "/?inquiry=invalid#contact"),
    ],
)
def test_inquiry_validation(client, db, data, location) -> None:
    _, site = published_site(client, db)
    r = post_inquiry(client, site["id"], data)
    assert r.status_code == 303
    assert r.headers["location"] == location
    assert db.scalars(select(SiteInquiry)).all() == []


def test_inquiry_honeypot_pretends_success(client, db) -> None:
    _, site = published_site(client, db)
    r = post_inquiry(client, site["id"], {**FORM, "website": "http://spam.example"})
    assert r.headers["location"] == "/thank-you.html"
    assert db.scalars(select(SiteInquiry)).all() == []


def test_inquiry_rate_limit(client, db) -> None:
    _, site = published_site(client, db)
    for _ in range(5):
        assert post_inquiry(client, site["id"], FORM).headers["location"] == "/thank-you.html"
    assert post_inquiry(client, site["id"], FORM).headers["location"] == "/?inquiry=limited#contact"


def test_inquiry_captcha_and_spam_score(client, db) -> None:
    tenant, site = published_site(client, db)
    r = post_inquiry(client, site["id"], {**FORM, "cf-turnstile-response": "fail"})
    assert r.headers["location"] == "/?inquiry=captcha#contact"
    spam = {**FORM, "message": "Cheap SEO service backlinks http://a.example http://b.example http://c.example"}
    post_inquiry(client, site["id"], spam)
    item = db.scalar(select(SiteInquiry))
    assert item.status == "spam" and item.spam_score >= 60
    assert client.get("/api/v1/site/inquiries", headers=tenant.headers).json() == []
    assert len(client.get("/api/v1/site/inquiries?include_spam=true", headers=tenant.headers).json()) == 1
    assert db.scalars(select(Notification)).all() == []  # 垃圾询盘不通知


def test_inquiry_json_body_and_unpublished_site(client, db) -> None:
    tenant, site = published_site(client, db)
    r = client.post(f"/api/v1/public/sites/{site['id']}/inquiries", json=FORM, follow_redirects=False)
    assert r.headers["location"] == "/thank-you.html"
    client.post("/api/v1/site/unpublish", headers=tenant.headers)
    assert post_inquiry(client, site["id"], FORM).status_code == 404
    assert post_inquiry(client, uuid.uuid4(), FORM).status_code == 404


def test_inquiry_oversized_body(client, db) -> None:
    _, site = published_site(client, db)
    r = post_inquiry(client, site["id"], {**FORM, "message": "x" * 25_000})
    assert r.headers["location"] == "/?inquiry=invalid#contact"


def test_inquiry_status_update_scoped(client, db) -> None:
    tenant, site = published_site(client, db)
    post_inquiry(client, site["id"], FORM)
    item = client.get("/api/v1/site/inquiries", headers=tenant.headers).json()[0]
    assert (
        client.patch(f"/api/v1/site/inquiries/{item['id']}", json={"status": "spam"}, headers=tenant.headers).json()[
            "status"
        ]
        == "spam"
    )
    other = make_tenant(db)
    assert client.get(f"/api/v1/site/inquiries/{item['id']}", headers=other.headers).status_code == 404


async def test_turnstile_verifier_uses_safe_fetch(monkeypatch) -> None:
    import httpx

    from app.core.security import ssrf
    from app.modules.sites import inquiries

    calls = []

    async def fake_fetch(url, **kwargs):
        calls.append((url, kwargs))
        return ssrf.FetchResult(url=url, status_code=200, headers=httpx.Headers(), content=b'{"success": true}')

    monkeypatch.setattr(inquiries, "safe_fetch", fake_fetch)
    verifier = inquiries.TurnstileVerifier("secret")
    assert await verifier.verify("tok", "1.2.3.4") is True
    assert await verifier.verify("", "1.2.3.4") is False
    assert calls[0][0] == inquiries.TurnstileVerifier.URL
    assert calls[0][1]["method"] == "POST"
    assert await inquiries.NoopVerifier().verify("", "") is True


# ── 域名 ───────────────────────────────────────────────────────────────


def test_custom_domain_flow(client, db, sites_dir) -> None:
    tenant, _ = published_site(client, db)
    r = client.put("/api/v1/site/domain", json={"domain": "https://WWW.Demo-Valve.example/"}, headers=tenant.headers)
    body = r.json()
    assert body["custom_domain"] == "www.demo-valve.example"
    assert body["domain_verified"] is False and len(body["domain_token"]) == 32
    verified = client.post("/api/v1/site/domain/verify", headers=tenant.headers).json()
    assert verified["domain_verified"] is True
    assert verified["url"] == "https://www.demo-valve.example/"
    publish(client, db, tenant)
    assert (sites_dir / "live" / "www.demo-valve.example").is_symlink()
    removed = client.delete("/api/v1/site/domain", headers=tenant.headers).json()
    assert removed["custom_domain"] is None
    assert not (sites_dir / "live" / "www.demo-valve.example").exists()


@pytest.mark.parametrize(
    "domain",
    [
        "localhost",
        "a",
        "-bad.com",
        "evil.internal",
        "printer.local",
        "x.sites.aicmo.test",
        "sites.aicmo.test",
        "a b.com",
        "1.2.3.4",
    ],
)
def test_invalid_domains(client, db, domain) -> None:
    tenant, _ = published_site(client, db)
    r = client.put("/api/v1/site/domain", json={"domain": domain}, headers=tenant.headers)
    assert r.status_code in (400, 422), domain


def test_domain_uniqueness_and_unverified(client, db) -> None:
    a, _ = published_site(client, db)
    b, _ = published_site(client, db)
    client.put("/api/v1/site/domain", json={"domain": "shop.real-company.com"}, headers=a.headers)
    assert (
        client.put("/api/v1/site/domain", json={"domain": "shop.real-company.com"}, headers=b.headers).json()["error"][
            "code"
        ]
        == "domain_taken"
    )
    r = client.post("/api/v1/site/domain/verify", headers=a.headers)  # .com 不在假解析器的自动通过范围
    assert r.json()["error"]["code"] == "domain_unverified"
    assert client.post("/api/v1/site/domain/verify", headers=b.headers).json()["error"]["code"] == "domain_missing"


async def test_dns_verification_unit() -> None:
    fake = domains.FakeDnsResolver({"_aicmo-verify.a.com": ["tok"]}, accept_example=False)
    assert await domains.verify("a.com", "tok", fake) is True
    assert await domains.verify("a.com", "other", fake) is False
    assert await domains.verify("b.example", "tok", fake) is False
    assert domains.normalize_domain("Bücher.com") == "xn--bcher-kva.com"


# ── 健康检查 ───────────────────────────────────────────────────────────


def test_health_rules() -> None:
    empty = SiteContent()
    issues = check_content(empty, https=False, pages={"index.html": "<h1>a</h1><h1>b</h1><img src=x>"})
    keys = {i.key for i in issues}
    assert {
        "seo_title_length",
        "seo_description_length",
        "h1",
        "img_alt",
        "https",
        "contact",
        "certificates",
        "factory_images",
        "products",
        "about",
    } <= keys
    assert score(issues) < 30
    good = SiteContent.model_validate(
        {
            "company_name": "Demo Valve Co., Ltd.",
            "seo": {
                "title": "Demo Valve | Ball Valve Manufacturer",
                "description": "D" * 80,
                "keywords": ["ball valve"],
            },
            "contact": {"email": "a@b.com"},
            "certificates": {"items": ["ISO 9001"]},
            "factory": {"image_asset_ids": ["x"]},
            "products": {"items": [{"name": "V", "image_asset_id": "y"}]},
            "about": {"body": "About"},
        }
    )
    assert score(check_content(good, https=True, pages={"index.html": '<h1>x</h1><img alt="a" src=x>'})) == 100


def test_health_check_endpoint(client, db) -> None:
    tenant = ready_tenant(db)
    assert client.get("/api/v1/site/health", headers=tenant.headers).status_code == 404
    generate(client, db, tenant)
    report = client.post("/api/v1/site/health-check", headers=tenant.headers).json()
    assert 0 <= report["score"] <= 100
    assert {"factory_images", "product_images"} <= {i["key"] for i in report["issues"]}
    assert all(i["fix"] for i in report["issues"])
    assert client.get("/api/v1/site/health", headers=tenant.headers).json()["score"] == report["score"]


def test_template_switch(client, db) -> None:
    tenant = ready_tenant(db)
    generate(client, db, tenant)
    assert (
        client.patch("/api/v1/site", json={"template": "consumer"}, headers=tenant.headers).json()["template_key"]
        == "consumer"
    )
    assert client.patch("/api/v1/site", json={"template": "evil"}, headers=tenant.headers).status_code == 422


# ── 助手工具 ───────────────────────────────────────────────────────────


def test_site_tools_via_assistant(client, db, llm) -> None:
    from tests.test_assistant import call, new_conversation, send, text

    tenant = ready_tenant(db)
    llm.script("assistant.chat", call("site_generate_draft", {"template": "industrial"}), text("正在生成"))
    events = send(client, tenant, new_conversation(client, tenant), "帮我生成英文官网")
    card = next(e["data"] for e in events if e["event"] == "block.card")
    assert card["card_type"] == "site"
    run_pending(db)

    # 发布需要确认
    llm.script("assistant.chat", call("site_publish", {}))
    events = send(client, tenant, new_conversation(client, tenant), "发布官网")
    confirm = next(e["data"] for e in events if e["event"] == "block.card")
    assert confirm["card_type"] == "confirm"
    assert "将把当前草稿发布到" in confirm["payload"]["summary"]
    assert db.scalar(select(Site)).status == "draft"
    client.post(f"/api/v1/assistant/tool-runs/{confirm['payload']['tool_run_id']}/confirm", headers=tenant.headers)
    run_pending(db)
    db.expire_all()
    assert db.scalar(select(Site)).status == "published"

    llm.script("assistant.chat", call("site_health_check", {}), call("site_list_inquiries", {}, "c2"), text("ok"))
    send(client, tenant, new_conversation(client, tenant), "检查官网并看看询盘")
    tool_outputs = [m["content"] for m in llm.calls[-1]["messages"] if m["role"] == "tool"]
    assert '"score"' in tool_outputs[0] and '"inquiries"' in tool_outputs[1]


def test_site_tools_without_site(client, db, llm) -> None:
    from tests.test_assistant import call, new_conversation, send, text

    tenant = make_tenant(db)
    llm.script("assistant.chat", call("site_generate_draft", {}), call("site_health_check", {}, "c2"), text("x"))
    send(client, tenant, new_conversation(client, tenant), "生成官网")
    outputs = [m["content"] for m in llm.calls[-1]["messages"] if m["role"] == "tool"]
    assert "完整度需要达到" in outputs[0]
    assert "还没有官网" in outputs[1]


def test_published_files_are_world_readable(client, db, sites_dir) -> None:
    """托管容器以不同用户运行，发布的文件必须可读。"""
    import stat

    tenant = ready_tenant(db)
    generate(client, db, tenant)
    site = publish(client, db, tenant)
    live = Path(os.readlink(sites_dir / "live" / site["subdomain_host"]))
    for path in [live, *live.rglob("*")]:
        mode = stat.S_IMODE(path.stat().st_mode)
        assert mode == (0o755 if path.is_dir() else 0o644), (path, oct(mode))
