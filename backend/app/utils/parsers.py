"""
Platform-specific parsers for extracting structured data from scraped content.
Designed to work with Playwright innerText + links array from AgentGo.
"""
import re
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
    """Parse YouTube search results — use BOTH links and text for best results"""
    results = []
    seen_ids = set()

    # Strategy 1: Extract from links — each video has 2 links (timestamp + title)
    # The title link has clean text, timestamp link has "0:49\nNow playing"
    for link in links:
        href = link.get("href", "")
        link_text = link.get("text", "").strip().replace('\n', ' ')

        if "youtube.com/watch" not in href:
            continue

        vid = _extract_youtube_id(href)
        if not vid or vid in seen_ids:
            continue

        # Skip timestamp links: text like "0:49 0:49 Now playing" or very short
        if re.match(r'^[\d:]+\s', link_text) or "Now playing" in link_text or len(link_text) < 10:
            continue

        # Skip chapter/seek links with 0:00 prefix
        if link_text.startswith("0:") or re.match(r'^\d+:\d+\s', link_text):
            continue

        seen_ids.add(vid)

        # Find views from text near this title
        views = 0
        channel = ""
        time_ago = ""
        title_clean = link_text[:200]

        # Search in text for view count near this title
        idx = text.find(title_clean[:30])
        if idx >= 0:
            window = text[idx:idx + 300]
            view_match = re.search(r'([\d,.]+[KkMm]?)\s*views?', window)
            if view_match:
                views = _parse_count(view_match.group(1))
            time_match = re.search(r'(\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago)', window)
            if time_match:
                time_ago = time_match.group(1)
            # Channel is usually a short line after views
            lines_after = window.split('\n')
            for l in lines_after[1:5]:
                l = l.strip()
                if l and len(l) < 40 and not re.match(r'^[\d,.]+', l) and 'views' not in l.lower() and 'ago' not in l.lower():
                    channel = l
                    break

        results.append({
            "title": title_clean,
            "url": href,
            "content_snippet": f"By {channel}" if channel else "",
            "engagement_stats": {"views": views} if views else {},
            "author": channel,
            "time_ago": time_ago,
        })

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
    """Parse Twitter/X search results"""
    results = []
    for link in links:
        href = link.get("href", "")
        link_text = link.get("text", "").strip()
        if "/status/" in href and ("x.com" in href or "twitter.com" in href):
            results.append({
                "title": link_text[:200] if link_text and len(link_text) > 5 else "Tweet",
                "url": href,
                "content_snippet": link_text[:500] if link_text else "",
                "engagement_stats": {},
            })
    return results[:20]


def parse_quora(text: str, links: list) -> List[Dict]:
    """Parse Quora search results"""
    results = []
    for link in links:
        href = link.get("href", "")
        link_text = link.get("text", "").strip()
        if "quora.com" in href and link_text and len(link_text) > 15:
            if link_text.lower() in ("quora", "sign in", "search", "log in"):
                continue
            if "/search?" in href or "/profile/" in href:
                continue
            results.append({
                "title": link_text[:200],
                "url": href,
                "content_snippet": "",
                "engagement_stats": {},
            })
    return results[:20]


def parse_producthunt(text: str, links: list) -> List[Dict]:
    """Parse ProductHunt search results"""
    results = []
    for link in links:
        href = link.get("href", "")
        link_text = link.get("text", "").strip()
        if "producthunt.com" in href and link_text and len(link_text) > 5:
            if "/posts/" in href or "/products/" in href:
                results.append({
                    "title": link_text[:200],
                    "url": href,
                    "content_snippet": "",
                    "engagement_stats": {},
                })
    if not results:
        for link in links:
            href = link.get("href", "")
            link_text = link.get("text", "").strip()
            if "producthunt.com" in href and link_text and len(link_text) > 10:
                if link_text.lower() not in ("product hunt", "sign in", "topics"):
                    results.append({
                        "title": link_text[:200], "url": href,
                        "content_snippet": "", "engagement_stats": {},
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
