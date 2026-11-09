"""官网风格：版式 × 配色 × 字体 × 圆角 × 图片处理，组合出每家工厂不同的网站。

- 版式（layout）决定首屏、导航、产品展示、工厂展示的写法（模板中按 layout 分支；CSS 中按 .ly-* 切换）
- 配色（palette）优先从客户上传的 Logo 中提取主色；没有 Logo 时用版式默认配色
- 同行业去重：生成时避开已有客户用过的「版式 + 主色」组合
"""

from __future__ import annotations

import colorsys
import io
import re
import uuid
from typing import Any

from PIL import Image
from sqlalchemy import select
from sqlalchemy.orm import Session

LAYOUTS: dict[str, dict[str, Any]] = {
    "heavy": {
        "label": "重工业",
        "desc": "深色大图首屏，粗体标题，强调产能和设备",
        "palette": {"primary": "#1f3a5f", "accent": "#f2a900"},
        "font": "sans",
        "radius": "sharp",
        "order": ["factory", "products", "about", "certificates", "markets", "cases", "faq"],
    },
    "precision": {
        "label": "精密制造",
        "desc": "大量留白，细线条，参数表格清晰",
        "palette": {"primary": "#0f4c81", "accent": "#00a3e0"},
        "font": "sans",
        "radius": "small",
        "order": ["products", "certificates", "about", "factory", "markets", "faq", "cases"],
    },
    "building": {
        "label": "建材",
        "desc": "暖色调，工程案例和应用场景突出",
        "palette": {"primary": "#7a4a1e", "accent": "#c98a3a"},
        "font": "sans",
        "radius": "small",
        "order": ["about", "products", "cases", "certificates", "factory", "markets", "faq"],
    },
    "consumer": {
        "label": "消费品",
        "desc": "明亮清新，产品图大，圆角卡片",
        "palette": {"primary": "#0b8a6b", "accent": "#ff7a59"},
        "font": "rounded",
        "radius": "round",
        "order": ["products", "about", "markets", "certificates", "factory", "faq", "cases"],
    },
    "heritage": {
        "label": "老牌工厂",
        "desc": "衬线标题，强调历史和口碑，稳重可信",
        "palette": {"primary": "#5b1a1a", "accent": "#b08d57"},
        "font": "serif",
        "radius": "small",
        "order": ["about", "factory", "products", "certificates", "markets", "cases", "faq"],
    },
    "tech": {
        "label": "科技感",
        "desc": "深色背景，渐变点缀，适合电子、新能源",
        "palette": {"primary": "#3b2fc9", "accent": "#22d3ee"},
        "font": "sans",
        "radius": "small",
        "order": ["products", "factory", "certificates", "about", "markets", "faq", "cases"],
    },
}
FONTS = ("sans", "serif", "rounded")
RADII = ("sharp", "small", "round")
IMAGE_TREATMENTS = ("plain", "framed", "duotone")
DEFAULT_LAYOUT = "precision"
# 旧模板 key → 新版式
LEGACY_TEMPLATE = {"industrial": "precision", "building": "building", "consumer": "consumer"}

_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


def _hex(rgb: tuple[int, int, int]) -> str:
    return "#{:02x}{:02x}{:02x}".format(*rgb)


def _rgb(value: str) -> tuple[int, int, int]:
    return int(value[1:3], 16), int(value[3:5], 16), int(value[5:7], 16)


def luminance(value: str) -> float:
    def channel(c: int) -> float:
        x = c / 255
        return x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4

    r, g, b = _rgb(value)
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)


