"""
6-Node AI Agent Workflow Engine with optimized parallel execution
"""
import re
import asyncio
import logging
import json
from typing import AsyncGenerator, Callable, Optional, List, Dict

from app.services.llm import LLMService, get_llm_service
from app.services.agentgo import AgentGoService, get_agentgo_service
from app.utils.sse import SSEEvent
from app.utils.parsers import parse_platform, parse_google_site_results as _parse_google_site_results
from app.prompts.node1_product_analysis import (
    build_product_and_search_prompt,
    build_url_pre_analysis_prompt,
    build_profile_refinement_prompt,
)
from app.prompts.node4_scoring import build_scoring_prompt
from app.prompts.node5_deep_analysis import build_deep_analysis_prompt
from app.prompts.node6_strategy import build_strategy_prompt, build_strategy_supplement_prompt

logger = logging.getLogger(__name__)


class AnalysisWorkflow:
    """Six-node analysis workflow engine with SSE streaming"""

    def __init__(self):
        self.llm: LLMService = get_llm_service()
        self.agentgo: AgentGoService = get_agentgo_service()

    def _is_cancelled(self) -> bool:
        if not self._conv_id:
            return False
        try:
            from app.database import get_database, Conversation
            db = get_database()
            s = db.get_session()
            try:
                conv = s.query(Conversation).filter(Conversation.id == self._conv_id).first()
                return conv and conv.status == "cancelled"
            finally:
                s.close()
        except Exception:
            return False

    async def run(self, user_input: str, user_id: int, response_language: str = "en", brand_voice: str = "", conv_id: str = "") -> AsyncGenerator[SSEEvent, None]:
        self._conv_id = conv_id
        self._google_fallback_used: set = set()
        self._lang = response_language
        lang_names = {
            "en": "English", "zh": "Chinese (Simplified)", "ja": "Japanese",
            "ko": "Korean", "es": "Spanish", "fr": "French", "de": "German",
            "pt": "Portuguese", "ru": "Russian", "ar": "Arabic",
        }
        self._lang_name = lang_names.get(response_language, "English")
        self._lang_instruction = f"\n\nIMPORTANT: You MUST write all analysis text, recommendations, reasons, comments, and strategies in {self._lang_name}. However, search URLs and search keywords inside URLs must ALWAYS remain in English."
        self._brand_voice = brand_voice.strip() if brand_voice else ""
        try:
            # ====== Node 1+2: Product Analysis + Search Strategy ======
            yield SSEEvent("status", {"step": 1, "message": "🔍 正在分析您的产品..."})

            # Smart URL detection
            inp = user_input.strip()
            looks_like_url = bool(re.match(r'https?://', inp))
            if not looks_like_url and re.match(r'^[a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}', inp) and ' ' not in inp:
                looks_like_url = True

            if looks_like_url:
                display_url = inp if inp.startswith('http') else f"https://{inp}"
                yield SSEEvent("detail", {"message": f"🌐 正在访问 {display_url[:60]}..."})
                yield SSEEvent("detail", {"message": "📄 正在抓取页面内容..."})
            else:
                yield SSEEvent("detail", {"message": f"📝 正在分析关键词: {user_input}"})

            yield SSEEvent("detail", {"message": "🤖 AI 正在构建产品画像..."})

            profile, search_tasks, scraped_title, scraped_content = await self._optimized_node1_node2(user_input)

            product_name = profile.get('product_name', user_input)
            product_type = profile.get('product_type', 'Unknown')
            keywords = profile.get('keywords', [])

            # Send product info event (website content summary for URL inputs)
            if scraped_title or scraped_content:
                yield SSEEvent("product_info", {
                    "title": scraped_title,
                    "content": scraped_content[:500],
                    "product_name": product_name,
                    "product_type": product_type,
                    "description": profile.get("core_value_proposition", ""),
                    "target_audience": profile.get("target_audience", []),
                })

            yield SSEEvent("thinking", {
                "content": f"✅ 已识别产品: {product_name} ({product_type})"
            })
            if keywords:
                yield SSEEvent("detail", {"message": f"🔑 核心关键词: {', '.join(keywords[:5])}"})

            competitors = profile.get('competitor_hints', [])
            if competitors:
                yield SSEEvent("detail", {"message": f"🏷️ 相关竞品: {', '.join(competitors[:3])}"})

            if self._is_cancelled():
                logger.info(f"[Workflow] Cancelled before scraping")
                return

            # ====== Node 2 output ======
            yield SSEEvent("status", {"step": 2, "message": f"📡 已生成搜索策略，将搜索 {len(search_tasks)} 个平台"})

            # Show what platforms we'll search
            platforms_info = []
            for t in search_tasks:
                p = t.get("platform", "unknown")
                n = len(t.get("search_urls", []))
                prio = t.get("priority", "medium")
                emoji = "🔴" if prio == "high" else "🟡" if prio == "medium" else "🟢"
                platforms_info.append(f"{emoji} {p} ({n} queries)")
            yield SSEEvent("detail", {"message": f"🎯 搜索计划: {' · '.join(platforms_info)}"})

            for t in search_tasks:
                for url in t.get("search_urls", [])[:2]:  # Show first 2 URLs per platform
                    short_url = url[:80] + "..." if len(url) > 80 else url
                    yield SSEEvent("detail", {"message": f"🔗 {t['platform']}: {short_url}"})

            # ====== Node 3: Distributed Scraping ======
            yield SSEEvent("status", {"step": 3, "message": "🌐 正在全网搜索..."})

            all_results = []
            platform_counts = {}

            async for event in self._optimized_node3(search_tasks):
                if event.event == "platform_done":
                    platform_counts[event.data["platform"]] = event.data["count"]
                    yield event
                elif event.event == "scrape_results":
                    all_results.extend(event.data)
                elif event.event == "detail":
                    yield event  # Pass through detail events

            total_found = len(all_results)
            yield SSEEvent("thinking", {
                "content": f"📊 共找到 {total_found} 条相关内容，来自 {len(platform_counts)} 个平台"
            })

            if total_found == 0:
                yield SSEEvent("error", {"message": f"未在社交平台上找到与 \"{product_name}\" 相关的内容。建议：1) 尝试使用更知名的产品名或关键词 2) 确认网站可正常访问 3) 该产品可能在社交平台上讨论较少"})
                yield SSEEvent("done", {"total_found": 0})
                return

            if self._is_cancelled():
                logger.info(f"[Workflow] Cancelled before scoring")
                return

            # ====== Node 4+5+6: Scoring + Deep Analysis + Strategy ======
            yield SSEEvent("status", {"step": 4, "message": f"🧮 正在评估 {total_found} 条内容的推广价值..."})
            yield SSEEvent("detail", {"message": "📊 正在进行多维度评分: 互动量 · 时效性 · 相关性 · 推广潜力 · 受众匹配"})

            batch_count = max(1, (total_found + 14) // 15)
            yield SSEEvent("detail", {"message": f"⚡ 分 {batch_count} 批并行评分中..."})

            recommendations, strategy, extra_recs = await self._optimized_node4_5_6(
                all_results, profile,
                progress_callback=lambda msg: None
            )

            yield SSEEvent("status", {"step": 5, "message": "💎 推荐结果已生成"})
            yield SSEEvent("detail", {"message": f"🏆 从 {total_found} 条内容中筛选出 Top {len(recommendations)} 推荐"})
            yield SSEEvent("detail", {"message": "📝 正在为每条推荐生成个性化话术..."})

            for i, rec in enumerate(recommendations):
                rec["rank"] = i + 1
                rec["is_premium_only"] = i >= 3
                yield SSEEvent("result", rec)

            for i, rec in enumerate(extra_recs[:20]):
                rec["rank"] = len(recommendations) + i + 1
                rec["is_premium_only"] = True
                rec["is_extra"] = True
                yield SSEEvent("result", rec)

            # Yield strategy
            yield SSEEvent("status", {"step": 6, "message": "📋 运营策略已生成"})
            yield SSEEvent("detail", {"message": "📅 正在生成每周推广节奏和 KPI 目标..."})
            yield SSEEvent("strategy", strategy)

            platform_cpc = {
                "reddit": 0.05, "youtube": 0.02, "twitter": 0.03,
                "quora": 0.04, "producthunt": 0.06, "hackernews": 0.05,
            }
            ad_value = 0.0
            for rec in recommendations:
                stats = rec.get("engagement_stats") or {}
                views = stats.get("views") or (stats.get("upvotes", 0) or 0) * 15
                cpc = platform_cpc.get(rec.get("platform", "").lower(), 0.03)
                ad_value += views * cpc
            ad_value = round(ad_value, 2)

            yield SSEEvent("done", {
                "total_found": total_found,
                "platforms_searched": len(platform_counts),
                "recommendations_count": len(recommendations),
                "estimated_ad_value": ad_value,
            })

        except Exception as e:
            logger.exception(f"Workflow error: {e}")
            yield SSEEvent("error", {"message": f"分析过程出错: {str(e)}"})
            yield SSEEvent("done", {"total_found": 0, "error": True})

    # ======================== Helpers ========================

    def _inject_lang(self, messages: list) -> list:
        """Inject language instruction into the system prompt of any LLM messages"""
        if not hasattr(self, '_lang_instruction'):
            return messages
        msgs = [dict(m) for m in messages]  # shallow copy
        if msgs and msgs[0].get("role") == "system":
            msgs[0]["content"] = msgs[0]["content"] + self._lang_instruction
        return msgs

    # ======================== Node 1+2: Combined ========================

    async def _optimized_node1_node2(self, user_input: str) -> tuple:
        """Returns (profile, search_tasks, scraped_content)"""
        inp = user_input.strip()

        is_url = bool(re.match(r'https?://', inp))
        if not is_url and re.match(r'^[a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}', inp) and ' ' not in inp:
            inp = f"https://{inp}"
            is_url = True
            logger.info(f"[Workflow] Auto-prepended https:// → {inp}")

        scraped_content = ""
        scraped_title = ""

        if is_url:
            scrape_task = asyncio.create_task(self.agentgo.scrape_url(inp))
            pre_task = asyncio.create_task(
                self.llm.chat_json(build_url_pre_analysis_prompt(inp))
            )
            scraped, pre_profile = await asyncio.gather(scrape_task, pre_task, return_exceptions=True)

            if not isinstance(scraped, Exception) and "error" not in scraped:
                scraped_content = scraped.get("data", {}).get("markdown", "") or scraped.get("markdown", "")
                scraped_title = scraped.get("data", {}).get("title", "") or ""
                logger.info(f"[Workflow] Scraped content length: {len(scraped_content)} chars, title: {scraped_title}")

            # Do NOT inject language instruction for product analysis + search URL generation
            # Search URLs must always use English keywords
            combined = await self.llm.chat_json(
                build_product_and_search_prompt(inp, scraped_content)
            )
        else:
            combined = await self.llm.chat_json(
                build_product_and_search_prompt(inp)
            )

        profile = combined.get("profile", {})
        search_tasks = combined.get("search_tasks", [])

        if not search_tasks:
            search_tasks = self._fallback_search_tasks(inp, profile)

        search_tasks = self._ensure_time_filters(search_tasks)

        return profile, search_tasks, scraped_title, scraped_content

    @staticmethod
    def _ensure_time_filters(tasks: list) -> list:
        """Ensure all search URLs have time/recency filters. LLM sometimes forgets."""
        time_params = {
            "reddit": ("&t=", "&t=year"),
            "youtube": ("sp=", "&sp=EgIIBQ%3D%3D"),
            "hackernews": ("dateRange=", "&dateRange=pastYear"),
        }
        for task in tasks:
            platform = task.get("platform", "")
            if platform not in time_params:
                continue
            check, append = time_params[platform]
            urls = task.get("search_urls", [])
            task["search_urls"] = [
                url if check in url else url + append
                for url in urls
            ]
        return tasks

    def _fallback_search_tasks(self, user_input: str, profile: dict) -> list:
        keywords = profile.get("keywords", [user_input])
        query = "+".join(keywords[:3])
        return [
            {"platform": "reddit", "search_urls": [f"https://www.reddit.com/search/?q={query}&sort=relevance&t=year"], "priority": "high"},
            {"platform": "youtube", "search_urls": [f"https://www.youtube.com/results?search_query={query}&sp=EgIIBQ%3D%3D"], "priority": "high"},
            {"platform": "hackernews", "search_urls": [f"https://hn.algolia.com/?q={query}&dateRange=pastYear"], "priority": "medium"},
        ]

    # Platforms that are blocked by Cloudflare or require JS auth
    _BLOCKED_PLATFORMS = {"twitter", "quora", "producthunt"}

    @staticmethod
    def _is_blocked_response(text: str) -> bool:
        """Detect Cloudflare challenge pages or JS-required pages"""
        markers = [
            "Performing security verification",
            "JavaScript is not available",
            "Enable JavaScript",
            "Cloudflare Ray ID",
            "challenge-platform",
        ]
        return any(m.lower() in text.lower() for m in markers)

    @staticmethod
    def _build_google_site_url(platform: str, original_url: str) -> str:
        """Build a Google site: search URL as fallback for blocked platforms"""
        from urllib.parse import urlparse, parse_qs, quote_plus
        parsed = urlparse(original_url)
        q = parse_qs(parsed.query).get("q", [""])[0]
        if not q:
            path_parts = parsed.path.strip("/").split("/")
            q = " ".join(path_parts[-2:]) if len(path_parts) >= 2 else parsed.path
        site_map = {
            "twitter": "site:x.com OR site:twitter.com",
            "quora": "site:quora.com",
            "producthunt": "site:producthunt.com",
        }
        site = site_map.get(platform, f"site:{parsed.netloc}")
        return f"https://www.google.com/search?q={quote_plus(q + ' ' + site)}&num=20&tbs=qdr:y"

    # ======================== Node 3: Distributed Scraping ========================

    async def _optimized_node3(self, search_tasks: list) -> AsyncGenerator[SSEEvent, None]:
        high_tasks = [t for t in search_tasks if t.get("priority") == "high"]
        medium_tasks = [t for t in search_tasks if t.get("priority") == "medium"]
        low_tasks = [t for t in search_tasks if t.get("priority") == "low"]

        sem = asyncio.Semaphore(2)  # AgentGo: 2 concurrent connections max
        all_results = []

        async def scrape_platform_urls(task: dict):
            platform = task["platform"]
            urls = task.get("search_urls", [])
            platform_results = []
            tried_google = False

            for url in urls:
                async with sem:
                    try:
                        result = await asyncio.wait_for(
                            self.agentgo.scrape_url(url), timeout=25
                        )
                        text = result.get("data", {}).get("markdown", "")

                        if self._is_blocked_response(text) and not tried_google:
                            tried_google = True
                            if platform not in self._google_fallback_used:
                                self._google_fallback_used.add(platform)
                                google_url = self._build_google_site_url(platform, url)
                                logger.info(f"[Workflow] {platform} blocked, trying Google: {google_url[:80]}")
                                result = await asyncio.wait_for(
                                    self.agentgo.scrape_url(google_url), timeout=25
                                )
                                parsed = _parse_google_site_results(platform, result)
                                platform_results.extend(parsed)
                            else:
                                logger.info(f"[Workflow] {platform} blocked, Google fallback already used for this platform — skipping")
                            continue

                        parsed = parse_platform(platform, result)
                        platform_results.extend(parsed)
                    except (asyncio.TimeoutError, Exception) as e:
                        logger.warning(f"Scrape failed: {platform} {url[:50]} - {e}")

            # Last-resort Google fallback for platforms with 0 results
            if not platform_results and not tried_google and platform in self._BLOCKED_PLATFORMS and urls:
                if platform not in self._google_fallback_used:
                    self._google_fallback_used.add(platform)
                    try:
                        async with sem:
                            google_url = self._build_google_site_url(platform, urls[0])
                            logger.info(f"[Workflow] {platform} empty, trying Google: {google_url[:80]}")
                            result = await asyncio.wait_for(
                                self.agentgo.scrape_url(google_url), timeout=25
                            )
                            parsed = _parse_google_site_results(platform, result)
                            platform_results.extend(parsed)
                    except (asyncio.TimeoutError, Exception) as e:
                        logger.warning(f"Google fallback failed for {platform}: {e}")

            return platform, platform_results

        # Process high priority first
        if high_tasks:
            # Emit detail for each platform being scraped
            for t in high_tasks:
                yield SSEEvent("detail", {"message": f"🔍 正在搜索 {t['platform']}..."})

            high_coros = [scrape_platform_urls(t) for t in high_tasks]
            for coro in asyncio.as_completed(high_coros):
                try:
                    platform, results = await coro
                    all_results.extend(results)
                    count = len(results)
                    emoji = "✅" if count > 0 else "⚠️"
                    yield SSEEvent("platform_done", {"platform": platform, "count": count})
                    yield SSEEvent("detail", {"message": f"{emoji} {platform}: 找到 {count} 条相关内容"})
                except Exception as e:
                    logger.warning(f"High priority scrape error: {e}")

        # Process medium+low in parallel
        remaining = medium_tasks + low_tasks
        if remaining:
            for t in remaining:
                yield SSEEvent("detail", {"message": f"🔍 正在搜索 {t['platform']}..."})

            rem_coros = [scrape_platform_urls(t) for t in remaining]
            for coro in asyncio.as_completed(rem_coros):
                try:
                    platform, results = await coro
                    all_results.extend(results)
                    count = len(results)
                    emoji = "✅" if count > 0 else "⚠️"
                    yield SSEEvent("platform_done", {"platform": platform, "count": count})
                    yield SSEEvent("detail", {"message": f"{emoji} {platform}: 找到 {count} 条相关内容"})
                except Exception as e:
                    logger.warning(f"Remaining scrape error: {e}")

        yield SSEEvent("scrape_results", all_results)

    # ======================== Node 4+5+6: Combined Pipeline ========================

    async def _optimized_node4_5_6(self, raw_results: list, profile: dict,
                                     progress_callback=None) -> tuple:
        # ---- Node 4: Batch scoring ----
        BATCH_SIZE = 15
        items_for_scoring = []
        for i, r in enumerate(raw_results):
            items_for_scoring.append({
                "index": i, "title": r.get("title", ""), "url": r.get("url", ""),
                "platform": r.get("platform", ""),
                "content_snippet": r.get("content_snippet", "")[:300],
                "engagement_stats": r.get("engagement_stats", {}),
            })

        batches = [items_for_scoring[i:i+BATCH_SIZE]
                    for i in range(0, len(items_for_scoring), BATCH_SIZE)]

        scoring_tasks = [
            asyncio.create_task(self.llm.chat_json(self._inject_lang(build_scoring_prompt(batch, profile))))
            for batch in batches
        ]

        all_scored = []

        for coro in asyncio.as_completed(scoring_tasks):
            try:
                batch_result = await coro
                scored_items = batch_result.get("scored_items", [])
                for scored in scored_items:
                    idx = scored.get("index", 0)
                    raw_score = scored.get("composite_score", 0)
                    try:
                        score = float(raw_score)
                    except (TypeError, ValueError):
                        score = 0.0
                    if idx < len(raw_results):
                        original = raw_results[idx]
                        merged = {**original, **scored}
                        # Restore original fields that LLM must not alter
                        merged["url"] = original.get("url", "")
                        merged["platform"] = original.get("platform", "")
                        merged["title"] = original.get("title", merged.get("title", ""))
                        merged["composite_score"] = score
                        merged["scoring_detail"] = scored.get("scores", {})
                        all_scored.append(merged)
            except Exception as e:
                logger.warning(f"Scoring batch error: {e}")

        # Sort by score descending, then dedup and diversify platforms
        all_scored.sort(key=lambda x: float(x.get("composite_score", 0)), reverse=True)

        # Dedup: remove same base URL (strip query params & timestamps)
        import urllib.parse
        seen_urls = set()
        deduped = []
        for item in all_scored:
            url = item.get("url", "")
            # Normalize URL: strip fragment, strip common YouTube timestamp params
            parsed = urllib.parse.urlparse(url)
            base_url = f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
            # For YouTube, use video ID as key
            if "youtube.com/watch" in url:
                qs = urllib.parse.parse_qs(parsed.query)
                vid = qs.get("v", [""])[0]
                base_url = f"youtube:{vid}" if vid else base_url
            if base_url not in seen_urls:
                seen_urls.add(base_url)
                deduped.append(item)

        # Diversify: pick from different platforms round-robin style
        from collections import defaultdict
        by_platform = defaultdict(list)
        for item in deduped:
            by_platform[item.get("platform", "unknown")].append(item)

        top_10 = []
        platform_order = sorted(by_platform.keys(), key=lambda p: len(by_platform[p]), reverse=True)
        idx_per_platform = {p: 0 for p in platform_order}

        # Round-robin: pick one from each platform in order, repeat until 10
        while len(top_10) < 10:
            added = False
            for p in platform_order:
                if idx_per_platform[p] < len(by_platform[p]) and len(top_10) < 10:
                    top_10.append(by_platform[p][idx_per_platform[p]])
                    idx_per_platform[p] += 1
                    added = True
            if not added:
                break

        if not top_10:
            top_10 = raw_results[:10]

        # ---- Node 5+6: Deep analysis + Strategy ----
        batch1 = top_10[:5]
        batch2 = top_10[5:10] if len(top_10) > 5 else []

        deep_task1 = asyncio.create_task(
            self.llm.chat_json(self._inject_lang(build_deep_analysis_prompt(batch1, profile)))
        )
        deep_task2 = None
        if batch2:
            deep_task2 = asyncio.create_task(
                self.llm.chat_json(self._inject_lang(build_deep_analysis_prompt(batch2, profile)))
            )

        deep_result1 = await deep_task1
        recs_batch1 = deep_result1.get("recommendations", batch1)

        strategy_task = asyncio.create_task(
            self.llm.chat_json(self._inject_lang(build_strategy_prompt(recs_batch1, profile, self._brand_voice)))
        )

        recs_batch2 = []
        if deep_task2:
            deep_result2, strategy_result = await asyncio.gather(
                deep_task2, strategy_task, return_exceptions=True
            )
            if not isinstance(deep_result2, Exception):
                recs_batch2 = deep_result2.get("recommendations", batch2)
            if isinstance(strategy_result, Exception):
                strategy_result = {"comment_scripts": [], "overall_strategy": {}}
        else:
            strategy_result = await strategy_task

        all_recs = recs_batch1 + recs_batch2

        # Force-restore original data from top_10 to prevent LLM fabrication/loss
        for i, rec in enumerate(all_recs):
            if i < len(top_10):
                original = top_10[i]
                rec["url"] = original.get("url", rec.get("url", ""))
                rec["platform"] = original.get("platform", rec.get("platform", ""))
                if original.get("title"):
                    rec["title"] = original["title"]
                # Restore scores and engagement from Node 4 (LLM deep analysis doesn't have these)
                if original.get("composite_score"):
                    rec["composite_score"] = original["composite_score"]
                if original.get("scoring_detail"):
                    rec["scoring_detail"] = original["scoring_detail"]
                # Merge engagement: keep originals, LLM can only add missing fields
                orig_eng = original.get("engagement_stats") or {}
                rec_eng = rec.get("engagement_stats") or {}
                merged_eng = {**rec_eng, **{k: v for k, v in orig_eng.items() if v}}
                if merged_eng:
                    rec["engagement_stats"] = merged_eng

        if isinstance(strategy_result, dict):
            scripts = strategy_result.get("comment_scripts", [])
            for rec in all_recs:
                for script in scripts:
                    if script.get("rank") == rec.get("rank") or \
                       script.get("platform") == rec.get("platform"):
                        rec["suggested_comment"] = script.get("suggested_comment", "")
                        rec["comment_strategy"] = script.get("comment_strategy", "")
                        break
            overall_strategy = strategy_result.get("overall_strategy", {})
        else:
            overall_strategy = {}

        top_urls = {r.get("url") for r in top_10}
        extra_recs = [r for r in deduped if r.get("url") not in top_urls]

        return all_recs, overall_strategy, extra_recs
