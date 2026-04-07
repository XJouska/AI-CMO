"""
Node 1+2 combined prompt: Product analysis + Search strategy in one LLM call
"""


def build_product_and_search_prompt(user_input: str, scraped_content: str = "") -> list:
    """Build prompt for combined Node1+Node2: product profile + search strategy"""

    content_context = ""
    if scraped_content:
        content_context = f"""

Here is the ACTUAL scraped content from the website. Use this as the PRIMARY source of truth to determine what the product does:
---
{scraped_content[:3000]}
---
"""
    else:
        content_context = "\n(No website content was scraped. Analyze based on the URL/domain name and the product name.)\n"

    return [
        {
            "role": "system",
            "content": """You are an expert marketing analyst and social media strategist.
Your task is to analyze a product/URL and generate both a product profile AND a multi-platform search strategy in a single response.

CRITICAL RULES:
1. If website content is provided, you MUST determine the product type from the ACTUAL content. Do NOT guess or hallucinate. Read the content carefully.
2. If the URL/domain gives a clear hint (e.g. "downloader", "converter", "shop"), use that hint.
3. ALL search URLs MUST use ENGLISH keywords only, because Reddit, YouTube, HackerNews, ProductHunt, and Quora are English-dominant platforms. Chinese/Japanese/other non-English keywords will return zero results on these platforms.
4. The "keywords" field in profile should also be in English for search purposes.

You MUST respond in valid JSON format with exactly this structure:
{
  "profile": {
    "product_name": "Product name",
    "product_type": "SaaS tool / E-commerce / Content / App / etc.",
    "target_audience": ["audience1", "audience2"],
    "core_value_proposition": "Core value in one sentence",
    "keywords": ["english_keyword1", "english_keyword2", "english_keyword3"],
    "competitor_hints": ["competitor1", "competitor2"],
    "language": "en",
    "industry_tags": ["tag1", "tag2"]
  },
  "search_tasks": [
    {
      "platform": "reddit",
      "search_urls": [
        "https://www.reddit.com/search/?q=english+keyword1+keyword2&sort=relevance&t=year",
        "https://www.reddit.com/search/?q=best+alternative+to+competitor&sort=new&t=year"
      ],
      "priority": "high"
    },
    {
      "platform": "youtube",
      "search_urls": [
        "https://www.youtube.com/results?search_query=best+product_type+tools+2026&sp=EgIIBQ%3D%3D",
        "https://www.youtube.com/results?search_query=how+to+use+keyword+tutorial&sp=EgIIBQ%3D%3D"
      ],
      "priority": "high"
    },
    {
      "platform": "twitter",
      "search_urls": [
        "https://x.com/search?q=english+keyword&f=live"
      ],
      "priority": "medium"
    },
    {
      "platform": "quora",
      "search_urls": [
        "https://www.quora.com/search?q=question+about+product+in+english"
      ],
      "priority": "medium"
    },
    {
      "platform": "producthunt",
      "search_urls": [
        "https://www.producthunt.com/search?q=product_type"
      ],
      "priority": "medium"
    },
    {
      "platform": "hackernews",
      "search_urls": [
        "https://hn.algolia.com/?q=english+keyword&dateRange=pastYear"
      ],
      "priority": "low"
    }
  ]
}

Rules for search strategy:
- ALWAYS use English keywords in search URLs (this is non-negotiable)
- ALWAYS include time filters in search URLs to get RECENT content:
  * Reddit: append "&t=year" (past year) to all URLs
  * YouTube: append "&sp=EgIIBQ%3D%3D" (past month) for trending, or "&sp=CAISBAgEEAE%3D" (past year sorted by date)
  * HackerNews: append "&dateRange=pastYear"
  * Twitter/X: always use "&f=live" (already shows latest)
- For SaaS/Dev tools: prioritize Reddit, HackerNews, ProductHunt
- For consumer products: prioritize YouTube, Twitter, Reddit
- For content/media: prioritize YouTube, Twitter, Quora
- Generate 2-3 search URLs per platform with relevant English keywords
- Use actual working search URL patterns for each platform
- Sort keywords by relevance, max 5 keywords
- Always include at least Reddit and YouTube as high priority
- Include the CURRENT YEAR (2026) in YouTube search queries when searching for "best tools" or "top alternatives" to find recent content"""
        },
        {
            "role": "user",
            "content": f"""Analyze this product/input and generate a complete product profile + search strategy.

User Input: {user_input}
{content_context}

IMPORTANT: Determine the product type from the ACTUAL content/URL, not from imagination. Use ENGLISH keywords in all search URLs. Respond in valid JSON only."""
        }
    ]


def build_url_pre_analysis_prompt(url: str) -> list:
    """Lightweight pre-analysis based on URL domain only"""
    return [
        {
            "role": "system",
            "content": """Based on the URL domain and path, make a quick prediction about the product type.
Respond in JSON: {"predicted_type": "...", "likely_industry": "...", "suggested_keywords": ["k1","k2"]}"""
        },
        {
            "role": "user",
            "content": f"URL: {url}"
        }
    ]


def build_profile_refinement_prompt(pre_profile: dict, scraped_content: str) -> list:
    """Refine product profile with actual scraped content"""
    return [
        {
            "role": "system",
            "content": """You have a preliminary product analysis. Now refine it with the actual page content.
Output the same JSON structure as the original profile but with improved accuracy."""
        },
        {
            "role": "user",
            "content": f"""Preliminary analysis: {pre_profile}

Actual page content:
{scraped_content[:3000]}

Refine the product profile based on the actual content. Respond in JSON."""
        }
    ]
