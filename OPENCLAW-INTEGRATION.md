# AI-CMO OpenClaw Skill Integration

## Skill Definition

```yaml
name: ai-cmo
description: Find the best social media promotion spots for any product and generate engagement strategies
version: 1.0.0
author: AI-CMO
icon: 🚀

triggers:
  - "promote my product"
  - "find promotion spots"
  - "social media marketing"
  - "where to promote"
  - "find discussions about"
  - "marketing strategy for"

capabilities:
  - product_analysis
  - social_media_search
  - promotion_recommendations
  - comment_generation
  - strategy_planning

config:
  api_base_url: "https://your-domain.com"
  api_key_env: "AICMO_API_KEY"
```

## Integration Flow

### 1. User triggers the skill

User says something like:
> "Help me find the best places to promote u2foru.site"

### 2. Skill calls AI-CMO API

```javascript
// Step 1: Check quota
const quota = await fetch(`${API_BASE}/api/v1/open/quota`, {
  headers: { "x-api-key": AICMO_API_KEY }
}).then(r => r.json());

if (quota.credits_remaining <= 0) {
  return "No credits remaining. Visit AI-CMO to recharge.";
}

// Step 2: Analyze the product
const result = await fetch(`${API_BASE}/api/v1/open/analyze`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-api-key": AICMO_API_KEY,
  },
  body: JSON.stringify({
    product: "u2foru.site",
    language: "en",
    max_results: 10,
  }),
}).then(r => r.json());
```

### 3. Present results to user

Format the `result.promotions` array into a readable list:

```
🚀 Found 40 relevant discussions across 6 platforms!

Here are the top promotion spots for YouTube Downloader by U2forU:

#1 [YouTube] How To Legally Download YouTube Videos
   👁 8.9M views | ⏰ Best timing: Within 24 hours
   💡 Suggested comment ready to post
   🔗 https://youtube.com/watch?v=...

#2 [Reddit] Is there ANY YouTube downloader that works?
   💬 234 comments | ⚠️ Risk: low
   💡 Suggested comment ready to post
   🔗 https://reddit.com/r/youtube/...

...

📋 Strategy: Focus on YouTube tutorials and Reddit help threads.
   Priority: Engage on 2-3 high-traffic videos per week.
```

### 4. User selects spots → OpenClaw browses and posts

When user says "Post on #1 and #2":

```javascript
for (const spot of selectedSpots) {
  // OpenClaw uses browser automation to:
  // 1. Navigate to spot.url
  // 2. Find comment/reply input
  // 3. Type spot.suggested_comment
  // 4. Submit
  await openClaw.browse(spot.url);
  await openClaw.findAndType("comment-input", spot.suggested_comment);
  await openClaw.click("submit-button");
}
```

## Environment Variables

```env
AICMO_API_KEY=sk-cmo-your-api-key-here
AICMO_API_URL=https://your-domain.com
```

## Getting an API Key

1. Register at AI-CMO (https://your-domain.com)
2. Login → Click your username → API Keys
3. Create a new API key
4. Add to your OpenClaw environment as `AICMO_API_KEY`
