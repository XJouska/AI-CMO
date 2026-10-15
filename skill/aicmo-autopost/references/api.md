# AI-CMO Open API Reference

**Base URL:** `https://www.aicmo.site/api/v1/open`
**Auth:** `x-api-key: <AICMO_API_KEY>` header on every request.

## Endpoints

| Method | Path | Credits | Purpose |
|---|---|---|---|
| GET  | `/quota` | 0 | Check remaining credits |
| POST | `/analyze` | 1 | Analyze product, return JSON |
| POST | `/analyze/csv` | 1 | Analyze product, return CSV (Excel-compatible, UTF-8 BOM) |
| GET  | `/history?limit=N` | 0 | List past analysis sessions |
| GET  | `/history/{id}` | 0 | Full results of one past analysis |
| GET  | `/history/{id}/csv` | 0 | Re-download a past analysis as CSV |

Credits for `/analyze*` are **refunded automatically** if the server fails mid-analysis.

## Request body — `/analyze` and `/analyze/csv`

```json
{
  "product": "https://yoursite.com",
  "language": "en",
  "max_results": 10
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `product` | string | yes | URL or product name, 1–500 chars |
| `language` | string | no | `en` (default), `zh`, `ja`, `ko`, `es`, `fr`, `de`, `pt`, `ru`, `ar` |
| `max_results` | integer | no | 1–20, default 10 |

> Analysis takes 2–4 minutes. Set client timeout ≥ 300s.

## Response — `/analyze` (JSON)

```json
{
  "promotions": [
    {
      "rank": 1,
      "platform": "reddit",
      "url": "https://www.reddit.com/r/…/comments/…",
      "title": "Post title",
      "suggested_comment": "…",
      "comment_strategy": "helpful | comparative | question",
      "why_recommend": "…",
      "best_timing": "Within 4 hours",
      "risk_level": "low | medium | high",
      "risk_note": "…",
      "estimated_exposure": "~5K views",
      "composite_score": 87.4,
      "engagement_stats": { "upvotes": 234, "comments": 42, "views": 5100 }
    }
  ],
  "strategy": {
    "summary": "Focus on Reddit help threads and YouTube tutorials",
    "priority_platforms": ["reddit", "youtube"]
  }
}
```

## Response — `/analyze/csv`

CSV file, UTF-8 with BOM. Columns (in order):

`Rank, Platform, URL, Title, Suggested Comment, Comment Strategy, Why Recommend, Best Timing, Risk Level, Estimated Exposure, Score`

## Response — `/quota`

```json
{ "credits_remaining": 15, "username": "you", "is_premium": false }
```

## Error codes

| HTTP | Meaning |
|---|---|
| 400 | Bad request (invalid product / params) |
| 401 / 403 | API key missing or rejected |
| 402 | Insufficient credits |
| 429 | Rate limited (rare; only on abusive patterns) |
| 5xx | Server error — credit auto-refunded |
