"""企业档案、完整度、产品、资料上传与签名下载。"""

from __future__ import annotations

import io
import time

import pytest
from PIL import Image

from app.modules.companies.models import Company, CompanyProfile, Product
from app.modules.companies.profile import COMPLETENESS_ITEMS, compute_completeness
from app.modules.companies.uploads import display_name, sniff_mime
from tests.factories import make_asset, make_product, make_tenant

# ── 完整度 ─────────────────────────────────────────────────────────────


def test_completeness_weights_sum_to_100() -> None:
    assert sum(item.weight for item in COMPLETENESS_ITEMS) == 100


def test_completeness_empty_and_full() -> None:
    company = Company(name_cn="厂", name_en="")
    profile = CompanyProfile(
        contacts={},
        export_markets=[],
        certifications=[],
        usp="",
        about_en="",
        employees="",
        factory_area="",
        annual_capacity="",
    )
    score, missing = compute_completeness(company, profile, [])
    assert score == 0
    assert len(missing) == len(COMPLETENESS_ITEMS)

    company.name_en = "Factory"
    profile.founded_year = 2008
    profile.employees, profile.factory_area, profile.annual_capacity = "120", "15000 m²", "500k"
    profile.export_markets, profile.certifications = ["Germany"], ["ISO 9001"]
    profile.usp, profile.about_en = "fast", "We make valves."
    profile.contacts = {"phone": "+86 574"}
    product = Product(name_en="Valve", keywords_en=["valve"], images=["a"])
    score, missing = compute_completeness(company, profile, [product])
    assert score == 100
    assert missing == []


def test_completeness_partial_products() -> None:
    company = Company(name_cn="厂", name_en="Factory")
    profile = CompanyProfile(
        contacts={"email": " "},
        export_markets=[],
        certifications=[],
        usp="",
        about_en="",
        employees="",
        factory_area="",
        annual_capacity="",
    )
    score, missing = compute_completeness(company, profile, [Product(name_en="V", keywords_en=[], images=[])])
    assert score == 8 + 15
    assert {m.key for m in missing} >= {"contacts", "product_keywords", "product_images"}


