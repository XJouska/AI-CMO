"""
Platform-specific parsers for extracting structured data from scraped content.
Designed to work with Playwright innerText + links array from local browser,
AND with httpx fallback HTML (text + extracted links).
"""
import re
import json
import logging
from typing import List, Dict
from urllib.parse import urlparse, parse_qs

logger = logging.getLogger(__name__)


def parse_platform(platform: str, scrape_result: dict) -> List[Dict]:
    """Route to platform-specific parser"""
    if "error" in scrape_result:
        return []

    data = scrape_result.get("data", {})
    text = data.get("markdown", "") or ""
    links = data.get("links", []) or []

    if not text and not links:
        return []

    parsers = {
        "reddit": parse_reddit,
        "youtube": parse_youtube,
        "twitter": parse_twitter,
        "quora": parse_quora,
        "producthunt": parse_producthunt,
        "hackernews": parse_hackernews,
    }

    parser = parsers.get(platform, parse_generic)
    try:
        results = parser(text, links)
        for r in results:
            r["platform"] = platform
        logger.info(f"[Parser] {platform}: {len(results)} items from {len(links)} links")
        return results
    except Exception as e:
        logger.warning(f"[Parser] {platform} error: {e}")
        return []


def parse_youtube(text: str, links: list) -> List[Dict]:
    """Parse YouTube search results from links or text fallback"""
    results = []
    seen_ids = set()

    # Strategy 1: Extract from links (works with both Playwright and httpx fallback)
    for link in links:
        href = link.get("href", "")
        link_text = link.get("text", "").strip().replace('\n', ' ')

        if "youtube.com/watch" not in href and "youtu.be/" not in href:
            continue

        vid = _extract_youtube_id(href)
        if not vid or vid in seen_ids:
            continue

        if re.match(r'^[\d:]+\s', link_text) or "Now playing" in link_text or len(link_text) < 5:
            continue
        if link_text.startswith("0:") or re.match(r'^\d+:\d+\s', link_text):
            continue

        seen_ids.add(vid)

        views = 0
        channel = ""
        time_ago = ""
        title_clean = link_text[:200]

        idx = text.find(title_clean[:30]) if len(title_clean) >= 30 else text.find(title_clean)
        if idx >= 0:
            window = text[idx:idx + 300]
            view_match = re.search(r'([\d,.]+[KkMm]?)\s*views?', window)
            if view_match:
                views = _parse_count(view_match.group(1))
            time_match = re.search(r'(\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago)', window)
            if time_match:
                time_ago = time_match.group(1)
            lines_after = window.split('\n')
            for l in lines_after[1:5]:
                l = l.strip()
                if l and len(l) < 40 and not re.match(r'^[\d,.]+', l) and 'views' not in l.lower() and 'ago' not in l.lower():
                    channel = l
                    break

        results.append({
            "title": title_clean,
            "url": f"https://www.youtube.com/watch?v={vid}",
            "content_snippet": f"By {channel}" if channel else "",
            "engagement_stats": {"views": views} if views else {},
            "author": channel,
            "time_ago": time_ago,
        })

    # Strategy 2: Extract video IDs from raw text/HTML via regex (catches httpx fallback)
    if len(results) < 3:
        vid_pattern = re.compile(r'(?:youtube\.com/watch\?v=|youtu\.be/)([\w-]{11})')
        for m in vid_pattern.finditer(text):
            vid = m.group(1)
            if vid in seen_ids:
                continue
            seen_ids.add(vid)
            results.append({
                "title": f"YouTube Video ({vid})",
                "url": f"https://www.youtube.com/watch?v={vid}",
                "content_snippet": "",
                "engagement_stats": {},
                "author": "",
                "time_ago": "",
            })
            if len(results) >= 20:
                break

    # Strategy 3: Try parsing YouTube's embedded JSON data (ytInitialData)
    if len(results) < 3:
        json_match = re.search(r'var\s+ytInitialData\s*=\s*(\{.+?\});\s*</script>', text, re.DOTALL)
        if json_match:
            try:
                yt_data = json.loads(json_match.group(1))
                _extract_yt_initial_data(yt_data, results, seen_ids)
            except (json.JSONDecodeError, KeyError):
                pass

    return results[:20]


