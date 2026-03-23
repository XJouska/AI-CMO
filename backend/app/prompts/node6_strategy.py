"""
Node 6: Strategy generation prompt
"""
import json


def build_strategy_prompt(recommendations: list, profile: dict) -> list:
    """Build prompt for generating marketing strategy + comment scripts"""
    return [
        {
            "role": "system",
            "content": """You are an expert social media marketing strategist. Generate actionable promotion strategies.

For each recommendation, create a natural, non-spammy comment/reply script.
Also generate an overall marketing strategy.

Respond in JSON:
{
  "comment_scripts": [
    {
      "rank": 1,
      "platform": "reddit",
      "suggested_comment": "A natural comment (150-300 chars) that provides value first, then naturally mentions the product",
      "comment_strategy": "Brief explanation of the approach",
      "do": ["Provide genuine value", "Answer the question first", "Be transparent"],
      "dont": ["Don't hard sell", "Don't spam", "Don't use marketing buzzwords"]
    }
  ],
  "overall_strategy": {
    "priority_actions": ["Action 1", "Action 2", "Action 3"],
    "weekly_plan": "Suggested weekly promotion rhythm",
    "content_calendar": "Recommended content publishing schedule",
    "kpi_targets": "Suggested KPI targets for the first month",
    "budget_suggestion": "Budget recommendation if paid promotion is needed"
  }
}

Rules for comment scripts:
- Sound human and authentic, NOT like a marketer
- Provide value before mentioning the product
- Adapt tone to the platform (Reddit: casual tech-savvy, YouTube: enthusiastic, Twitter: concise)
- Respect each platform's community guidelines
- For Reddit: NEVER start with "I" or use exclamation marks excessively"""
        },
        {
            "role": "user",
            "content": f"""Product profile:
{json.dumps(profile, ensure_ascii=False, indent=2)}

Top recommendations to create strategies for:
{json.dumps(recommendations, ensure_ascii=False, indent=2)}

Generate comment scripts and overall strategy. Respond in valid JSON only."""
        }
    ]


def build_strategy_supplement_prompt(batch2_recs: list, strategy_part1: dict, profile: dict) -> list:
    """Supplementary strategy for remaining recommendations"""
    return [
        {
            "role": "system",
            "content": """Generate comment scripts for additional recommendations and enhance the overall strategy.
Maintain consistency with the existing strategy.
Respond in JSON with the same format as the main strategy prompt."""
        },
        {
            "role": "user",
            "content": f"""Product: {json.dumps(profile, ensure_ascii=False)}
Existing strategy context: {json.dumps(strategy_part1, ensure_ascii=False)}
Additional recommendations: {json.dumps(batch2_recs, ensure_ascii=False)}

Generate supplementary scripts and strategy. Respond in valid JSON only."""
        }
    ]
