import logging
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional

from app.database import get_database
from app.middleware.auth_middleware import get_current_user
from app.services.llm import get_llm_service
from app.services.browser_service import get_browser_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/competitors", tags=["competitors"])


class AddCompetitorRequest(BaseModel):
    name: str
    url: str
    description: str = ""


class DiscoverRequest(BaseModel):
    product_url: Optional[str] = None
    product_name: Optional[str] = None


@router.post("")
async def add_competitor(request: AddCompetitorRequest, current_user=Depends(get_current_user)):
    db = get_database()
    comp_id = db.add_competitor(current_user["id"], request.name, request.url, request.description)
    return {"success": True, "id": comp_id}


@router.get("")
async def list_competitors(current_user=Depends(get_current_user)):
    db = get_database()
    competitors = db.get_competitors(current_user["id"])
    return {"competitors": competitors}


@router.delete("/{comp_id}")
async def delete_competitor(comp_id: str, current_user=Depends(get_current_user)):
    db = get_database()
    success = db.delete_competitor(comp_id, current_user["id"])
    if not success:
        raise HTTPException(status_code=404, detail="Competitor not found")
    return {"success": True}


@router.post("/discover")
async def discover_competitors(request: DiscoverRequest, current_user=Depends(get_current_user)):
    """Use LLM to auto-discover competitors based on product URL or name."""
    llm = get_llm_service()
    browser = get_browser_service()
    context = ""
    if request.product_url:
        try:
            result = await browser.scrape_url(request.product_url)
            if result.get("success"):
                context = result.get("data", {}).get("markdown", "")[:3000]
        except Exception as e:
            logger.warning(f"Failed to scrape product URL: {e}")
    product_desc = request.product_name or request.product_url or ""
    prompt_content = f"Product: {product_desc}"
    if context:
        prompt_content += f"\n\nProduct page content:\n{context}"
    try:
        result = await llm.chat_json([
            {"role": "system", "content": "Identify 5-8 competitors for the given product.\nRespond in JSON:\n{\"competitors\": [{\"name\": \"CompetitorName\", \"url\": \"https://...\", \"description\": \"Brief description\"}]}\nOnly include real, existing companies with valid URLs."},
            {"role": "user", "content": prompt_content}
        ])
        return {"competitors": result.get("competitors", [])}
    except Exception as e:
        logger.exception(f"Competitor discovery failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{comp_id}/analyze")
async def analyze_competitor(comp_id: str, current_user=Depends(get_current_user)):
    """Run a deep analysis comparing a competitor to the user product."""
    db = get_database()
    comps = db.get_competitors(current_user["id"])
    comp = next((c for c in comps if c["id"] == comp_id), None)
    if not comp:
        raise HTTPException(status_code=404, detail="Competitor not found")
    llm = get_llm_service()
    browser = get_browser_service()
    comp_content = ""
    try:
        result = await browser.scrape_url(comp["url"])
        if result.get("success"):
            comp_content = result.get("data", {}).get("markdown", "")[:4000]
    except Exception:
        pass
    user_url = current_user.get("primary_url", "")
    user_content = ""
    if user_url:
        try:
            result = await browser.scrape_url(user_url)
            if result.get("success"):
                user_content = result.get("data", {}).get("markdown", "")[:3000]
        except Exception:
            pass
    try:
        analysis = await llm.chat_json([
            {"role": "system", "content": "Analyze a competitor compared to the user product.\nRespond in JSON:\n{\"summary\": \"2-3 sentence comparison\", \"strengths\": [], \"weaknesses\": [], \"opportunities\": [], \"threats\": [], \"pricing_comparison\": \"Brief pricing comparison\", \"target_audience\": \"Audience comparison\", \"recommendation\": \"Strategic recommendation\"}"},
            {"role": "user", "content": f"Competitor: {comp['name']} ({comp['url']})\nCompetitor page:\n{comp_content}\n\nOur product URL: {user_url}\nOur page:\n{user_content}"}
        ])
        db.add_activity(current_user["id"], "competitor_analyzed", f"Competitor analyzed: {comp['name']}", {"competitor_id": comp_id, "competitor_name": comp["name"]})
        return {"success": True, "analysis": analysis, "competitor": comp}
    except Exception as e:
        logger.exception(f"Competitor analysis failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/comparison")
async def get_comparison(current_user=Depends(get_current_user)):
    """Get a high-level comparison across all tracked competitors."""
    db = get_database()
    competitors = db.get_competitors(current_user["id"])
    if not competitors:
        return {"comparison": None, "message": "No competitors tracked"}
    llm = get_llm_service()
    comp_list = [{"name": c["name"], "url": c["url"], "description": c.get("description", "")} for c in competitors[:5]]
    try:
        result = await llm.chat_json([
            {"role": "system", "content": "Compare multiple competitors in a structured overview.\nRespond in JSON:\n{\"dimensions\": [\"Dimension1\", ...], \"scores\": {\"CompetitorName\": {\"Dimension1\": 0-100}}, \"summary\": \"Brief competitive landscape summary\"}\nUse 5-6 dimensions like: Product Quality, Pricing, Market Presence, Innovation, UX, Support."},
            {"role": "user", "content": f"Competitors: {comp_list}"}
        ])
        return {"comparison": result}
    except Exception as e:
        logger.exception(f"Comparison failed: {e}")
        return {"comparison": None, "message": str(e)}