def parse_reddit(text: str, links: list) -> List[Dict]:
    """Parse Reddit search results"""
    results = []
    seen_urls = set()

    # Extract from links with /comments/ (actual posts)
    for link in links:
        href = link.get("href", "")
        link_text = link.get("text", "").strip()

        if "/comments/" in href and "reddit.com" in href:
            # Clean up link text
            clean = link_text.replace('\n', ' ').strip()
            if not clean or len(clean) < 10:
                continue
            if clean.lower() in ("comments", "share", "save", "hide", "report"):
                continue

            vid = href.split("/comments/")[1].split("/")[0] if "/comments/" in href else href
            if vid in seen_urls:
                continue
            seen_urls.add(vid)

            results.append({
                "title": clean[:200],
                "url": href,
                "content_snippet": "",
                "engagement_stats": _find_engagement_near(text, clean),
            })

    # Also try text-based extraction for Reddit
    if len(results) < 5:
        # Reddit text has patterns like: "r/subreddit\n• Posted by u/user\nTitle\nUpvotes Comments"
        lines = text.split('\n')
        for i, line in enumerate(lines):
            line = line.strip()
            # Look for subreddit indicators
            if re.match(r'^r/\w+', line) and i + 2 < len(lines):
                # Next non-empty line is likely the title
                for j in range(i + 1, min(i + 4, len(lines))):
                    candidate = lines[j].strip()
                    if candidate and len(candidate) > 15 and not candidate.startswith('r/') and not candidate.startswith('•'):
                        if candidate not in [r["title"] for r in results]:
                            results.append({
                                "title": candidate[:200],
                                "url": "",
                                "content_snippet": f"r/{line.split('/')[1].split()[0] if '/' in line else ''}",
                                "engagement_stats": {},
                            })
                        break

    return results[:20]


def parse_twitter(text: str, links: list) -> List[Dict]:
    """Parse Twitter/X search results from links and text"""
    results = []
    seen_urls = set()

    # Strategy 1: From links
    for link in links:
        href = link.get("href", "")
        link_text = link.get("text", "").strip()
        if "/status/" in href and ("x.com" in href or "twitter.com" in href):
            if href not in seen_urls:
                seen_urls.add(href)
                results.append({
                    "title": link_text[:200] if link_text and len(link_text) > 5 else "Tweet",
                    "url": href,
                    "content_snippet": link_text[:500] if link_text else "",
                    "engagement_stats": {},
                })

    # Strategy 2: Extract status URLs from raw text (httpx fallback)
    if len(results) < 3:
        status_pattern = re.compile(r'https?://(?:x|twitter)\.com/(\w+)/status/(\d+)')
        for m in status_pattern.finditer(text):
            url = m.group(0)
            username = m.group(1)
            if url not in seen_urls:
                seen_urls.add(url)
                results.append({
                    "title": f"@{username} tweet",
                    "url": url,
                    "content_snippet": "",
                    "engagement_stats": {},
                })

    # Strategy 3: Text-based extraction — X.com often has text blocks with user content
    if len(results) < 3 and len(text) > 50:
        lines = text.split('\n')
        current_author = ""
        for line in lines:
            line = line.strip()
            if not line:
                continue
            # X.com user pattern: "@username"
            author_match = re.match(r'^@(\w{1,15})$', line)
            if author_match:
                current_author = line
                continue
            if current_author and len(line) > 30 and not line.startswith(('http', '@', '#')):
                results.append({
                    "title": f"{current_author}: {line[:100]}",
                    "url": "",
                    "content_snippet": line[:500],
                    "engagement_stats": {},
                })
                current_author = ""

    return results[:20]


def parse_quora(text: str, links: list) -> List[Dict]:
    """Parse Quora search results from links and text"""
    results = []
    seen = set()

    # Strategy 1: From links
    for link in links:
        href = link.get("href", "")
        link_text = link.get("text", "").strip()
        if "quora.com" in href and link_text and len(link_text) > 15:
            if link_text.lower() in ("quora", "sign in", "search", "log in", "continue"):
                continue
            if "/search?" in href or "/profile/" in href:
                continue
            if link_text not in seen:
                seen.add(link_text)
                results.append({
                    "title": link_text[:200],
                    "url": href,
                    "content_snippet": "",
                    "engagement_stats": {},
                })

    # Strategy 2: Extract Quora question URLs from text
    if len(results) < 3:
        q_pattern = re.compile(r'https?://(?:www\.)?quora\.com/([A-Z][^?\s"<>]{15,})')
        for m in q_pattern.finditer(text):
            url = m.group(0)
            slug = m.group(1).replace('-', ' ')
            if slug not in seen:
                seen.add(slug)
                results.append({
                    "title": slug[:200],
                    "url": url,
                    "content_snippet": "",
                    "engagement_stats": {},
                })

    # Strategy 3: Text-based — Quora text often has question-like lines
    if len(results) < 3:
        lines = text.split('\n')
        for line in lines:
            line = line.strip()
            if len(line) > 30 and ('?' in line or line.startswith(('What', 'How', 'Why', 'Which', 'Is ', 'Can '))):
                if line not in seen:
                    seen.add(line)
                    results.append({
                        "title": line[:200],
                        "url": "",
                        "content_snippet": "",
                        "engagement_stats": {},
                    })

    return results[:20]


