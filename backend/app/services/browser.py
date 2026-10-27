"""Playwright 浏览器抓取（从旧版 browser_service.py 迁移，逻辑暂未改动）。

注意：本模块尚未接入 SSRF 防护，计划 05 加固前不得用于用户提供的网址。
仅在 worker 镜像中可用（api 镜像不安装 playwright）。
"""

import asyncio
import hashlib
import logging
import re
from pathlib import Path

import httpx
from cachetools import TTLCache
from playwright.async_api import BrowserContext, async_playwright

from app.core.config import get_settings

logger = logging.getLogger(__name__)

_DEFAULT_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

_MAX_CONCURRENT_PAGES = 12
_IDLE_CLOSE_DELAY = 3  # seconds after last page closes


class BrowserService:
    """Local Playwright browser — auto-closes when idle."""

    def __init__(self):
        self._cache = TTLCache(maxsize=500, ttl=3600)
        self._pw = None
        self._context: BrowserContext | None = None
        self._ctx_lock = asyncio.Lock()
        self._page_sem = asyncio.Semaphore(_MAX_CONCURRENT_PAGES)
        self._alive = False
        self._active_pages = 0
        self._close_timer: asyncio.TimerHandle | None = None

    # ── lifecycle ─────────────────────────────────────────────

    async def _ensure_context(self) -> BrowserContext:
        if self._alive and self._context:
            return self._context

        async with self._ctx_lock:
            if self._alive and self._context:
                return self._context

            await self._teardown_inner()

            self._pw = await async_playwright().start()

            settings = get_settings()
            profile_dir = Path(settings.browser_profile_dir)
            profile_dir.mkdir(parents=True, exist_ok=True)

            proxy = None
            if settings.browser_proxy:
                proxy = {"server": settings.browser_proxy}

            self._context = await self._pw.chromium.launch_persistent_context(
                user_data_dir=str(profile_dir),
                headless=settings.browser_headless,
                user_agent=_DEFAULT_UA,
                viewport={"width": 1920, "height": 1080},
                locale="en-US",
                timezone_id="America/New_York",
                proxy=proxy,
                args=[
                    "--disable-blink-features=AutomationControlled",
                    "--disable-features=IsolateOrigins,site-per-process",
                    "--no-sandbox",
                ],
                ignore_default_args=["--enable-automation"],
                java_script_enabled=True,
                bypass_csp=True,
            )
            self._alive = True
            logger.info("[Browser] Chromium launched")
            return self._context

    async def _teardown_inner(self):
        self._alive = False
        if self._context:
            try:
                await self._context.close()
            except Exception:
                pass
            self._context = None
        if self._pw:
            try:
                await self._pw.stop()
            except Exception:
                pass
            self._pw = None

    def _cancel_close_timer(self):
        if self._close_timer:
            self._close_timer.cancel()
            self._close_timer = None

    def _schedule_close(self):
        """Schedule browser shutdown after idle delay."""
        self._cancel_close_timer()
        loop = asyncio.get_event_loop()
        self._close_timer = loop.call_later(_IDLE_CLOSE_DELAY, lambda: asyncio.ensure_future(self._idle_close()))

    async def _idle_close(self):
        if self._active_pages > 0:
            return
        async with self._ctx_lock:
            if self._active_pages > 0:
                return
            if not self._alive:
                return
            logger.info("[Browser] Idle — closing Chromium")
            await self._teardown_inner()

    def _page_opened(self):
        self._cancel_close_timer()
        self._active_pages += 1

    def _page_closed(self):
        self._active_pages = max(0, self._active_pages - 1)
        if self._active_pages == 0:
            self._schedule_close()

    # ── scraping ──────────────────────────────────────────────

    async def _scrape_page(self, url: str) -> dict:
        async with self._page_sem:
            ctx = await self._ensure_context()
            self._page_opened()
            page = await ctx.new_page()
            try:
                try:
                    await page.goto(url, timeout=25000, wait_until="networkidle")
                except Exception:
                    await page.goto(url, timeout=20000, wait_until="domcontentloaded")
                    await page.wait_for_timeout(3000)

                await page.wait_for_timeout(2000)

                title = await page.title()

                content = await page.evaluate("""() => {
                    if (!document.body) return '';
                    return document.body.innerText || '';
                }""")

                if len(content.strip()) < 100:
                    logger.info(f"[Browser] Content short ({len(content)} chars), waiting for SPA…")
                    await page.wait_for_timeout(3000)
                    content = await page.evaluate("""() => {
                        if (!document.body) return '';
                        return document.body.innerText || '';
                    }""")

                if len(content.strip()) < 100:
                    await page.wait_for_timeout(5000)
                    content = await page.evaluate("""() => {
                        if (!document.body) return '';
                        return document.body.innerText || '';
                    }""")

                meta_desc = await page.evaluate("""() => {
                    const m = document.querySelector('meta[name="description"]')
                           || document.querySelector('meta[property="og:description"]');
                    return m ? m.getAttribute('content') : '';
                }""")
                og_title = await page.evaluate("""() => {
                    const m = document.querySelector('meta[property="og:title"]');
                    return m ? m.getAttribute('content') : '';
                }""")

                links = await page.evaluate("""() => {
                    if (!document.body) return [];
                    return Array.from(document.querySelectorAll('a[href]')).map(a => ({
                        href: a.href,
                        text: (a.textContent || '').trim().substring(0, 200)
                    })).filter(l => l.href.startsWith('http')).slice(0, 100)
                }""")

                full_content = content[:8000]
                if meta_desc:
                    full_content = f"[Meta Description: {meta_desc}]\n\n{full_content}"
                if og_title and og_title != title:
                    full_content = f"[OG Title: {og_title}]\n{full_content}"

                return {
                    "success": True,
                    "data": {
                        "markdown": full_content,
                        "title": title or og_title or "",
                        "links": links,
                        "url": url,
                    },
                }
            finally:
                try:
                    await page.close()
                except Exception:
                    pass
                self._page_closed()

    async def _httpx_fallback(self, url: str) -> dict:
        """HTTP fallback when Playwright fails."""
        try:
            logger.info(f"[Fallback] HTTP fetch: {url[:60]}")
            async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
                resp = await client.get(
                    url,
                    headers={
                        "User-Agent": _DEFAULT_UA,
                        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                        "Accept-Language": "en-US,en;q=0.5",
                    },
                )
                html = resp.text[:80000]

            def extract_meta(html: str, attr: str, value: str) -> str:
                pattern = f"<meta[^>]*{attr}=[\"']?{re.escape(value)}[\"']?[^>]*content=[\"']([^\"']+)[\"']"
                m = re.search(pattern, html, re.IGNORECASE)
                if m:
                    return m.group(1)
                pattern2 = f"<meta[^>]*content=[\"']([^\"']+)[\"'][^>]*{attr}=[\"']?{re.escape(value)}[\"']?"
                m2 = re.search(pattern2, html, re.IGNORECASE)
                return m2.group(1) if m2 else ""

            title_match = re.search(r"<title[^>]*>([^<]+)</title>", html, re.IGNORECASE)
            title = title_match.group(1).strip() if title_match else ""
            description = extract_meta(html, "name", "description")
            og_title = extract_meta(html, "property", "og:title")
            og_desc = extract_meta(html, "property", "og:description")
            keywords = extract_meta(html, "name", "keywords")

            links = []
            link_pattern = re.compile(r'<a[^>]+href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', re.DOTALL | re.IGNORECASE)
            for m in link_pattern.finditer(html):
                href = m.group(1).strip()
                link_text = re.sub(r"<[^>]+>", "", m.group(2)).strip()[:200]
                if href.startswith("http") and link_text:
                    links.append({"href": href, "text": link_text})
                if len(links) >= 100:
                    break

            text = re.sub(r"<script[^>]*>.*?</script>", "", html, flags=re.DOTALL | re.IGNORECASE)
            text = re.sub(r"<style[^>]*>.*?</style>", "", text, flags=re.DOTALL | re.IGNORECASE)
            text = re.sub(r"<[^>]+>", " ", text)
            text = re.sub(r"\s+", " ", text).strip()[:5000]

            content_parts = []
            if og_title:
                content_parts.append(f"[Title: {og_title}]")
            elif title:
                content_parts.append(f"[Title: {title}]")
            if description:
                content_parts.append(f"[Description: {description}]")
            if og_desc and og_desc != description:
                content_parts.append(f"[OG Description: {og_desc}]")
            if keywords:
                content_parts.append(f"[Keywords: {keywords}]")
            content_parts.append(f"\n{text}")

            full_content = "\n".join(content_parts)
            logger.info(f"[Fallback] OK: {url[:60]} ({len(full_content)} chars, {len(links)} links)")

            return {
                "success": True,
                "data": {
                    "markdown": full_content,
                    "title": title or og_title or "",
                    "links": links,
                    "url": url,
                },
            }
        except Exception as e:
            logger.warning(f"[Fallback] Failed: {url[:60]} - {e}")
            return {"error": str(e), "url": url}

    async def scrape_url(self, url: str) -> dict:
        if url and not url.startswith(("http://", "https://")):
            url = f"https://{url}"
        cache_key = hashlib.md5(url.encode()).hexdigest()
        if cache_key in self._cache:
            logger.info(f"[Browser] Cache hit: {url[:60]}")
            return self._cache[cache_key]

        try:
            logger.info(f"[Browser] Scraping: {url[:80]}")
            result = await self._scrape_page(url)
            md_len = len(result.get("data", {}).get("markdown", ""))
            link_count = len(result.get("data", {}).get("links", []))
            logger.info(f"[Browser] OK: {url[:60]} ({md_len} chars, {link_count} links)")

            if md_len < 50:
                logger.info("[Browser] Content too short, trying httpx fallback…")
                fallback = await self._httpx_fallback(url)
                if fallback.get("success"):
                    result = fallback
            elif link_count == 0 and md_len < 200:
                logger.info("[Browser] Few links, supplementing with httpx fallback…")
                fallback = await self._httpx_fallback(url)
                if fallback.get("success"):
                    fb_links = fallback.get("data", {}).get("links", [])
                    fb_text = fallback.get("data", {}).get("markdown", "")
                    if fb_links:
                        result["data"]["links"] = fb_links
                    if len(fb_text) > md_len:
                        result["data"]["markdown"] = fb_text

            self._cache[cache_key] = result
            return result
        except Exception as e:
            logger.warning(f"[Browser] Failed: {url[:60]} - {type(e).__name__}: {e}")
            async with self._ctx_lock:
                await self._teardown_inner()
            result = await self._httpx_fallback(url)
            if result.get("success"):
                self._cache[cache_key] = result
            return result

    async def scrape_batch(self, urls: list, concurrency: int = 3) -> list[dict]:
        sem = asyncio.Semaphore(concurrency)

        async def _scrape(url: str):
            async with sem:
                try:
                    return await asyncio.wait_for(self.scrape_url(url), timeout=35)
                except TimeoutError:
                    logger.warning(f"[Browser] Timeout: {url[:60]}")
                    return {"error": "timeout", "url": url}
                except Exception as e:
                    return {"error": str(e), "url": url}

        tasks = [asyncio.create_task(_scrape(url)) for url in urls]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        return [r if not isinstance(r, Exception) else {"error": str(r)} for r in results]

    async def close(self):
        self._cancel_close_timer()
        async with self._ctx_lock:
            await self._teardown_inner()


_browser_instance = None


def get_browser_service() -> BrowserService:
    global _browser_instance
    if _browser_instance is None:
        _browser_instance = BrowserService()
    return _browser_instance
