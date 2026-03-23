# AI-CMO Skill — Social Media Promotion Intelligence

> Find the best places to promote any product across social media, with AI-generated engagement strategies and ready-to-use comment scripts.

---

## What This Skill Does

AI-CMO analyzes a product (URL or name) and automatically:
1. **Identifies** the product type, target audience, and keywords
2. **Searches** Reddit, YouTube, Twitter, Quora, ProductHunt, HackerNews for relevant discussions
3. **Ranks** content by promotion potential (engagement, relevance, audience match)
4. **Generates** specific comment scripts tailored to each platform's culture
5. **Creates** an overall promotion strategy with weekly plans and KPIs

## When to Use

- User wants to promote a product/website on social media
- User asks "where should I promote X?"
- User wants to find relevant discussions about their product category
- User needs comment/reply scripts for social media engagement
- User wants a social media promotion strategy

## API Endpoints

**Base URL**: `https://your-domain.com` (or `http://localhost:9001` for local)

**Authentication**: All endpoints require `x-api-key` header.

---

### 1. Check Quota

```
GET /api/v1/open/quota
```

**Response:**
```json
{
  "credits_remaining": 47,
  "username": "user",
  "is_premium": true
}
```

---

### 2. Analyze Product (Core Endpoint)

```
POST /api/v1/open/analyze
```

**Request Body:**
```json
{
  "product": "u2foru.site",
  "language": "en",
  "max_results": 10
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `product` | string | Yes | Product URL (e.g., `u2foru.site`) or name (e.g., `Notion`) |
| `language` | string | No | Response language: `en`, `zh`, `ja`, `ko`, `es`, `fr`, `de`, `pt`, `ru`, `ar`. Default: `en` |
| `max_results` | int | No | 1-20, default 10 |

**Response:**
```json
{
  "success": true,
  "product_name": "YouTube Downloader by U2forU",
  "product_type": "SaaS tool",
  "total_found": 40,
  "platforms_searched": 6,
  "promotions": [
    {
      "rank": 1,
      "platform": "youtube",
      "url": "https://www.youtube.com/watch?v=...",
      "title": "How To Download YouTube Videos",
      "why_recommend": "High engagement video with 8.9M views...",
      "suggested_comment": "Downloading videos can be tricky, but tools offering pay-as-you-go pricing...",
      "comment_strategy": "Provide value first by addressing the video's topic, then naturally mention the tool",
      "estimated_exposure": "10k-50k views",
      "best_timing": "Within 24 hours while discussion is active",
      "risk_level": "low",
      "risk_note": "YouTube comments are moderated, avoid direct links",
      "composite_score": 92.5,
      "engagement_stats": { "views": 8900000 }
    }
  ],
  "strategy": {
    "priority_actions": [
      "Engage on high-traffic YouTube videos about downloading",
      "Participate in Reddit threads about YouTube tools",
      "Monitor HackerNews for relevant discussions"
    ],
    "weekly_plan": "Post 2-3 value-adding comments per platform per week...",
    "content_calendar": "Monday: Reddit engagement, Wednesday: YouTube comments...",
    "kpi_targets": "Target 50 engaged comments in month 1...",
    "budget_suggestion": "No paid budget needed for organic engagement..."
  },
  "credits_remaining": 46
}
```

**Cost**: 1 credit per call. Refunded on failure.

---

### 3. Get History

```
GET /api/v1/open/history?limit=20
```

Returns recent analysis history (titles and status).

---

### 4. Get History Detail

```
GET /api/v1/open/history/{conversation_id}
```

Returns full results of a past analysis including all recommendations and strategy.

---

## Typical Workflow for OpenClaw

### Step 1: Analyze the product
```
POST /api/v1/open/analyze
Body: { "product": "user's product URL or name", "language": "en" }
```

### Step 2: Present results to user
Show the user the ranked promotion spots with:
- Platform + URL (clickable)
- Why it's recommended
- Suggested comment ready to copy
- Risk level

### Step 3: User picks which spots to engage with
The user selects specific promotion spots. Each spot has a `url` and `suggested_comment`.

### Step 4: OpenClaw navigates to URLs and posts comments
Using the browser automation capability:
1. Open each `url`
2. Find the comment/reply box
3. Post the `suggested_comment` (or user-modified version)
4. Wait for confirmation

---

## Error Codes

| HTTP Code | Meaning |
|-----------|---------|
| 401 | Invalid API key |
| 402 | Insufficient credits |
| 403 | Account disabled |
| 500 | Analysis failed (credit refunded) |

---

## Rate Limits

- Each analysis takes 30-90 seconds (real-time web scraping + AI analysis)
- Max 10 concurrent analyses per API key
- Credits are consumed per analysis, not per request

---

## Notes

- API keys never expire but can be revoked
- The `suggested_comment` is platform-aware (casual for Reddit, professional for HN, etc.)
- Results are cached for 1 hour — same product re-analysis within 1h may be faster
- The `language` parameter only affects AI-generated text (recommendations, comments, strategy), not the scraped content titles