def parse_producthunt(text: str, links: list) -> List[Dict]:
    """Parse ProductHunt search results from links and text"""
    results = []
    seen = set()

    # Strategy 1: From links — /posts/ or /products/ patterns
    for link in links:
        href = link.get("href", "")
        link_text = link.get("text", "").strip()
        if "producthunt.com" in href and link_text and len(link_text) > 5:
            if "/posts/" in href or "/products/" in href:
                if link_text not in seen:
                    seen.add(link_text)
                    results.append({
                        "title": link_text[:200], "url": href,
                        "content_snippet": "", "engagement_stats": {},
                    })

    # Strategy 2: Any meaningful PH links
    if not results:
        skip_texts = {"product hunt", "sign in", "topics", "search", "newsletter", "about"}
        for link in links:
            href = link.get("href", "")
            link_text = link.get("text", "").strip()
            if "producthunt.com" in href and link_text and len(link_text) > 10:
                if link_text.lower() not in skip_texts:
                    if link_text not in seen:
                        seen.add(link_text)
                        results.append({
                            "title": link_text[:200], "url": href,
                            "content_snippet": "", "engagement_stats": {},
                        })

    # Strategy 3: Extract PH URLs from text
    if len(results) < 3:
        ph_pattern = re.compile(r'https?://(?:www\.)?producthunt\.com/(?:posts|products)/([a-z0-9-]+)')
        for m in ph_pattern.finditer(text):
            url = m.group(0)
            slug = m.group(1).replace('-', ' ').title()
            if slug not in seen:
                seen.add(slug)
                results.append({
                    "title": slug[:200], "url": url,
                    "content_snippet": "", "engagement_stats": {},
                })

    # Strategy 4: Text-based extraction — PH pages have "Product Name - Description" patterns
    if len(results) < 3:
        lines = text.split('\n')
        for line in lines:
            line = line.strip()
            if ' - ' in line and 20 < len(line) < 200:
                parts = line.split(' - ', 1)
                name = parts[0].strip()
                desc = parts[1].strip() if len(parts) > 1 else ""
                if name and len(name) > 3 and name.lower() not in ("product hunt", "search"):
                    if name not in seen:
                        seen.add(name)
                        results.append({
                            "title": name[:200], "url": "",
                            "content_snippet": desc[:300], "engagement_stats": {},
                        })

    return results[:20]


def parse_hackernews(text: str, links: list) -> List[Dict]:
    """Parse HackerNews/Algolia search results"""
    results = []
    for link in links:
        href = link.get("href", "")
        link_text = link.get("text", "").strip()
        if link_text and len(link_text) > 10:
            if "ycombinator.com/item" in href:
                results.append({
                    "title": link_text[:200], "url": href,
                    "content_snippet": "", "engagement_stats": {},
                })
            elif "hn.algolia.com" not in href and href.startswith("http") and "algolia" not in href:
                results.append({
                    "title": link_text[:200], "url": href,
                    "content_snippet": "", "engagement_stats": {},
                })
    return results[:20]


def parse_generic(text: str, links: list) -> List[Dict]:
    """Generic parser"""
    results = []
    for link in links:
        href = link.get("href", "")
        link_text = link.get("text", "").strip()
        if href.startswith("http") and link_text and len(link_text) > 10:
            results.append({
                "title": link_text[:200], "url": href,
                "content_snippet": "", "engagement_stats": {},
            })
    return results[:20]


