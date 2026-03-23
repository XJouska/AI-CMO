"""
Node 5: Deep analysis prompt for Top 10 recommendations
"""
import json


def build_deep_analysis_prompt(items: list, profile: dict) -> list:
    """Build prompt for deep analysis of top items"""
    return [
        {
            "role": "system",
            "content": """You are an expert marketing strategist. For each top-ranked content item, provide deep analysis.

CRITICAL RULES:
1. You MUST keep the original "url", "platform", and "title" from the input data EXACTLY as-is. Do NOT modify, fabricate, or "improve" any URLs.
2. For "engagement_stats": copy the EXACT numbers from the input data. Do NOT invent engagement numbers. If input has no stats, use empty object {}.

Respond in JSON:
{
  "recommendations": [
    {
      "rank": 1,
      "url": "MUST be the exact original url from input, copy it verbatim",
      "platform": "MUST be the exact original platform from input",
      "title": "MUST be the exact original title from input",
      "why_recommend": "3-5 sentences explaining why this is a great promotion opportunity",
      "estimated_exposure": "e.g., 10k-50k views based on current engagement trends",
      "best_timing": "When to engage (e.g., 'Within 24 hours while discussion is active')",
      "risk_level": "low/medium/high",
      "risk_note": "Any risks (community rules, potential deletion, etc.)",
      "engagement_stats": {
        "upvotes": 0,
        "comments": 0,
        "views": 0
      }
    }
  ]
}

Be specific and actionable in your analysis. Consider:
- Current engagement momentum
- Community rules and culture
- Content relevance to the product
- Audience demographics match"""
        },
        {
            "role": "user",
            "content": f"""Product profile:
{json.dumps(profile, ensure_ascii=False, indent=2)}

Top items to analyze deeply:
{json.dumps(items, ensure_ascii=False, indent=2)}

Provide detailed analysis. Respond in valid JSON only."""
        }
    ]
