import asyncio
import hashlib
import json
import logging
import re
from typing import Optional, List, Dict
from urllib.parse import quote

import httpx
from playwright.async_api import async_playwright
from cachetools import TTLCache

from app.config import settings

logger = logging.getLogger(__name__)


class AgentGoService:
    """AgentGo scraping service using Playwright WebSocket — one connection per scrape"""

    def __init__(self):
        self._cache = TTLCache(maxsize=500, ttl=3600)

    async def _connect_and_scrape(self, url: str) -> dict:
        """Create a fresh browser connection, scrape one URL, close"""
        pw = await async_playwright().start()
        browser = None
        page = None
        try:
            options = {
                "_apikey": settings.agentgo_api_key,
                "_region": "us",
                "_disable_proxy": False,
            }
            # Derive WebSocket host from API URL (e.g. https://alpha.browsers.live -> alpha.browsers.live)
            api_host = settings.agentgo_api_url.replace("https://", "").replace("http://", "").rstrip("/")
            ws_url = f"wss://{api_host}?launch-options={quote(json.dumps(options))}"

            browser = await pw.chromium.connect(ws_url, timeout=25000)
            page = await browser.new_page()

            try:
                await page.goto(url, timeout=25000, wait_until="networkidle")
            except Exception:
                await page.goto(url, timeout=20000, wait_until="domcontentloaded")
                await page.wait_for_timeout(3000)

            # Extra wait for SPA rendering
            await page.wait_for_timeout(2000)

            title = await page.title()

            # Safe innerText extraction — document.body can be null on some pages
            content = await page.evaluate("""() => {
                if (!document.body) return '';
                return document.body.innerText || '';
            }""")

            # If content too short, try waiting longer (SPA may still be rendering)
            if len(content.strip()) < 100:
                logger.info(f"[AgentGo] Content too short ({len(content)} chars), waiting for SPA render...")
                await page.wait_for_timeout(3000)
                content = await page.evaluate("""() => {
                    if (!document.body) return '';
                    return document.body.innerText || '';
                }""")

            # Second SPA retry with longer wait for stubborn SPAs
            if len(content.strip()) < 100:
                await page.wait_for_timeout(5000)
                content = await page.evaluate("""() => {
                    if (!document.body) return '';
                    return document.body.innerText || '';
                }""")

            meta_desc = await page.evaluate("""() => {
                const m = document.querySelector('meta[name="description"]') || document.querySelector('meta[property="og:description"]');
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
                }
            }
        finally:
            if page:
                try: await page.close()
                except: pass
            if browser:
                try: await browser.close()
                except: pass
            try: await pw.stop()
            except: pass

    async def _httpx_fallback(self, url: str) -> dict:
        """HTTP fallback when Playwright fails. Extracts text, meta tags AND links from HTML."""
        try:
            logger.info(f"[Fallback] HTTP fetch: {url[:60]}")
            async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
                resp = await client.get(url, headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.5",
                })
                html = resp.text[:80000]

            def extract_meta(html: str, attr: str, value: str) -> str:
                pattern = f'<meta[^>]*{attr}=["\']?{re.escape(value)}["\']?[^>]*content=["\']([^"\']+)["\']'
                m = re.search(pattern, html, re.IGNORECASE)
                if m:
                    return m.group(1)
                pattern2 = f'<meta[^>]*content=["\']([^"\']+)["\'][^>]*{attr}=["\']?{re.escape(value)}["\']?'
                m2 = re.search(pattern2, html, re.IGNORECASE)
                return m2.group(1) if m2 else ""

            title_match = re.search(r'<title[^>]*>([^<]+)</title>', html, re.IGNORECASE)
            title = title_match.group(1).strip() if title_match else ""
            description = extract_meta(html, "name", "description")
            og_title = extract_meta(html, "property", "og:title")
            og_desc = extract_meta(html, "property", "og:description")
            keywords = extract_meta(html, "name", "keywords")

            # Extract links from HTML — critical for parsers to work
            links = []
            link_pattern = re.compile(r'<a[^>]+href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', re.DOTALL | re.IGNORECASE)
            for m in link_pattern.finditer(html):
                href = m.group(1).strip()
                link_text = re.sub(r'<[^>]+>', '', m.group(2)).strip()[:200]
                if href.startswith('http') and link_text:
                    links.append({"href": href, "text": link_text})
                if len(links) >= 100:
                    break

            # Strip HTML tags for a rough text extraction
            text = re.sub(r'<script[^>]*>.*?</script>', '', html, flags=re.DOTALL | re.IGNORECASE)
            text = re.sub(r'<style[^>]*>.*?</style>', '', text, flags=re.DOTALL | re.IGNORECASE)
            text = re.sub(r'<[^>]+>', ' ', text)
            text = re.sub(r'\s+', ' ', text).strip()[:5000]

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
                }
            }
        except Exception as e:
            logger.warning(f"[Fallback] Failed: {url[:60]} - {e}")
            return {"error": str(e), "url": url}

    async def scrape_url(self, url: str) -> dict:
        """Scrape a single URL with caching. AgentGo first, httpx fallback."""
        if url and not url.startswith(("http://", "https://")):
            url = f"https://{url}"
        cache_key = hashlib.md5(url.encode()).hexdigest()
        if cache_key in self._cache:
            logger.info(f"[AgentGo] Cache hit: {url[:60]}")
            return self._cache[cache_key]

        try:
            logger.info(f"[AgentGo] Scraping: {url[:80]}")
            result = await self._connect_and_scrape(url)
            md_len = len(result.get("data", {}).get("markdown", ""))
            link_count = len(result.get("data", {}).get("links", []))
            logger.info(f"[AgentGo] OK: {url[:60]} ({md_len} chars, {link_count} links)")

            if md_len < 50:
                logger.info(f"[AgentGo] Content too short, trying httpx fallback...")
                fallback = await self._httpx_fallback(url)
                if fallback.get("success"):
                    result = fallback
            elif link_count == 0 and md_len < 200:
                # Playwright got minimal content with no links — supplement with httpx
                logger.info(f"[AgentGo] Few links, supplementing with httpx fallback...")
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
            logger.warning(f"[AgentGo] Failed: {url[:60]} - {type(e).__name__}: {e}")
            result = await self._httpx_fallback(url)
            if result.get("success"):
                self._cache[cache_key] = result
            return result

    async def scrape_batch(self, urls: list, concurrency: int = 2) -> List[Dict]:
        """Batch scrape — limit to 2 concurrent to avoid AgentGo overload"""
        sem = asyncio.Semaphore(concurrency)

        async def _scrape(url: str):
            async with sem:
                try:
                    return await asyncio.wait_for(self.scrape_url(url), timeout=35)
                except asyncio.TimeoutError:
                    logger.warning(f"[AgentGo] Timeout: {url[:60]}")
                    return {"error": "timeout", "url": url}
                except Exception as e:
                    return {"error": str(e), "url": url}

        tasks = [asyncio.create_task(_scrape(url)) for url in urls]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        return [r if not isinstance(r, Exception) else {"error": str(r)} for r in results]

    async def close(self):
        pass  # No persistent state to clean up


_agentgo_instance = None


def get_agentgo_service() -> AgentGoService:
    global _agentgo_instance
    if _agentgo_instance is None:
        _agentgo_instance = AgentGoService()
    return _agentgo_instance