def parse_google_site_results(platform: str, scrape_result: dict) -> List[Dict]:
    """Parse Google search results scoped to a specific site.
    Extracts titles, URLs, AND content snippets from Google's result text.

    Google result text pattern (per result):
        Title line\n\nX · username\nfollower_count\nDescription text...Read more
    """
    if "error" in scrape_result:
        return []

    data = scrape_result.get("data", {})
    text = data.get("markdown", "") or ""
    links = data.get("links", []) or []

    results = []
    seen = set()

    domain_patterns = {
        "twitter": ("x.com", "twitter.com"),
        "quora": ("quora.com",),
        "producthunt": ("producthunt.com",),
    }
    domains = domain_patterns.get(platform, ())

    # --- Primary strategy: parse the text body for structured results ---
    # Google renders results as blocks separated by "Read more" or double newlines.
    # Split into result blocks and extract URL + snippet from each.
    blocks = re.split(r'Read more|\.\.\.(?:\n|$)', text)

    for block in blocks:
        block = block.strip()
        if len(block) < 20:
            continue

        # Find platform URLs in this block
        url_match = None
        for d in domains:
            m = re.search(rf'https?://(?:www\.)?{re.escape(d)}/[\w@._/-]+', block)
            if m:
                url_match = m
                break

        if not url_match:
            for d in domains:
                if d in block.lower() and (d == 'x.com' or d == 'twitter.com'):
                    um = re.search(r'@(\w{1,30})', block)
                    if um:
                        username = um.group(1)
                        class _FakeMatch:
                            def group(self, n=0): return f'https://x.com/{username}'
                        url_match = _FakeMatch()
                        break

        if not url_match:
            continue

        url = url_match.group(0).rstrip('.,;)')
        if url in seen:
            continue
        seen.add(url)

        # Extract title: first meaningful line of the block
        lines = [l.strip() for l in block.split('\n') if l.strip()]
        title = lines[0] if lines else ""
        # Clean title: strip platform chrome progressively
        title = re.sub(r'X\s*·\s*[\w_]+\s*\d*\+?\s*followers?', '', title).strip()
        title = re.sub(r'X\s*·\s*[\w_]+\s*\d+\s*months?\s*ago', '', title).strip()
        title = re.sub(r'X\s*·\s*[\w_]+', '', title).strip()
        title = re.sub(r'\s*[/|·]\s*Posts\s*[/|·]\s*X\b', '', title).strip()
        title = re.sub(r'\s*[/|·]\s*X\s*$', '', title).strip()
        title = re.sub(r'Product\s*Hunt\s*https?://\S+', '', title).strip()
        title = re.sub(r'Quora\s*\d+\s*answers?[^.]*', '', title).strip()
        title = re.sub(r'https?://\S+\s*›\s*\S+', '', title).strip()
        title = re.sub(r'\s*X$', '', title).strip()
        if not title or len(title) < 5:
            continue

        # Extract snippet: meaningful content lines, excluding metadata
        snippet_lines = []
        skip_patterns = re.compile(
            r'^(X\s*·|https?://|Sign in|\d+\+?\s*followers?|Product Hunt|Quora|'
            r'Read more|Posts\.|profile\.$)',
            re.IGNORECASE
        )
        for line in lines[1:]:
            if skip_patterns.match(line):
                continue
            if len(line) > 15:
                # Stop at "Read more" embedded in line
                clean = re.split(r'Read more', line)[0].strip()
                if clean and len(clean) > 15:
                    snippet_lines.append(clean)
        snippet = " ".join(snippet_lines)[:500]

        engagement = {}
        followers_match = re.search(r'(\d[\d,]*)\+?\s*followers?', block, re.I)
        if followers_match:
            engagement["followers"] = _parse_count(followers_match.group(1))
        likes_match = re.search(r'(\d[\d,]*)\+?\s*likes?', block, re.I)
        if likes_match:
            engagement["likes"] = _parse_count(likes_match.group(1))
        answers_match = re.search(r'(\d[\d,]*)\s*answers?', block, re.I)
        if answers_match:
            engagement["answers"] = _parse_count(answers_match.group(1))
        upvotes_match = re.search(r'(\d[\d,]*)\s*upvotes?', block, re.I)
        if upvotes_match:
            engagement["upvotes"] = _parse_count(upvotes_match.group(1))

        results.append({
            "title": title[:200],
            "url": url,
            "platform": platform,
            "content_snippet": snippet,
            "engagement_stats": engagement,
        })

    # --- Fallback: extract from links if text parsing got few results ---
    if len(results) < 3:
        for link in links:
            href = link.get("href", "")
            link_text = link.get("text", "").strip()

            if not any(d in href for d in domains):
                continue
            if not link_text or len(link_text) < 10:
                continue
            if "google.com" in href or "webcache" in href:
                continue
            if href in seen:
                continue
            seen.add(href)

            # Try to find snippet near this link text in the full text
            snippet = _extract_snippet_near(text, link_text)

            results.append({
                "title": link_text[:200],
                "url": href,
                "platform": platform,
                "content_snippet": snippet,
                "engagement_stats": {},
            })

    # --- Fallback: extract platform URLs from raw text ---
    if len(results) < 3:
        for d in domains:
            url_pattern = re.compile(rf'https?://(?:www\.)?{re.escape(d)}/([^\s"<>]+)')
            for m in url_pattern.finditer(text):
                url = m.group(0).rstrip('.,;)')
                if url in seen:
                    continue
                seen.add(url)
                slug = m.group(1).split("?")[0].replace("-", " ").replace("/", " ").strip()
                if len(slug) > 5:
                    results.append({
                        "title": slug[:200],
                        "url": url,
                        "platform": platform,
                        "content_snippet": "",
                        "engagement_stats": {},
                    })

    logger.info(f"[Parser] google_site({platform}): {len(results)} items from {len(links)} links")
    return results[:20]


