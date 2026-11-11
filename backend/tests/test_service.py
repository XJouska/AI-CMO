"""代运营服务：开通向导、服务进度、修改意见、确认上线、运营待办与工作台、网站风格、联系话术包。"""

from __future__ import annotations

import io

from PIL import Image
from sqlalchemy import select

from app.core.jobs import run_pending
from app.modules.leads.models import Buyer, Lead, Watch
from app.modules.leads.pipeline import extract_channels
from app.modules.outreach import kit
from app.modules.outreach.models import LeadPipeline, OutreachDraft
from app.modules.service.models import ServiceProfile, ServiceTask
from app.modules.sites import styles
from app.modules.sites.models import Notification, Site
from tests.factories import complete_profile, make_product, make_tenant
from tests.tenancy_matrix import png_bytes


def staff_headers(db):
    staff = make_tenant(db, is_staff=True)
    return staff.auth


def upload(client, tenant, kind: str, data: bytes | None = None, name: str = "a.png"):
    return client.post(
        "/api/v1/assets",
        headers=tenant.headers,
        data={"kind": kind},
        files={"file": (name, data or png_bytes(), "image/png")},
    )


# ── 开通向导与进度 ────────────────────────────────────────────────────


def test_overview_before_onboarding_points_to_wizard(client, db):
    tenant = make_tenant(db)
    res = client.get("/api/v1/service/overview", headers=tenant.headers)
    assert res.status_code == 200
    data = res.json()
    assert data["stage"] == "start"
    assert data["submitted"] is False
    assert data["buyers"]["state"] == "none"
    assert data["next"]["link"] == "/start"
    # 照片全部可选
    assert all("required" not in c for c in data["categories"])
    assert {c["key"] for c in data["categories"] if c["recommended"]} == {
        "product_photo",
        "factory_photo",
        "business_card",
    }


