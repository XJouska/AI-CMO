"""
SEO Health Check Service
Uses Google PageSpeed Insights API (free) + HTML meta tag analysis via AgentGo
"""
import asyncio
import logging
import math
import re
from typing import Dict, List, Optional
from urllib.parse import urlparse

import httpx

from app.services.agentgo import AgentGoService, get_agentgo_service
from app.database import get_database

logger = logging.getLogger(__name__)

PAGESPEED_API = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed"


class SEOService:
    def __init__(self):
        self.agentgo: AgentGoService = get_agentgo_service()

    async def check(self, url: str, user_id: int) -> dict:
        if not url.startswith("http"):
            url = f"https://{url}"

        pagespeed_task = asyncio.create_task(self._fetch_pagespeed(url))
        html_task = asyncio.create_task(self._analyze_html(url))

        pagespeed_data = await pagespeed_task
        html_data = await html_task

        issues = []
        passed = []

        ps_score = pagespeed_data.get("performance_score")
        cwv = pagespeed_data.get("core_web_vitals", {})

        # Evaluate PageSpeed metrics
        if ps_score is not None:
            if ps_score >= 90:
                passed.append({"check": "Performance Score", "value": f"{ps_score}/100", "severity": "pass"})
            elif ps_score >= 50:
                issues.append({"check": "Performance Score", "value": f"{ps_score}/100", "severity": "warning",
                    "hint": f"当前性能评分 {ps_score} 分，处于中等水平。建议：① 压缩图片并使用 WebP 格式 ② 减少未使用的 JavaScript ③ 启用浏览器缓存和 Gzip 压缩 ④ 使用 CDN 加速静态资源"})
            else:
                issues.append({"check": "Performance Score", "value": f"{ps_score}/100", "severity": "error",
                    "hint": f"性能评分仅 {ps_score} 分，严重影响用户体验和 SEO 排名。Google 数据显示加载超过 3 秒，53% 的移动用户会离开。建议优先：① 延迟加载非关键资源 ② 优化首屏渲染路径 ③ 减少服务器响应时间（TTFB）"})

        cwv_thresholds = {
            "FCP": (1800, 3000, "ms", "First Contentful Paint（首次内容绘制）"),
            "LCP": (2500, 4000, "ms", "Largest Contentful Paint（最大内容绘制）"),
            "CLS": (0.1, 0.25, "", "Cumulative Layout Shift（累计布局偏移）"),
            "TBT": (200, 600, "ms", "Total Blocking Time（总阻塞时间）"),
        }
        cwv_tips = {
            "FCP": "优化方案：减少阻塞渲染的 CSS/JS、使用字体 display:swap、预加载关键资源",
            "LCP": "优化方案：优化最大元素（通常是首屏大图或标题文字）的加载速度、使用图片预加载、优化服务器响应时间",
            "CLS": "优化方案：为图片/视频设置明确的 width/height 属性、避免动态注入内容、为广告位预留空间",
            "TBT": "优化方案：拆分长任务（Long Tasks > 50ms）、延迟非关键 JS 执行、使用 Web Worker 处理耗时计算",
        }
        for metric, (good, poor, unit, full_name) in cwv_thresholds.items():
            val = cwv.get(metric.lower())
            if val is not None:
                display = f"{val}{unit}"
                if val <= good:
                    passed.append({"check": f"Core Web Vital: {metric}", "value": display, "severity": "pass"})
                elif val <= poor:
                    issues.append({"check": f"Core Web Vital: {metric}", "value": display, "severity": "warning",
                        "hint": f"{full_name}当前值 {display}，需要优化（良好标准 < {good}{unit}）。{cwv_tips[metric]}"})
                else:
                    issues.append({"check": f"Core Web Vital: {metric}", "value": display, "severity": "error",
                        "hint": f"{full_name}当前值 {display}，远超良好标准 {good}{unit}，严重影响用户体验。{cwv_tips[metric]}"})

        # Evaluate HTML checks
        meta = html_data.get("meta", {})

        title = meta.get("title", "")
        if title:
            tlen = len(title)
            if 30 <= tlen <= 60:
                passed.append({"check": "Title Tag", "value": f"{tlen} chars", "severity": "pass"})
            elif tlen < 30:
                issues.append({"check": "Title Tag", "value": f"{tlen} chars", "severity": "warning",
                    "hint": f"标题仅 {tlen} 字符，太短了（推荐 30-60 字符）。当前标题：\"{title[:80]}\"。较短的标题无法充分利用搜索结果中的展示空间，建议加入核心关键词和品牌名"})
            else:
                issues.append({"check": "Title Tag", "value": f"{tlen} chars", "severity": "warning",
                    "hint": f"标题 {tlen} 字符，超出推荐长度（30-60 字符），搜索结果中会被截断。当前标题：\"{title[:80]}...\"。建议精简标题，将最重要的关键词放在前面"})
        else:
            issues.append({"check": "Title Tag", "value": "Missing", "severity": "error",
                "hint": "页面缺少 <title> 标签，这是 SEO 最基本的要素。搜索引擎依赖 title 标签理解页面主题并在搜索结果中展示。建议添加包含核心关键词的、30-60 字符的标题"})

        desc = meta.get("description", "")
        if desc:
            dlen = len(desc)
            if 120 <= dlen <= 160:
                passed.append({"check": "Meta Description", "value": f"{dlen} chars", "severity": "pass"})
            elif dlen < 120:
                issues.append({"check": "Meta Description", "value": f"{dlen} chars", "severity": "warning",
                    "hint": f"描述仅 {dlen} 字符，太短了（推荐 120-160 字符）。当前描述：\"{desc[:100]}\"。较短的描述在搜索结果中展示不充分，无法有效吸引用户点击。建议补充产品核心卖点和行动号召（CTA）"})
            else:
                issues.append({"check": "Meta Description", "value": f"{dlen} chars", "severity": "warning",
                    "hint": f"描述 {dlen} 字符，超出推荐长度（120-160 字符），搜索结果中会被截断。建议精简到 160 字符以内，确保核心信息在前半部分展示完整"})
        else:
            issues.append({"check": "Meta Description", "value": "Missing", "severity": "error",
                "hint": "页面缺少 meta description。搜索引擎会在搜索结果中展示这段描述，直接影响点击率（CTR）。建议添加 120-160 字符的描述，包含目标关键词和吸引用户点击的文案"})

        if meta.get("canonical"):
            passed.append({"check": "Canonical URL", "value": "Present", "severity": "pass"})
        else:
            issues.append({"check": "Canonical URL", "value": "Missing", "severity": "warning",
                "hint": "缺少 canonical 标签。如果页面有多个 URL 可以访问（如带/不带 www、带参数的变体），搜索引擎可能将它们视为重复内容，分散页面权重。建议添加 <link rel=\"canonical\" href=\"首选URL\"> 指向规范页面"})

        if meta.get("robots") is not None:
            robots = meta["robots"]
            if "noindex" in robots.lower():
                issues.append({"check": "Robots Meta", "value": robots, "severity": "error",
                    "hint": f"当前 robots 设置为 \"{robots}\"，包含 noindex 指令，搜索引擎不会索引此页面！如果这不是预期行为（如测试环境遗留配置），请立即移除 noindex"})
            else:
                passed.append({"check": "Robots Meta", "value": robots, "severity": "pass"})

        h1_count = meta.get("h1_count", 0)
        if h1_count == 1:
            passed.append({"check": "H1 Tag", "value": "1 found", "severity": "pass"})
        elif h1_count == 0:
            issues.append({"check": "H1 Tag", "value": "Missing", "severity": "error",
                "hint": "页面缺少 H1 标签。H1 是页面内容层级的最高标题，帮助搜索引擎理解页面主题。每个页面应有且仅有一个 H1，内容应包含目标关键词且与 title 标签呼应"})
        else:
            issues.append({"check": "H1 Tag", "value": f"{h1_count} found", "severity": "warning",
                "hint": f"页面包含 {h1_count} 个 H1 标签，建议保留唯一一个。多个 H1 会使搜索引擎难以判断页面主题重点。将次要标题改为 H2 或 H3"})

        og_hints = {
            "og:title": "缺少 og:title。当页面被分享到 Facebook、Twitter、微信等社交平台时，将无法正确显示标题。建议设置为与页面 title 一致或更适合社交传播的标题",
            "og:description": "缺少 og:description。社交平台分享时将无法显示描述摘要，降低分享链接的吸引力。建议设置一段简洁有力的描述",
            "og:image": "缺少 og:image。社交平台分享时将没有预览图片，严重降低点击率。研究表明带图片的分享链接点击率提高 2-3 倍。建议设置一张 1200×630 像素的高质量封面图",
        }
        for og_tag in ["og:title", "og:description", "og:image"]:
            if meta.get(og_tag):
                passed.append({"check": og_tag, "value": "Present", "severity": "pass"})
            else:
                issues.append({"check": og_tag, "value": "Missing", "severity": "warning", "hint": og_hints[og_tag]})

        img_total = meta.get("img_total", 0)
        img_alt = meta.get("img_with_alt", 0)
        if img_total > 0:
            pct = round(img_alt / img_total * 100)
            missing = img_total - img_alt
            if pct >= 90:
                passed.append({"check": "Image Alt Text", "value": f"{img_alt}/{img_total} ({pct}%)", "severity": "pass"})
            else:
                issues.append({"check": "Image Alt Text", "value": f"{img_alt}/{img_total} ({pct}%)", "severity": "warning",
                    "hint": f"共 {img_total} 张图片中有 {missing} 张缺少 alt 属性。Alt 文本帮助搜索引擎理解图片内容（图片搜索流量来源），同时也是无障碍访问的必要元素。建议为每张图片添加描述性的 alt 文本"})

        if meta.get("has_ssl"):
            passed.append({"check": "HTTPS", "value": "Enabled", "severity": "pass"})
        else:
            issues.append({"check": "HTTPS", "value": "Not enabled", "severity": "error",
                "hint": "网站未启用 HTTPS。Google 已将 HTTPS 作为排名信号，Chrome 浏览器会将 HTTP 网站标记为\"不安全\"。建议立即配置 SSL 证书（可使用 Let's Encrypt 免费证书），并设置 HTTP 到 HTTPS 的 301 重定向"})

        internal_links = meta.get("internal_links", 0)
        external_links = meta.get("external_links", 0)
        passed.append({"check": "Internal Links", "value": str(internal_links), "severity": "pass"})
        passed.append({"check": "External Links", "value": str(external_links), "severity": "pass"})

        # Compute overall SEO score
        total_checks = len(issues) + len(passed)
        seo_score = round(len(passed) / total_checks * 100) if total_checks > 0 else 0

        # Persist
        db = get_database()
        db.save_seo_snapshot(
            user_id=user_id, url=url,
            page_speed_score=ps_score, seo_score=seo_score,
            core_web_vitals=cwv, issues=issues, passed_checks=passed,
        )
        db.add_activity(
            user_id, "seo_check_completed",
            f"SEO check completed: {urlparse(url).netloc} (Score: {seo_score})",
            {"url": url, "seo_score": seo_score, "page_speed_score": ps_score},
        )

        return {
            "url": url,
            "page_speed_score": ps_score,
            "seo_score": seo_score,
            "core_web_vitals": cwv,
            "issues": issues,
            "passed_checks": passed,
            "meta": meta,
        }

    async def _fetch_pagespeed(self, url: str) -> dict:
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(PAGESPEED_API, params={
                    "url": url, "strategy": "mobile",
                    "category": "PERFORMANCE",
                })
                if resp.status_code != 200:
                    logger.warning(f"[SEO] PageSpeed API returned {resp.status_code}")
                    return {}
                data = resp.json()

            lhr = data.get("lighthouseResult", {})
            cats = lhr.get("categories", {})
            perf = cats.get("performance", {})
            audits = lhr.get("audits", {})

            score = perf.get("score")
            if isinstance(score, (int, float)) and math.isfinite(score):
                ps_score = round(score * 100)
            else:
                ps_score = None

            def _metric(key: str) -> Optional[float]:
                a = audits.get(key, {})
                val = a.get("numericValue")
                if val is None or not isinstance(val, (int, float)):
                    return None
                if math.isnan(val) or math.isinf(val):
                    return None
                return round(val, 2)

            cwv = {
                "fcp": _metric("first-contentful-paint"),
                "lcp": _metric("largest-contentful-paint"),
                "cls": _metric("cumulative-layout-shift"),
                "tbt": _metric("total-blocking-time"),
                "si": _metric("speed-index"),
            }

            return {"performance_score": ps_score, "core_web_vitals": cwv}
        except Exception as e:
            logger.warning(f"[SEO] PageSpeed fetch failed: {e}")
            return {}

    async def _analyze_html(self, url: str) -> dict:
        try:
            result = await self.agentgo.scrape_url(url)
            if not result.get("success"):
                return {"meta": {}}

            page_data = result.get("data", {})
            markdown = page_data.get("markdown", "")
            title = page_data.get("title", "")
            links = page_data.get("links", [])

            # Use httpx to get raw HTML for meta analysis
            meta = await self._extract_meta_from_html(url)
            meta["title"] = meta.get("title") or title

            parsed = urlparse(url)
            internal = sum(1 for l in links if parsed.netloc in l.get("href", ""))
            external = len(links) - internal
            meta["internal_links"] = internal
            meta["external_links"] = external
            meta["has_ssl"] = url.startswith("https")

            return {"meta": meta}
        except Exception as e:
            logger.warning(f"[SEO] HTML analysis failed: {e}")
            return {"meta": {"has_ssl": url.startswith("https")}}

    async def _extract_meta_from_html(self, url: str) -> dict:
        try:
            async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
                resp = await client.get(url, headers={
                    "User-Agent": "Mozilla/5.0 (compatible; AI-CMO SEO Checker)"
                })
                html = resp.text[:100000]
        except Exception:
            return {}

        def _meta(attr: str, value: str) -> str:
            pattern = rf'<meta[^>]*{attr}=["\']?{re.escape(value)}["\']?[^>]*content=["\']([^"\']+)["\']'
            m = re.search(pattern, html, re.IGNORECASE)
            if m:
                return m.group(1)
            pattern2 = rf'<meta[^>]*content=["\']([^"\']+)["\'][^>]*{attr}=["\']?{re.escape(value)}["\']?'
            m2 = re.search(pattern2, html, re.IGNORECASE)
            return m2.group(1) if m2 else ""

        title_m = re.search(r'<title[^>]*>([^<]+)</title>', html, re.IGNORECASE)
        title = title_m.group(1).strip() if title_m else ""

        canonical_m = re.search(r'<link[^>]*rel=["\']canonical["\'][^>]*href=["\']([^"\']+)["\']', html, re.IGNORECASE)
        canonical = canonical_m.group(1) if canonical_m else ""

        h1_count = len(re.findall(r'<h1[\s>]', html, re.IGNORECASE))
        img_total = len(re.findall(r'<img[\s>]', html, re.IGNORECASE))
        img_with_alt = len(re.findall(r'<img[^>]+alt=["\'][^"\']+["\']', html, re.IGNORECASE))

        return {
            "title": title,
            "description": _meta("name", "description"),
            "robots": _meta("name", "robots") or None,
            "canonical": canonical,
            "og:title": _meta("property", "og:title"),
            "og:description": _meta("property", "og:description"),
            "og:image": _meta("property", "og:image"),
            "h1_count": h1_count,
            "img_total": img_total,
            "img_with_alt": img_with_alt,
        }


_seo_instance = None


def get_seo_service() -> SEOService:
    global _seo_instance
    if _seo_instance is None:
        _seo_instance = SEOService()
    return _seo_instance
