# AI-CMO 开放 API 参考

**Base URL：** `https://www.aicmo.site/api/v1/open`
**鉴权：** 每个请求都要带 `x-api-key: <AICMO_API_KEY>` 请求头。

## 接口列表

| 方法 | 路径 | 积分 | 用途 |
|---|---|---|---|
| GET  | `/quota` | 0 | 查询剩余积分 |
| POST | `/analyze` | 1 | 分析产品，返回 JSON |
| POST | `/analyze/csv` | 1 | 分析产品，返回 CSV（Excel 兼容，UTF-8 BOM） |
| GET  | `/history?limit=N` | 0 | 列出历史分析记录 |
| GET  | `/history/{id}` | 0 | 查看某次分析的完整结果 |
| GET  | `/history/{id}/csv` | 0 | 重新下载过往分析为 CSV |

`/analyze*` 的积分会在服务端失败时**自动退回**。

## 请求体 —— `/analyze` 与 `/analyze/csv`

```json
{
  "product": "https://yoursite.com",
  "language": "zh",
  "max_results": 10
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `product` | string | 是 | 产品 URL 或名称，1–500 字符 |
| `language` | string | 否 | `en`（默认）、`zh`、`ja`、`ko`、`es`、`fr`、`de`、`pt`、`ru`、`ar` |
| `max_results` | integer | 否 | 1–20，默认 10 |

> 分析通常耗时 2–4 分钟，客户端超时应设为 ≥ 300 秒。

## 响应 —— `/analyze`（JSON）

```json
{
  "promotions": [
    {
      "rank": 1,
      "platform": "reddit",
      "url": "https://www.reddit.com/r/…/comments/…",
      "title": "帖子标题",
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
    "summary": "重点关注 Reddit 求助贴和 YouTube 教程视频",
    "priority_platforms": ["reddit", "youtube"]
  }
}
```

## 响应 —— `/analyze/csv`

CSV 文件，UTF-8 with BOM。列顺序：

`Rank, Platform, URL, Title, Suggested Comment, Comment Strategy, Why Recommend, Best Timing, Risk Level, Estimated Exposure, Score`

## 响应 —— `/quota`

```json
{ "credits_remaining": 15, "username": "you", "is_premium": false }
```

## 错误码

| HTTP | 含义 |
|---|---|
| 400 | 请求参数错误（产品或参数非法） |
| 401 / 403 | API Key 缺失或被拒绝 |
| 402 | 积分不足 |
| 429 | 被限流（仅在异常调用模式下触发） |
| 5xx | 服务端错误 —— 积分自动退回 |
