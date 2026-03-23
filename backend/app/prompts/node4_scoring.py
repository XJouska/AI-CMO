"""
Node 4: Content quality scoring prompt
"""


def build_scoring_prompt(items: list, profile: dict) -> list:
    """Build prompt for scoring a batch of scraped results"""
    import json

    return [
        {
            "role": "system",
            "content": """You are an expert at evaluating social media content for marketing promotion potential.

Score each item on these dimensions (0-100):
- engagement_score: Based on upvotes, comments, views (higher = better)
- recency_score: How recent the content is (newer = higher)
- relevance_score: How well it matches the target product
- promotion_potential: How suitable for product promotion (active discussion, open to recommendations)
- audience_match: How well the audience matches the product's target users

Calculate composite_score = engagement×0.2 + recency×0.15 + relevance×0.25 + promotion_potential×0.25 + audience_match×0.15

Respond in JSON:
{
  "scored_items": [
    {
      "index": 0,
      "composite_score": 85.5,
      "scores": {
        "engagement_score": 90,
        "recency_score": 80,
        "relevance_score": 85,
        "promotion_potential": 88,
        "audience_match": 82
      },
      "ranking_reason": "One sentence reason"
    }
  ]
}"""
        },
        {
            "role": "user",
            "content": f"""Product profile:
{json.dumps(profile, ensure_ascii=False, indent=2)}

Items to score:
{json.dumps(items, ensure_ascii=False, indent=2)}

Score all items. Respond in valid JSON only."""
        }
    ]
