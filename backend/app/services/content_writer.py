"""AI Content Writer Service - generates platform-specific marketing content."""
import json
import logging
from typing import AsyncGenerator
from app.services.llm import LLMService, get_llm_service
from app.database import get_database

logger = logging.getLogger(__name__)

PLATFORM_GUIDELINES = {
    "reddit": "Casual, authentic. Never start with I. Provide value first. No marketing buzzwords.",
    "twitter": "Concise (max 280 chars for tweets). Use hashtags. Be engaging and shareable.",
    "hackernews": "Technical, factual. Focus on technology merits. Avoid hype.",
    "youtube": "Engaging, enthusiastic but genuine. Good for descriptions or comments.",
    "quora": "Expert, helpful. Answer thoroughly first, then reference product naturally.",
    "producthunt": "Enthusiastic, supportive. Focus on features and use cases.",
    "blog": "Professional, informative. SEO-friendly with headers. 300-800 words.",
}

class ContentWriterService:
    def __init__(self):
        self.llm: LLMService = get_llm_service()

    async def generate(self, conversation_id, user_id, platform, content_type, brand_voice="", tone=""):
        db = get_database()
        detail = db.get_conversation_detail(conversation_id, user_id)
        if not detail:
            return "Error: Analysis not found"
        profile = detail.get("product_profile", {}) or {}
        recs = detail.get("recommendations", [])
        pr = [r for r in recs if r.get("platform","").lower() == platform.lower()][:3] or recs[:3]
        guide = PLATFORM_GUIDELINES.get(platform.lower(), "")
        voice = f"\nBrand voice: {tone or brand_voice}" if (tone or brand_voice) else ""
        messages = [
            {"role": "system", "content": f"You are an expert content marketer. Generate {content_type} for {platform}.\nGuidelines: {guide}{voice}\nSound human, provide value. Output ONLY the content text."},
            {"role": "user", "content": f"Product: {json.dumps(profile, ensure_ascii=False)}\nTargets: {json.dumps(pr, ensure_ascii=False)}\nGenerate {content_type} for {platform}."}
        ]
        return (await self.llm.chat(messages, max_tokens=2048)).strip()

    async def generate_stream(self, conversation_id, user_id, platform, content_type, brand_voice="", tone=""):
        db = get_database()
        detail = db.get_conversation_detail(conversation_id, user_id)
        if not detail:
            yield "Error: Analysis not found"
            return
        profile = detail.get("product_profile", {}) or {}
        recs = detail.get("recommendations", [])
        pr = [r for r in recs if r.get("platform","").lower() == platform.lower()][:2] or recs[:2]
        guide = PLATFORM_GUIDELINES.get(platform.lower(), "")
        voice = f"\nBrand voice: {tone or brand_voice}" if (tone or brand_voice) else ""
        messages = [
            {"role": "system", "content": f"Generate {content_type} for {platform}. {guide}{voice} Output ONLY content text."},
            {"role": "user", "content": f"Product: {json.dumps(profile, ensure_ascii=False)}\nTarget: {json.dumps(pr, ensure_ascii=False)}"}
        ]
        async for chunk in self.llm.chat_stream(messages):
            yield chunk

_cw_instance = None
def get_content_writer():
    global _cw_instance
    if _cw_instance is None:
        _cw_instance = ContentWriterService()
    return _cw_instance