def contrast(a: str, b: str) -> float:
    la, lb = sorted((luminance(a), luminance(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def readable_primary(value: str) -> str:
    """主色要能放白字：对比度不足 4.5 时逐步加深。"""
    r, g, b = (c / 255 for c in _rgb(value))
    h, lum, sat = colorsys.rgb_to_hls(r, g, b)
    for _ in range(20):
        candidate = _hex(tuple(round(c * 255) for c in colorsys.hls_to_rgb(h, lum, sat)))  # type: ignore[arg-type]
        if contrast(candidate, "#ffffff") >= 4.5:
            return candidate
        lum = max(0.0, lum - 0.05)
    return "#1d232b"


def extract_palette(data: bytes) -> dict[str, str] | None:
    """从 Logo 中提取主色与辅色：忽略透明、接近白 / 黑 / 灰的像素，按出现频率取前两种色相差异明显的颜色。"""
    try:
        with Image.open(io.BytesIO(data)) as image:
            image.load()
            rgba = image.convert("RGBA")
            rgba.thumbnail((96, 96))
            raw = rgba.tobytes()
    except (OSError, ValueError, Image.DecompressionBombError):
        return None
    buckets: dict[tuple[int, int, int], int] = {}
    for i in range(0, len(raw) - 3, 4):
        r, g, b, a = raw[i], raw[i + 1], raw[i + 2], raw[i + 3]
        if a < 128:
            continue
        _, lum, sat = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
        if lum > 0.92 or lum < 0.08 or sat < 0.18:
            continue
        key = (r // 24 * 24 + 12, g // 24 * 24 + 12, b // 24 * 24 + 12)
        buckets[key] = buckets.get(key, 0) + 1
    if not buckets:
        return None
    ranked = sorted(buckets.items(), key=lambda kv: kv[1], reverse=True)
    primary = ranked[0][0]
    ph = colorsys.rgb_to_hls(*(c / 255 for c in primary))[0]
    accent = None
    for color, _count in ranked[1:]:
        hue = colorsys.rgb_to_hls(*(c / 255 for c in color))[0]
        if min(abs(hue - ph), 1 - abs(hue - ph)) > 0.08:
            accent = color
            break
    out = {"primary": readable_primary(_hex(primary))}
    if accent is not None:
        out["accent"] = _hex(accent)
    return out


def normalize(style: dict[str, Any] | None, template_key: str = "") -> dict[str, Any]:
    """补全并校验风格配置（只允许预设值与 #rrggbb 颜色，避免注入 CSS）。"""
    style = dict(style or {})
    layout = style.get("layout")
    if layout not in LAYOUTS:
        layout = LEGACY_TEMPLATE.get(template_key, DEFAULT_LAYOUT)
    preset = LAYOUTS[layout]
    palette = {**preset["palette"]}
    for key in ("primary", "accent"):
        value = (style.get("palette") or {}).get(key)
        if isinstance(value, str) and _HEX.match(value):
            palette[key] = value.lower()
    palette["primary"] = readable_primary(palette["primary"])
    font = style.get("font") if style.get("font") in FONTS else preset["font"]
    radius = style.get("radius") if style.get("radius") in RADII else preset["radius"]
    image = style.get("image") if style.get("image") in IMAGE_TREATMENTS else "plain"
    return {"layout": layout, "palette": palette, "font": font, "radius": radius, "image": image}


def css_vars(style: dict[str, Any]) -> str:
    """生成 :root 变量（值均已校验，可安全写入 <style>）。"""
    p = style["palette"]
    return f":root{{--brand:{p['primary']};--accent:{p['accent']};}}"


def section_order(style: dict[str, Any]) -> list[str]:
    return list(LAYOUTS[style["layout"]]["order"])


def choose_style(db: Session, company_id: uuid.UUID, choice: str, logo: bytes | None) -> dict[str, Any]:
    """首次生成网站时确定风格：客户选的版式（"own" / 未选时按 Logo 和产品决定），配色从 Logo 提取；
    再与其他客户已用的组合去重。"""
    from app.modules.sites.models import Site

    layout = choice if choice in LAYOUTS else DEFAULT_LAYOUT
    style: dict[str, Any] = {"layout": layout}
    palette = extract_palette(logo) if logo else None
    if palette:
        style["palette"] = palette
    if choice == "own" and palette is None:
        style["layout"] = DEFAULT_LAYOUT
    style = normalize(style)
    used = [
        normalize(s)
        for s in db.scalars(select(Site.style).where(Site.company_id != company_id, Site.style != {})).all()
        if s
    ]
    return dedupe(style, used)


def dedupe(style: dict[str, Any], used: list[dict[str, Any]]) -> dict[str, Any]:
    """与已有网站的「版式 + 主色」完全相同时，换字体 / 图片处理并微调主色，保证看起来不一样。"""
    taken = {(u["layout"], u["palette"]["primary"]) for u in used}
    if (style["layout"], style["palette"]["primary"]) not in taken:
        return style
    r, g, b = (c / 255 for c in _rgb(style["palette"]["primary"]))
    h, lum, sat = colorsys.rgb_to_hls(r, g, b)
    for step in range(1, 12):
        hue = (h + 0.06 * step) % 1
        candidate = readable_primary(_hex(tuple(round(c * 255) for c in colorsys.hls_to_rgb(hue, lum, sat))))  # type: ignore[arg-type]
        if (style["layout"], candidate) not in taken:
            fonts = [f for f in FONTS if f != style["font"]]
            images = [i for i in IMAGE_TREATMENTS if i != style["image"]]
            return {
                **style,
                "palette": {**style["palette"], "primary": candidate},
                "font": fonts[step % len(fonts)],
                "image": images[step % len(images)],
            }
    return style