def _extract_snippet_near(text: str, anchor: str) -> str:
    """Extract a content snippet near an anchor text in the full body."""
    idx = text.find(anchor[:40])
    if idx == -1:
        return ""
    window = text[idx + len(anchor):idx + len(anchor) + 500]
    lines = [l.strip() for l in window.split('\n') if l.strip()]
    skip = re.compile(r'^(X\s*·|https?://|Sign in|\d+\+?\s*followers?|Read more|\.\.\.)', re.I)
    snippets = [l for l in lines if not skip.match(l) and len(l) > 15]
    return " ".join(snippets)[:500]


def _extract_yt_initial_data(data: dict, results: list, seen_ids: set):
    """Recursively extract video renderers from YouTube's ytInitialData JSON"""
    if isinstance(data, dict):
        if 'videoRenderer' in data:
            vr = data['videoRenderer']
            vid = vr.get('videoId', '')
            if vid and vid not in seen_ids:
                seen_ids.add(vid)
                title_runs = vr.get('title', {}).get('runs', [])
                title = ''.join(r.get('text', '') for r in title_runs) if title_runs else ''
                channel_runs = vr.get('longBylineText', {}).get('runs', []) or vr.get('shortBylineText', {}).get('runs', [])
                channel = ''.join(r.get('text', '') for r in channel_runs) if channel_runs else ''
                view_text = vr.get('viewCountText', {}).get('simpleText', '') or ''
                views = 0
                vm = re.search(r'([\d,.]+)', view_text)
                if vm:
                    views = _parse_count(vm.group(1))
                results.append({
                    "title": title[:200] or f"YouTube Video ({vid})",
                    "url": f"https://www.youtube.com/watch?v={vid}",
                    "content_snippet": f"By {channel}" if channel else "",
                    "engagement_stats": {"views": views} if views else {},
                    "author": channel,
                    "time_ago": "",
                })
            return
        for v in data.values():
            _extract_yt_initial_data(v, results, seen_ids)
            if len(results) >= 20:
                return
    elif isinstance(data, list):
        for item in data:
            _extract_yt_initial_data(item, results, seen_ids)
            if len(results) >= 20:
                return


def _extract_youtube_id(url: str) -> str:
    """Extract YouTube video ID from URL"""
    parsed = urlparse(url)
    if "youtube.com" in parsed.netloc:
        qs = parse_qs(parsed.query)
        return qs.get("v", [""])[0]
    if "youtu.be" in parsed.netloc:
        return parsed.path.lstrip("/")
    return ""


def _find_engagement_near(text: str, title: str) -> Dict:
    """Find upvote/comment counts near a title in text"""
    stats = {}
    idx = text.find(title[:30])
    if idx == -1:
        return stats
    window = text[max(0, idx - 200):idx + len(title) + 400]
    for pattern, key in [
        (r'(\d+[\.\d]*[kKmM]?)\s*(?:upvote|point|vote|like|karma)', 'upvotes'),
        (r'(\d+[\.\d]*[kKmM]?)\s*comment', 'comments'),
        (r'(\d+[\.\d]*[kKmM]?)\s*(?:view|watch)', 'views'),
        (r'(\d+[\.\d]*[kKmM]?)\s*(?:share|repost)', 'shares'),
    ]:
        match = re.search(pattern, window, re.I)
        if match:
            stats[key] = _parse_count(match.group(1))
    # Reddit compact format: "7\n3 comments" or just numbers before "comments"
    if 'comments' not in stats:
        m = re.search(r'(\d+)\s+comments?', window, re.I)
        if m:
            stats['comments'] = int(m.group(1))
    if 'upvotes' not in stats:
        # Reddit: standalone number followed by newline (upvote count)
        m = re.search(r'\b(\d+)\s*(?:votes?|pts?)\b', window, re.I)
        if m:
            stats['upvotes'] = int(m.group(1))
    return stats


def _parse_count(s: str) -> int:
    """Parse count strings like '2.3K', '1.5M', '3,300' to integers"""
    s = s.strip().lower().replace(',', '')
    try:
        if s.endswith('k'):
            return int(float(s[:-1]) * 1000)
        elif s.endswith('m'):
            return int(float(s[:-1]) * 1000000)
        else:
            return int(float(s))
    except (ValueError, IndexError):
        return 0