def test_profile_patch_records_manual_source(client, db) -> None:
    tenant = make_tenant(db)
    r = client.patch(
        "/api/v1/profile",
        json={
            "usp": " In-house casting ",
            "export_markets": ["Germany", " Germany", "", "USA"],
            "contacts": {"email": "sales@f.com"},
            "founded_year": 2008,
        },
        headers=tenant.headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["usp"] == "In-house casting"
    assert body["export_markets"] == ["Germany", "USA"]
    assert body["contacts"] == {"email": "sales@f.com"}
    assert body["field_sources"]["usp"]["source"] == "manual"
    assert body["field_sources"]["contacts.email"]["source"] == "manual"
    assert body["completeness"] == 8 + 4 + 10 + 8  # usp + founded_year + 联系方式 + 出口市场
    assert "usp" not in {m["key"] for m in body["missing"]}


@pytest.mark.parametrize(
    "payload",
    [
        {"contacts": {"password": "x"}},
        {"founded_year": 1500},
        {"usp": "x" * 2001},
        {"export_markets": ["x"] * 51},
    ],
)
def test_profile_patch_validation(client, db, payload) -> None:
    tenant = make_tenant(db)
    assert client.patch("/api/v1/profile", json=payload, headers=tenant.headers).status_code == 422


def test_profile_can_clear_founded_year(client, db) -> None:
    tenant = make_tenant(db)
    client.patch("/api/v1/profile", json={"founded_year": 2001}, headers=tenant.headers)
    assert (
        client.patch("/api/v1/profile", json={"founded_year": None}, headers=tenant.headers).json()[
            "founded_year"
        ]
        is None
    )


# ── 产品 ───────────────────────────────────────────────────────────────


def test_product_crud(client, db) -> None:
    tenant = make_tenant(db)
    image = make_asset(db, tenant.company)
    r = client.post(
        "/api/v1/products",
        json={
            "name_en": "Ball Valve",
            "keywords_en": ["ball valve", "ball valve", " "],
            "images": [str(image.id)],
            "specs": {"Size": "DN15-DN100"},
        },
        headers=tenant.headers,
    )
    assert r.status_code == 201, r.text
    product = r.json()
    assert product["keywords_en"] == ["ball valve"]
    assert product["images"] == [str(image.id)]

    pid = product["id"]
    assert (
        client.patch(f"/api/v1/products/{pid}", json={"moq": "100 pcs"}, headers=tenant.headers).json()["moq"]
        == "100 pcs"
    )
    assert [p["id"] for p in client.get("/api/v1/products", headers=tenant.headers).json()] == [pid]
    profile = client.get("/api/v1/profile", headers=tenant.headers).json()
    assert profile["product_count"] == 1
    assert {"products", "product_keywords", "product_images"}.isdisjoint(
        {m["key"] for m in profile["missing"]}
    )

    assert client.delete(f"/api/v1/products/{pid}", headers=tenant.headers).status_code == 204
    assert client.get(f"/api/v1/products/{pid}", headers=tenant.headers).status_code == 404


def test_product_rejects_other_company_images(client, db) -> None:
    tenant = make_tenant(db)
    other = make_tenant(db)
    foreign = make_asset(db, other.company)
    pdf = make_asset(db, tenant.company, kind="catalog", mime="application/pdf")
    for image_id in (foreign.id, pdf.id):
        r = client.post(
            "/api/v1/products", json={"name_en": "X", "images": [str(image_id)]}, headers=tenant.headers
        )
        assert r.status_code == 400
        assert r.json()["error"]["code"] == "invalid_images"
    product = make_product(db, tenant.company)
    r = client.patch(
        f"/api/v1/products/{product.id}", json={"images": [str(foreign.id)]}, headers=tenant.headers
    )
    assert r.status_code == 400


def test_product_spec_limits(client, db) -> None:
    tenant = make_tenant(db)
    specs = {f"k{i}": "v" for i in range(31)}
    assert (
        client.post(
            "/api/v1/products", json={"name_en": "X", "specs": specs}, headers=tenant.headers
        ).status_code
        == 422
    )
    product = make_product(db, tenant.company)
    r = client.patch(f"/api/v1/products/{product.id}", json={"specs": specs}, headers=tenant.headers)
    assert r.status_code == 422


# ── 上传 ───────────────────────────────────────────────────────────────


def image_bytes(fmt: str = "PNG", exif: bool = False) -> bytes:
    image = Image.new("RGB", (16, 16), (10, 20, 30))
    buf = io.BytesIO()
    if exif:
        data = Image.Exif()
        data[0x010F] = "SecretCamera"  # Make
        data[0x8825] = {2: (31.0, 14.0, 0.0)}  # GPSInfo
        image.save(buf, format=fmt, exif=data.tobytes())
    else:
        image.save(buf, format=fmt)
    return buf.getvalue()


def minimal_pdf(text: str = "Stainless steel ball valve catalog") -> bytes:
    content = f"BT /F1 12 Tf 72 712 Td ({text}) Tj ET".encode()
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length " + str(len(content)).encode() + b" >>\nstream\n" + content + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = []
    for index, obj in enumerate(objects, start=1):
        offsets.append(out.tell())
        out.write(f"{index} 0 obj\n".encode() + obj + b"\nendobj\n")
    xref = out.tell()
    out.write(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode())
    for offset in offsets:
        out.write(f"{offset:010d} 00000 n \n".encode())
    out.write(f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF".encode())
    return out.getvalue()


def upload(
    client, tenant, data: bytes, name: str = "photo.png", kind: str = "image", mime: str = "image/png"
):
    return client.post(
        "/api/v1/assets", files={"file": (name, data, mime)}, data={"kind": kind}, headers=tenant.headers
    )


def test_upload_image_strips_exif_and_uses_random_key(client, db, storage) -> None:
    tenant = make_tenant(db)
    raw = image_bytes("JPEG", exif=True)
    assert b"SecretCamera" in raw
    r = upload(client, tenant, raw, name="../../etc/passwd.jpg", mime="image/jpeg")
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["mime"] == "image/jpeg"
    assert body["display_name"] == "passwd.jpg"
    [(key, stored)] = storage.files.items()
    assert key.startswith(f"{tenant.company.id}/")
    assert "passwd" not in key
    assert b"SecretCamera" not in stored
    with Image.open(io.BytesIO(stored)) as img:
        assert not img.getexif()


@pytest.mark.parametrize(
    ("data", "name", "mime"),
    [
        (b"<?php system($_GET['c']); ?>", "shell.png", "image/png"),  # 伪造扩展名
        (b"<html><script>alert(1)</script></html>", "x.jpg", "image/jpeg"),
        (b"MZ\x90\x00binary", "catalog.pdf", "application/pdf"),
        (b"GIF89a....", "a.gif", "image/gif"),
        (
            b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>",
            "a.svg",
            "image/svg+xml",
        ),
        (b"\x89PNG\r\n\x1a\nnot really a png", "broken.png", "image/png"),
        (b"%PDF-1.4 garbage", "broken.pdf", "application/pdf"),
    ],
)
def test_upload_rejects_disguised_or_broken_files(client, db, storage, data, name, mime) -> None:
    tenant = make_tenant(db)
    r = upload(client, tenant, data, name=name, kind="catalog", mime=mime)
    assert r.status_code == 415, r.text
    assert r.json()["error"]["code"] == "unsupported_file"
    assert storage.files == {}


def test_upload_size_limit(client, db, monkeypatch) -> None:
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "max_upload_bytes", 1024)
    tenant = make_tenant(db)
    r = upload(client, tenant, b"%PDF-" + b"0" * 2048, name="big.pdf", kind="catalog", mime="application/pdf")
    assert r.status_code == 413


def test_upload_empty_and_bad_kind(client, db) -> None:
    tenant = make_tenant(db)
    assert upload(client, tenant, b"").status_code == 400
    assert upload(client, tenant, image_bytes(), kind="exe").json()["error"]["code"] == "invalid_kind"
    r = upload(client, tenant, minimal_pdf(), name="c.pdf", kind="image", mime="application/pdf")
    assert r.status_code == 415


def test_upload_pdf_extracts_text(client, db) -> None:
    tenant = make_tenant(db)
    r = upload(client, tenant, minimal_pdf(), name="catalog.pdf", kind="catalog", mime="application/pdf")
    assert r.status_code == 201, r.text
    assert r.json()["has_text"] is True
    from app.modules.companies.models import Asset

    asset = db.get(Asset, r.json()["id"])
    assert "ball valve" in asset.text_content


@pytest.mark.parametrize("fmt", ["PNG", "WEBP"])
def test_upload_other_image_formats(client, db, fmt) -> None:
    tenant = make_tenant(db)
    r = upload(client, tenant, image_bytes(fmt), name=f"x.{fmt.lower()}")
    assert r.status_code == 201
    assert r.json()["mime"] == f"image/{fmt.lower()}"


def test_signed_download_and_tampering(client, db, storage) -> None:
    tenant = make_tenant(db)
    asset_id = upload(client, tenant, image_bytes()).json()["id"]
    url = client.get(f"/api/v1/assets/{asset_id}/download-url", headers=tenant.headers).json()["url"]
    r = client.get(url)  # 无需登录
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"
    assert r.headers["x-content-type-options"] == "nosniff"
    assert "sandbox" in r.headers["content-security-policy"]

    other = make_tenant(db)
    other_id = upload(client, other, image_bytes()).json()["id"]
    assert client.get(url.replace(asset_id, other_id)).status_code == 404  # 签名绑定资料 ID
    assert client.get(url[:-4] + "0000").status_code == 404  # 篡改签名
    expired = url.split("?")[0] + f"?exp={int(time.time()) - 1}&sig=" + url.rsplit("sig=", 1)[1]
    assert client.get(expired).status_code == 404


def test_signed_download_expires(client, db, monkeypatch) -> None:
    from app.core.security import crypto

    tenant = make_tenant(db)
    asset_id = upload(client, tenant, image_bytes()).json()["id"]
    url = client.get(f"/api/v1/assets/{asset_id}/download-url", headers=tenant.headers).json()["url"]
    now = time.time()
    monkeypatch.setattr(crypto, "_now", lambda: now + 599)
    assert client.get(url).status_code == 200
    monkeypatch.setattr(crypto, "_now", lambda: now + 601)
    assert client.get(url).status_code == 404


def test_delete_asset_detaches_from_products(client, db, storage) -> None:
    tenant = make_tenant(db)
    asset_id = upload(client, tenant, image_bytes()).json()["id"]
    product = client.post(
        "/api/v1/products", json={"name_en": "V", "images": [asset_id]}, headers=tenant.headers
    ).json()
    assert client.delete(f"/api/v1/assets/{asset_id}", headers=tenant.headers).status_code == 204
    assert storage.files == {}
    assert client.get(f"/api/v1/products/{product['id']}", headers=tenant.headers).json()["images"] == []
    assert client.get("/api/v1/assets", headers=tenant.headers).json() == []


def test_list_assets_filter(client, db) -> None:
    tenant = make_tenant(db)
    upload(client, tenant, image_bytes())
    upload(client, tenant, minimal_pdf(), name="c.pdf", kind="certificate", mime="application/pdf")
    assert [
        a["kind"] for a in client.get("/api/v1/assets?kind=certificate", headers=tenant.headers).json()
    ] == ["certificate"]


@pytest.mark.parametrize(
    ("head", "mime"),
    [
        (b"\xff\xd8\xff\xe0", "image/jpeg"),
        (b"RIFF\x00\x00\x00\x00WEBPVP8 ", "image/webp"),
        (b"RIFF\x00\x00\x00\x00AVI ", None),
    ],
)
def test_sniff_mime(head, mime) -> None:
    assert sniff_mime(head) == mime


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("C:\\Users\\a\\证书.pdf", "证书.pdf"),
        ("a\x00b\u202e.pdf", "ab.pdf"),
        ("", "未命名文件"),
        (None, "未命名文件"),
    ],
)
def test_display_name(raw, expected) -> None:
    assert display_name(raw) == expected
