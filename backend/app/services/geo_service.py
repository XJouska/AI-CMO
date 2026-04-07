"""
GEO (Generative Engine Optimization) Visibility Service
Uses AgentGo to check brand mentions across AI search platforms
and LLM to analyze mention quality.
"""
import asyncio
import logging
from typing import Dict, List, Optional
from urllib.parse import quote_plus, urlparse

from app.services.agentgo import AgentGoService, get_agentgo_service
from app.services.llm import LLMService, get_llm_service
from app.database import get_database

logger = logging.getLogger(__name__)

PLATFORMS = [
    {"name": "Perplexity", "url_template": "https://www.perplexity.ai/search?q={query}"},
    {"name": "Google AI Overview", "url_template": "https://www.google.com/search?q={query}"},
    {"name": "Bing Copilot", "url_template": "https://www.bing.com/search?q={query}"},
]

QUERY_TEMPLATES = [
    "best {keyword} tools 2026",
    "{brand} alternatives",
    "what is {brand}",
    "{keyword} recommendations",
]


def _extract_domain(url: str) -> str:
    if not url:
        return ""
    if not url.startswith(("http://", "https://")):
        url = f"https://{url}"
    parsed = urlparse(url)
    domain = parsed.netloc or parsed.path.split("/")[0]
    return domain.lower().removeprefix("www.")


class GEOService:
    def __init__(self):
        self.agentgo: AgentGoService = get_agentgo_service()
        self.llm: LLMService = get_llm_service()

    async def scan(self, brand_name: str, keywords: List[str], user_id: int, url: Optional[str] = None) -> dict:
        domain = _extract_domain(url) if url else ""
        queries = self._build_queries(brand_name, keywords)
        platform_results = []

        for platform in PLATFORMS:
            try:
                result = await self._scan_platform(platform, brand_name, domain, queries)
                platform_results.append(result)
            except Exception as e:
                logger.warning(f"[GEO] {platform['name']} scan failed: {e}")
                platform_results.append({
                    "platform": platform["name"],
                    "visibility_score": 0,
                    "status": "error",
                    "mentions": [],
                })

        db = get_database()
        for pr in platform_results:
            try:
                db.save_geo_visibility(
                    user_id=user_id, brand_name=brand_name,
                    platform=pr["platform"],
                    visibility_score=pr.get("visibility_score", 0),
                    mentions=pr.get("mentions", []),
                )
            except Exception as e:
                logger.warning(f"[GEO] Failed to save {pr['platform']}: {e}")

        overall = self._compute_overall(platform_results)
        db.add_activity(
            user_id, "geo_scan_completed",
            f"GEO scan completed for '{brand_name}' (Score: {overall})",
            {"brand_name": brand_name, "overall_score": overall, "url": url},
        )
        return {"brand_name": brand_name, "overall_score": overall, "platforms": platform_results}

    def _build_queries(self, brand_name: str, keywords: List[str]) -> List[str]:
        keyword = keywords[0] if keywords else brand_name
        return [t.format(brand=brand_name, keyword=keyword) for t in QUERY_TEMPLATES[:3]]

    async def _scan_platform(self, platform: dict, brand_name: str, domain: str, queries: List[str]) -> dict:
        mentions = []
        total_score = 0
        for query in queries[:2]:
            search_url = platform["url_template"].format(query=quote_plus(query))
            try:
                result = await self.agentgo.scrape_url(search_url)
                if not result.get("success"):
                    continue
                page_data = result.get("data", {})
                content = page_data.get("markdown", "")
                links = page_data.get("links", [])
                if not content:
                    continue

                link_found = False
                if domain:
                    link_found = any(domain in l.get("href", "").lower() for l in links)

                analysis = await self._analyze_mention(brand_name, domain, query, content, platform["name"])
                analysis["link_cited"] = link_found or analysis.get("link_cited", False)

                if link_found and not analysis.get("mentioned"):
                    analysis["mentioned"] = True
                    analysis["prominence"] = max(analysis.get("prominence", 0), 30)
                    analysis["context"] = analysis.get("context") or f"Website link found in results"

                mentions.append({
                    "query": query,
                    "mentioned": analysis.get("mentioned", False),
                    "context": analysis.get("context", ""),
                    "sentiment": analysis.get("sentiment", "neutral"),
                    "prominence": analysis.get("prominence", 0),
                    "link_cited": analysis.get("link_cited", False),
                })
                total_score += analysis.get("prominence", 0)
            except Exception as e:
                logger.warning(f"[GEO] Query '{query}' on {platform['name']} failed: {e}")

        n = min(len(queries), 2)
        avg_score = round(total_score / n) if n > 0 else 0
        any_mentioned = any(m.get("mentioned") for m in mentions)
        any_linked = any(m.get("link_cited") for m in mentions)
        status = "not_found"
        if any_mentioned and any_linked:
            status = "mentioned"
        elif any_mentioned:
            status = "partial"
        return {
            "platform": platform["name"],
            "visibility_score": avg_score,
            "status": status,
            "mentions": mentions,
        }

    async def _analyze_mention(self, brand_name: str, domain: str, query: str, content: str, platform: str) -> dict:
        snippet = content[:3000]
        brand_found = brand_name.lower() in snippet.lower()
        domain_found = domain and domain in snippet.lower()
        if not brand_found and not domain_found:
            return {"mentioned": False, "context": "", "sentiment": "neutral", "prominence": 0, "link_cited": False}
        try:
            domain_instruction = f'\nAlso check if the domain "{domain}" appears as a link or reference.' if domain else ""
            return await self.llm.chat_json([
                {"role": "system", "content": f'Analyze if and how a brand is mentioned in this AI search result.{domain_instruction}\nRespond in JSON:\n{{"mentioned": true/false, "context": "Brief quote showing the mention (max 120 chars)", "sentiment": "positive"|"neutral"|"negative", "prominence": 0-100, "link_cited": true/false}}'},
                {"role": "user", "content": f"Brand: {brand_name}\nDomain: {domain or 'N/A'}\nQuery: {query}\nPlatform: {platform}\n\nContent:\n{snippet}"}
            ])
        except Exception:
            return {"mentioned": True, "context": "", "sentiment": "neutral", "prominence": 40, "link_cited": domain_found}

    def _compute_overall(self, platform_results: List[dict]) -> int:
        scores = [p.get("visibility_score", 0) for p in platform_results]
        return round(sum(scores) / len(scores)) if scores else 0


_geo_instance = None

def get_geo_service() -> GEOService:
    global _geo_instance
    if _geo_instance is None:
        _geo_instance = GEOService()
    return _geo_instance
