"""官网渲染与静态构建。

安全：
- Jinja2 开启自动转义 + StrictUndefined；所有内容默认按文本输出
- 富文本（about.body、FAQ 回答）经 nh3 白名单清洗：只允许 p / ul / ol / li / strong / em / br / a[href=http(s)]
- JSON-LD 序列化后转义 < > &，防止 </script> 截断
- 图片重新编码为多尺寸 WebP；构建不调用任何外部程序
- 发布：写入新版本目录后，原子替换 live/{host} 软链接
"""

from __future__ import annotations

import io
import json
import os
import re
import shutil
import tempfile
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import nh3
from jinja2 import Environment, FileSystemLoader, StrictUndefined, select_autoescape
from markupsafe import Markup
from PIL import Image

from app.core.config import get_settings
from app.modules.sites.content import SiteContent

TEMPLATES_DIR = Path(os.environ.get("SITE_TEMPLATES_DIR") or Path(__file__).resolve().parents[4] / "site-templates")
IMAGE_WIDTHS = (480, 960, 1600)
SECTION_ORDER = {
    "industrial": ["products", "about", "factory", "certificates", "markets", "cases", "faq"],
    "building": ["about", "products", "certificates", "factory", "cases", "markets", "faq"],
    "consumer": ["products", "about", "markets", "certificates", "factory", "faq", "cases"],
}
ALLOWED_TAGS = {"p", "ul", "ol", "li", "strong", "em", "br", "a"}


def sanitize_rich(html: str) -> Markup:
    """富文本白名单清洗；链接只允许 http / https，并强制 rel=nofollow noopener。"""
    if "<" not in html:
        paragraphs = [p.strip() for p in re.split(r"\n\s*\n", html) if p.strip()]
        html = "".join(f"<p>{nh3.clean_text(p)}</p>" for p in paragraphs)
    cleaned = nh3.clean(
        html,
        tags=ALLOWED_TAGS,
        attributes={"a": {"href"}},
        url_schemes={"http", "https"},
        link_rel="nofollow noopener noreferrer",
        strip_comments=True,
    )
    return Markup(cleaned)  # noqa: S704 - 已经过 nh3 白名单清洗


def json_ld(data: dict[str, Any]) -> Markup:
    text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    text = text.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    return Markup(text)  # noqa: S704 - 已转义所有可能截断 <script> 的字符