def test_business_description_starts_finding_buyers_without_photos_or_site(client, db):
    tenant = make_tenant(db)
    res = client.post(
        "/api/v1/service/business",
        headers=tenant.headers,
        json={"business": "不锈钢球阀、闸阀", "target_markets": "德国、波兰"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["buyers"]["state"] == "preparing"
    run_pending(db)
    db.expire_all()
    overview = client.get("/api/v1/service/overview", headers=tenant.headers).json()
    assert overview["buyers"]["state"] == "searching"
    assert overview["buyers"]["markets"] == ["Germany", "Poland"]
    assert len(overview["buyers"]["products"]) == 2
    # 不需要照片、不需要网站
    assert overview["stage"] == "materials"
    assert overview["next"]["link"] == "/materials" and "照片" in overview["next"]["title"]
    watch = db.scalar(select(Watch).where(Watch.company_id == tenant.company.id))
    assert watch.is_active and watch.status == "active"
    assert "stainless steel ball valve" in watch.keywords_en
    profile = db.get(ServiceProfile, tenant.company.id)
    assert profile.quickstart_status == "done" and profile.buyers_started_at is not None
    assert db.get(type(tenant.company), tenant.company.id).name_en == "Demo Factory Co., Ltd."
    # 运营待办里能看到客户写的业务
    tasks = db.scalars(select(ServiceTask).where(ServiceTask.company_id == tenant.company.id)).all()
    assert [t.kind for t in tasks] == ["organize"] and "球阀" in tasks[0].note


def test_business_without_recognizable_products_is_flagged_for_staff(client, db):
    tenant = make_tenant(db)
    client.post("/api/v1/service/business", headers=tenant.headers, json={"business": "我们什么都做"})
    run_pending(db)
    db.expire_all()
    profile = db.get(ServiceProfile, tenant.company.id)
    assert profile.quickstart_status == "failed" and profile.quickstart_error
    ops = staff_headers(db)
    bench = client.get(f"/api/v1/ops/customers/{tenant.company.id}/workbench", headers=ops).json()
    assert bench["business"] == "我们什么都做" and bench["quickstart_status"] == "failed"


def test_quickstart_keeps_existing_english_name_and_products(client, db):
    tenant = make_tenant(db)
    tenant.company.name_en = "Yonggu Valve Co., Ltd."
    make_product(db, tenant.company, name_en="Stainless Steel Ball Valve", keywords_en=["ball valve"])
    client.post("/api/v1/service/business", headers=tenant.headers, json={"business": "不锈钢球阀、水泵"})
    run_pending(db)
    db.expire_all()
    from app.modules.companies.models import Product

    names = sorted(db.scalars(select(Product.name_en).where(Product.company_id == tenant.company.id)).all())
    assert names == ["Stainless Steel Ball Valve", "Water Pump"]
    assert db.get(type(tenant.company), tenant.company.id).name_en == "Yonggu Valve Co., Ltd."


def test_onboarding_style_step_creates_one_organize_task(client, db):
    tenant = make_tenant(db)
    client.post("/api/v1/service/business", headers=tenant.headers, json={"business": "不锈钢球阀"})
    res = client.post(
        "/api/v1/service/onboarding",
        headers=tenant.headers,
        json={"style_choice": "heritage", "links": ["www.demo-valve.example"], "note": "想多接欧洲的单子"},
    )
    assert res.status_code == 200, res.text
    profile = db.get(ServiceProfile, tenant.company.id)
    assert profile.style_choice == "heritage"
    assert profile.existing_links == ["https://www.demo-valve.example"]
    task = db.scalar(select(ServiceTask).where(ServiceTask.company_id == tenant.company.id))
    assert "球阀" in task.note and "欧洲" in task.note
    client.post("/api/v1/service/onboarding", headers=tenant.headers, json={"style_choice": "tech"})
    tasks = db.scalars(select(ServiceTask).where(ServiceTask.company_id == tenant.company.id)).all()
    assert [t.kind for t in tasks] == ["organize"]


def test_onboarding_rejects_bad_links_and_unknown_style(client, db):
    tenant = make_tenant(db)
    bad = client.post(
        "/api/v1/service/onboarding", headers=tenant.headers, json={"style_choice": "heavy", "links": ["javascript:x"]}
    )
    assert bad.status_code == 422
    unknown = client.post("/api/v1/service/onboarding", headers=tenant.headers, json={"style_choice": "fancy"})
    assert unknown.status_code == 422


def test_image_only_categories_reject_pdf(client, db):
    tenant = make_tenant(db)
    pdf = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"
    res = client.post(
        "/api/v1/assets",
        headers=tenant.headers,
        data={"kind": "product_photo"},
        files={"file": ("a.pdf", pdf, "application/pdf")},
    )
    assert res.status_code == 415


def ready_company(client, db, *, style_choice="heavy"):
    tenant = make_tenant(db)
    complete_profile(db, tenant.company)
    make_product(db, tenant.company, name_en="Stainless Steel Ball Valve", keywords_en=["ball valve"])
    for kind in ("factory_photo", "product_photo", "business_card"):
        assert upload(client, tenant, kind).status_code == 201
    client.post("/api/v1/service/onboarding", headers=tenant.headers, json={"style_choice": style_choice})
    return tenant


def test_full_service_flow_from_materials_to_buyers(client, db):
    tenant = ready_company(client, db)
    ops = staff_headers(db)
    cid = str(tenant.company.id)

    # 运营在待办中看到「整理资料」
    tasks = client.get("/api/v1/ops/tasks", headers=ops).json()
    assert any(t["company_id"] == cid and t["kind"] == "organize" for t in tasks)

    bench = client.get(f"/api/v1/ops/customers/{cid}/workbench", headers=ops).json()
    assert bench["stage"] == "materials" and bench["waiting_on"] == "team"
    assert [s["done"] for s in bench["steps"]] == [True, True, False, False, False]

    # 生成网站（运营代操作：加入企业后调用企业接口）
    client.post(f"/api/v1/ops/customers/{cid}/join", headers=ops)
    ops_company = {**ops, "X-Company-Id": cid}
    assert client.post("/api/v1/site/generate", headers=ops_company, json={}).status_code == 202
    run_pending(db)
    site = db.scalar(select(Site).where(Site.company_id == tenant.company.id))
    assert site.style["layout"] == "heavy"  # 客户在向导中选的风格
    overview = client.get("/api/v1/service/overview", headers=tenant.headers).json()
    assert overview["stage"] == "building"

    # 客户还不能确认（运营尚未发给客户）
    assert client.post("/api/v1/service/approve-site", headers=tenant.headers).status_code == 409

    # 发给客户确认 → 客户收到通知，进度到「网站待你确认」
    res = client.post(f"/api/v1/ops/customers/{cid}/request-review", headers=ops)
    assert res.status_code == 200
    assert db.scalar(
        select(Notification).where(Notification.company_id == tenant.company.id, Notification.link == "/my-site")
    )
    overview = client.get("/api/v1/service/overview", headers=tenant.headers).json()
    assert overview["stage"] == "review" and overview["next"]["link"] == "/my-site"
    assert [s["state"] for s in overview["stages"]] == ["done", "done", "current", "todo"]

    # 客户提修改意见 → 回到「制作中」，运营待办出现「修改网站」
    req = client.post("/api/v1/service/requests", headers=tenant.headers, json={"text": "首页换成车间照片"})
    assert req.status_code == 201 and req.json()["kind"] == "revise_site"
    overview = client.get("/api/v1/service/overview", headers=tenant.headers).json()
    assert overview["stage"] == "building" and "修改" in overview["next"]["title"]

    # 运营改完再次发给客户 → 客户确认上线
    client.post(f"/api/v1/ops/customers/{cid}/request-review", headers=ops)
    approved = client.post("/api/v1/service/approve-site", headers=tenant.headers)
    assert approved.status_code == 200, approved.text
    run_pending(db)
    db.refresh(site)
    assert site.status == "published"
    overview = client.get("/api/v1/service/overview", headers=tenant.headers).json()
    assert overview["stage"] == "live" and overview["site_url"]

    # 开始找买家：自动建立并启用找买家计划
    bench = client.post(f"/api/v1/ops/customers/{cid}/start-buyers", headers=ops).json()
    assert bench["watch_active"] is True
    assert db.scalar(select(Watch).where(Watch.company_id == tenant.company.id, Watch.is_active.is_(True)))
    overview = client.get("/api/v1/service/overview", headers=tenant.headers).json()
    assert overview["stage"] == "live" and overview["buyers"]["state"] == "searching"


def test_revision_request_validates_asset_ownership(client, db):
    tenant = make_tenant(db)
    other = make_tenant(db)
    foreign = upload(client, other, "product_photo").json()["id"]
    res = client.post(
        "/api/v1/service/requests", headers=tenant.headers, json={"text": "换图片", "asset_ids": [foreign]}
    )
    assert res.status_code == 404


def test_ops_task_update_and_listing(client, db):
    tenant = ready_company(client, db)
    ops = staff_headers(db)
    task = db.scalar(select(ServiceTask).where(ServiceTask.company_id == tenant.company.id))
    res = client.patch(f"/api/v1/ops/tasks/{task.id}", headers=ops, json={"status": "done"})
    assert res.status_code == 200 and res.json()["done_at"]
    open_ids = {t["id"] for t in client.get("/api/v1/ops/tasks", headers=ops).json()}
    assert str(task.id) not in open_ids
    done_ids = {t["id"] for t in client.get("/api/v1/ops/tasks?status=done", headers=ops).json()}
    assert str(task.id) in done_ids


# ── 网站风格 ──────────────────────────────────────────────────────────


def logo_png(color=(200, 30, 40)) -> bytes:
    image = Image.new("RGB", (80, 40), (255, 255, 255))
    for x in range(10, 70):
        for y in range(8, 32):
            image.putpixel((x, y), color)
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


def test_extract_palette_from_logo_is_readable():
    palette = styles.extract_palette(logo_png())
    assert palette is not None
    r, g, b = styles._rgb(palette["primary"])
    assert r > g and r > b  # 红色系
    assert styles.contrast(palette["primary"], "#ffffff") >= 4.5


def test_normalize_rejects_css_injection():
    style = styles.normalize(
        {"layout": "tech", "palette": {"primary": "red;}body{display:none", "accent": "#00ff00"}, "font": "x"}
    )
    assert style["layout"] == "tech"
    assert style["palette"]["primary"].startswith("#") and ";" not in style["palette"]["primary"]
    assert style["palette"]["accent"] == "#00ff00"
    assert style["font"] in styles.FONTS
    assert styles.css_vars(style).count("{") == 1


def test_dedupe_changes_color_when_same_layout_and_color_taken():
    base = styles.normalize({"layout": "heavy"})
    other = styles.dedupe(base, [base])
    assert other["layout"] == "heavy"
    assert other["palette"]["primary"] != base["palette"]["primary"]


def test_site_uses_logo_colors_and_differs_between_customers(client, db):
    first = ready_company(client, db, style_choice="own")
    upload(client, first, "logo", logo_png((30, 120, 200)))
    second = ready_company(client, db, style_choice="own")
    upload(client, second, "logo", logo_png((30, 120, 200)))
    ops = staff_headers(db)
    for tenant in (first, second):
        cid = str(tenant.company.id)
        client.post(f"/api/v1/ops/customers/{cid}/join", headers=ops)
        assert client.post("/api/v1/site/generate", headers={**ops, "X-Company-Id": cid}, json={}).status_code == 202
        run_pending(db)
    a = db.scalar(select(Site).where(Site.company_id == first.company.id)).style
    b = db.scalar(select(Site).where(Site.company_id == second.company.id)).style
    assert a["palette"]["primary"] != "#1f3a5f"  # 来自 Logo，不是版式默认色
    assert (a["layout"], a["palette"]["primary"]) != (b["layout"], b["palette"]["primary"])


def test_preview_renders_layout_classes_and_theme(client, db):
    tenant = ready_company(client, db, style_choice="tech")
    upload(client, tenant, "logo", logo_png())
    ops = staff_headers(db)
    cid = str(tenant.company.id)
    client.post(f"/api/v1/ops/customers/{cid}/join", headers=ops)
    client.post("/api/v1/site/generate", headers={**ops, "X-Company-Id": cid}, json={})
    run_pending(db)
    res = client.put(
        f"/api/v1/ops/customers/{cid}/site-style",
        headers=ops,
        json={"layout": "heritage", "primary": "#334455", "font": "serif"},
    )
    assert res.status_code == 200 and res.json()["site"]["style"]["layout"] == "heritage"
    url = client.get("/api/v1/site/preview-url", headers=tenant.headers).json()["url"]
    html = client.get(url).text
    assert 'class="ly-heritage ft-serif' in html
    assert "--brand:#334455" in html
    assert 'class="brand-logo"' in html


def test_site_style_rejects_invalid_color(client, db):
    tenant = make_tenant(db)
    ops = staff_headers(db)
    res = client.put(
        f"/api/v1/ops/customers/{tenant.company.id}/site-style",
        headers=ops,
        json={"layout": "heavy", "primary": "#fff;}"},
    )
    assert res.status_code == 422


# ── 买家联系渠道与话术包 ──────────────────────────────────────────────


def test_extract_channels_only_from_buyer_domain():
    html = """
    <a href="https://wa.me/4915112345678">WhatsApp</a>
    <a href="https://de.linkedin.com/company/stadtwerke-example/">LinkedIn</a>
    <a href="https://evil.example/contact">Contact</a>
    <a href="/en/request-a-quote">Get a quote</a>
    """
    out = extract_channels(html, "https://stadtwerke.example/", "stadtwerke.example")
    assert out["whatsapp"] == ["+4915112345678"]
    assert out["linkedin"] == "https://www.linkedin.com/company/stadtwerke-example"
    assert out["form_url"] == "https://stadtwerke.example/en/request-a-quote"


def make_buyer_lead(db, tenant, contacts):
    buyer = Buyer(
        company_id=tenant.company.id,
        name="Stadtwerke Example",
        domain="stadtwerke.example",
        country="Germany",
        public_contacts=contacts,
    )
    db.add(buyer)
    db.flush()
    lead = Lead(
        company_id=tenant.company.id,
        buyer_id=buyer.id,
        type="tender",
        title="Tender: supply of stainless steel ball valves",
        summary_cn="市政水务项目招标，采购不锈钢球阀",
        products_matched=["Stainless Steel Ball Valve"],
        market="Germany",
        review_status="approved",
    )
    db.add(lead)
    db.flush()
    return lead


def test_contact_kit_has_one_bilingual_item_per_channel(client, db):
    tenant = make_tenant(db)
    complete_profile(db, tenant.company)
    make_product(db, tenant.company, name_en="Stainless Steel Ball Valve")
    lead = make_buyer_lead(
        db,
        tenant,
        {
            "emails": ["procurement@stadtwerke.example"],
            "phones": ["+49 30 1234567"],
            "whatsapp": ["+4915112345678"],
            "linkedin": "https://www.linkedin.com/company/stadtwerke-example",
            "form_url": "https://stadtwerke.example/contact",
        },
    )
    empty = client.get(f"/api/v1/leads/{lead.id}/contact-kit", headers=tenant.headers).json()
    assert empty["items"] == [] and empty["channels"] == ["email", "whatsapp", "phone", "linkedin", "form"]

    res = client.post(f"/api/v1/leads/{lead.id}/contact-kit", headers=tenant.headers)
    assert res.status_code == 201, res.text
    items = {i["channel"]: i for i in res.json()["items"]}
    assert set(items) == {"email", "whatsapp", "phone", "linkedin", "form"}
    for item in items.values():
        assert item["body"] and item["body_zh"]
        assert any("\u4e00" <= ch <= "\u9fff" for ch in item["body_zh"])
    assert items["email"]["subject"] and items["email"]["open_link"].startswith("mailto:procurement@")
    assert items["whatsapp"]["open_link"].startswith("https://wa.me/4915112345678?text=")
    assert items["phone"]["open_link"] == "tel:+49301234567"
    assert items["linkedin"]["subject"] == ""
    assert items["form"]["open_link"] == "https://stadtwerke.example/contact"
    drafts = db.scalars(select(OutreachDraft).where(OutreachDraft.lead_id == lead.id)).all()
    assert len(drafts) == 5


def test_contact_kit_without_contacts_falls_back_to_email(client, db):
    tenant = make_tenant(db)
    complete_profile(db, tenant.company)
    lead = make_buyer_lead(db, tenant, {})
    res = client.post(f"/api/v1/leads/{lead.id}/contact-kit", headers=tenant.headers)
    assert res.status_code == 201
    item = res.json()["items"][0]
    assert item["channel"] == "email" and item["open_link"] == ""


def test_kit_open_link_rejects_unsafe_targets():
    assert kit.open_link("linkedin", "javascript:alert(1)", "", "x") == ""
    assert kit.open_link("whatsapp", "123", "", "x") == ""
    assert kit.open_link("phone", "abc", "", "x") == ""


def test_contact_state_marks_and_does_not_go_backwards(client, db):
    tenant = make_tenant(db)
    lead = make_buyer_lead(db, tenant, {})
    url = f"/api/v1/leads/{lead.id}/contact-state"
    assert client.post(url, headers=tenant.headers, json={"state": "contacted"}).json()["contact_state"] == "contacted"
    assert client.post(url, headers=tenant.headers, json={"state": "replied"}).json()["contact_state"] == "replied"
    # 已回复后再点「已联系」不倒退
    assert client.post(url, headers=tenant.headers, json={"state": "contacted"}).json()["contact_state"] == "replied"
    assert (
        client.post(url, headers=tenant.headers, json={"state": "not_interested"}).json()["contact_state"]
        == "not_interested"
    )
    pipe = db.scalar(select(LeadPipeline).where(LeadPipeline.lead_id == lead.id))
    assert pipe.stage == "lost"


def test_generated_site_uses_uploaded_photos(client, db):
    tenant = ready_company(client, db, style_choice="heavy")
    ops = staff_headers(db)
    cid = str(tenant.company.id)
    client.post(f"/api/v1/ops/customers/{cid}/join", headers=ops)
    client.post("/api/v1/site/generate", headers={**ops, "X-Company-Id": cid}, json={})
    run_pending(db)
    site = db.scalar(select(Site).where(Site.company_id == tenant.company.id))
    from app.modules.sites.models import SiteVersion

    content = db.get(SiteVersion, site.draft_version_id).content
    assert len(content["factory"]["image_asset_ids"]) == 1
    assert content["products"]["items"][0]["image_asset_id"]
    url = client.get("/api/v1/site/preview-url", headers=tenant.headers).json()["url"]
    assert 'class="hero-bg"' in client.get(url).text


def test_account_without_business_is_asked_for_products(client, db):
    """改版前注册、只选了网站风格的账号：首页引导先填产品。"""
    tenant = make_tenant(db)
    client.post("/api/v1/service/onboarding", headers=tenant.headers, json={"style_choice": "heavy"})
    data = client.get("/api/v1/service/overview", headers=tenant.headers).json()
    assert data["buyers"]["state"] == "none"
    assert data["next"]["link"] == "/start" and "产品" in data["next"]["title"]