def slugify(value: str, fallback: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")[:60]
    return slug or fallback


def environment() -> Environment:
    env = Environment(
        loader=FileSystemLoader(str(TEMPLATES_DIR)),
        autoescape=select_autoescape(enabled_extensions=("j2", "html"), default=True),
        undefined=StrictUndefined,
        trim_blocks=True,
        lstrip_blocks=True,
    )
    return env


@dataclass
class ImageRef:
    src: str
    srcset: str


@dataclass
class RenderContext:
    content: SiteContent
    template: str
    base_url: str  # 规范地址，例如 https://demo.sites.aicmo.site/
    site_id: str
    inquiry_action: str
    images: dict[str, ImageRef]  # asset_id → 图片引用
    products: dict[str, dict[str, Any]]  # product_id → 产品数据（规格等）
    preview: bool = False
    turnstile_sitekey: str = ""


def _org_ld(ctx: RenderContext) -> dict[str, Any]:
    c = ctx.content
    data: dict[str, Any] = {
        "@context": "https://schema.org",
        "@type": "Organization",
        "name": c.company_name,
        "url": ctx.base_url,
    }
    if c.seo.description:
        data["description"] = c.seo.description
    contact = {k: v for k, v in {"email": c.contact.email, "telephone": c.contact.phone}.items() if v}
    if contact:
        data["contactPoint"] = {"@type": "ContactPoint", "contactType": "sales", **contact}
    if c.contact.address:
        data["address"] = c.contact.address
    return data


def _product_ld(ctx: RenderContext, item: dict[str, Any]) -> dict[str, Any]:
    data = {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": item["name"],
        "brand": {"@type": "Brand", "name": ctx.content.company_name},
    }
    if item.get("summary"):
        data["description"] = item["summary"]
    if item.get("image"):
        data["image"] = ctx.base_url.rstrip("/") + "/" + item["image"].src.lstrip("./")
    return data


def _product_items(ctx: RenderContext) -> list[dict[str, Any]]:
    items = []
    used: set[str] = set()
    for index, item in enumerate(ctx.content.products.items):
        slug = slugify(item.name, f"product-{index + 1}")
        while slug in used:
            slug = f"{slug}-{index + 1}"
        used.add(slug)
        extra = ctx.products.get(item.product_id, {})
        items.append(
            {
                "name": item.name,
                "summary": item.summary,
                "slug": slug,
                "image": ctx.images.get(item.image_asset_id) if item.image_asset_id else None,
                "specs": extra.get("specs") or {},
                "moq": extra.get("moq", ""),
                "lead_time": extra.get("lead_time", ""),
                "applications": extra.get("applications") or [],
            }
        )
    return items


def _common(ctx: RenderContext, root: str) -> dict[str, Any]:
    c = ctx.content
    return {
        "content": c,
        "seo": c.seo,
        "template": ctx.template,
        "root": root,
        "preview": ctx.preview,
        "inline_css": Markup((TEMPLATES_DIR / "assets" / "site.css").read_text()) if ctx.preview else "",  # noqa: S704
        "year": datetime.now(UTC).year,
        "inquiry_action": ctx.inquiry_action,
        "turnstile_sitekey": ctx.turnstile_sitekey,
    }


def render_pages(ctx: RenderContext) -> dict[str, str]:
    """渲染全部页面，返回 {相对路径: HTML}。"""
    env = environment()
    c = ctx.content
    products = _product_items(ctx)
    pages: dict[str, str] = {}
    title = c.seo.title or c.company_name
    description = c.seo.description or c.hero.subheadline
    pages["index.html"] = env.get_template("index.html.j2").render(
        **_common(ctx, "./"),
        page_title=title,
        page_description=description,
        canonical=ctx.base_url,
        json_ld=json_ld({"@context": "https://schema.org", "@graph": [_org_ld(ctx)]}),
        section_order=SECTION_ORDER.get(ctx.template, SECTION_ORDER["industrial"]),
        about_body=sanitize_rich(c.about.body),
        faq_items=[{"q": item.q, "a": sanitize_rich(item.a)} for item in c.faq.items],
        factory_images=[ctx.images[i] for i in c.factory.image_asset_ids if i in ctx.images],
        certificate_images=[ctx.images[i] for i in c.certificates.image_asset_ids if i in ctx.images],
        product_items=products,
    )
    for product in products:
        pages[f"products/{product['slug']}.html"] = env.get_template("product.html.j2").render(
            **_common(ctx, "../"),
            page_title=f"{product['name']} | {c.company_name}",
            page_description=product["summary"] or description,
            canonical=f"{ctx.base_url.rstrip('/')}/products/{product['slug']}.html",
            json_ld=json_ld(_product_ld(ctx, product)),
            product=product,
        )
    pages["thank-you.html"] = env.get_template("thank-you.html.j2").render(
        **_common(ctx, "./"),
        page_title=f"Thank you | {c.company_name}",
        page_description=description,
        canonical=f"{ctx.base_url.rstrip('/')}/thank-you.html",
        json_ld=json_ld(_org_ld(ctx)),
    )
    return pages


# ── 静态构建与发布 ─────────────────────────────────────────────────────


def encode_webp_variants(data: bytes) -> dict[int, bytes]:
    """按 IMAGE_WIDTHS 生成 WebP（不放大原图）。"""
    out: dict[int, bytes] = {}
    with Image.open(io.BytesIO(data)) as image:
        image.load()
        rgb = image.convert("RGB")
        for width in IMAGE_WIDTHS:
            target = min(width, rgb.width)
            if target in out:
                break
            height = max(1, round(rgb.height * target / rgb.width))
            resized = rgb.resize((target, height), Image.Resampling.LANCZOS) if target != rgb.width else rgb
            buf = io.BytesIO()
            resized.save(buf, format="WEBP", quality=82, method=4)
            out[target] = buf.getvalue()
            if target == rgb.width:
                break
    return out


def sitemap(base_url: str, paths: list[str]) -> str:
    from xml.sax.saxutils import escape

    base = base_url.rstrip("/")
    urls = "".join(f"<url><loc>{escape(f'{base}/{p}' if p else base + '/')}</loc></url>" for p in paths)
    return f'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{urls}</urlset>'


def robots(base_url: str) -> str:
    return f"User-agent: *\nAllow: /\nSitemap: {base_url.rstrip('/')}/sitemap.xml\n"


def output_root() -> Path:
    root = Path(get_settings().sites_output_dir).resolve()
    for sub in ("versions", "live"):
        (root / sub).mkdir(parents=True, exist_ok=True)
        (root / sub).chmod(0o755)
    return root


_HOST_RE = re.compile(r"^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")


def safe_host(host: str) -> str:
    host = host.strip().lower().rstrip(".")
    if not _HOST_RE.match(host):
        raise ValueError(f"invalid host: {host!r}")
    return host


def write_version(
    site_id: uuid.UUID, version_id: uuid.UUID, pages: dict[str, str], images: dict[str, bytes], base_url: str
) -> Path:
    """把渲染结果写入 versions/{site_id}/{version_id}/（先写临时目录再整体改名）。"""
    root = output_root()
    target = root / "versions" / str(site_id) / str(version_id)
    tmp = Path(tempfile.mkdtemp(dir=target.parent if target.parent.exists() else _mk(target.parent)))
    try:
        for rel, html in pages.items():
            path = (tmp / rel).resolve()
            if tmp.resolve() not in path.parents:
                raise ValueError("path escapes output directory")
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(html, encoding="utf-8")
        (tmp / "assets" / "img").mkdir(parents=True, exist_ok=True)
        shutil.copyfile(TEMPLATES_DIR / "assets" / "site.css", tmp / "assets" / "site.css")
        for name, data in images.items():
            if not re.fullmatch(r"[0-9a-f]{32}-\d+\.webp", name):
                raise ValueError("invalid image name")
            (tmp / "assets" / "img" / name).write_bytes(data)
        html_paths = [p for p in pages if p.endswith(".html") and p != "thank-you.html"]
        (tmp / "sitemap.xml").write_text(sitemap(base_url, ["" if p == "index.html" else p for p in html_paths]))
        (tmp / "robots.txt").write_text(robots(base_url))
        # 官网是公开内容：目录 755、文件 644，托管容器（不同用户）可以读取
        for path in [tmp, *tmp.rglob("*")]:
            path.chmod(0o755 if path.is_dir() else 0o644)
        if target.exists():
            shutil.rmtree(target)
        os.replace(tmp, target)
    except BaseException:
        shutil.rmtree(tmp, ignore_errors=True)
        raise
    return target


def _mk(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True, mode=0o755)
    return path


def activate(hosts: list[str], version_dir: Path) -> None:
    """原子切换：为每个域名创建指向新版本目录的软链接（先建临时链接再 rename 覆盖）。"""
    live = output_root() / "live"
    for host in hosts:
        name = safe_host(host)
        tmp = live / f".{name}.{uuid.uuid4().hex}"
        os.symlink(version_dir, tmp)
        os.replace(tmp, live / name)


def deactivate(hosts: list[str]) -> None:
    live = output_root() / "live"
    for host in hosts:
        try:
            (live / safe_host(host)).unlink(missing_ok=True)
        except ValueError:
            continue
