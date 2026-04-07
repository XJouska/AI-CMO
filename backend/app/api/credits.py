import hashlib
import hmac
import json
import logging
from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel, Field
from typing import Optional

from app.database import get_database
from app.middleware.auth_middleware import get_current_user
from app.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/credits", tags=["credits"])

PACKAGES = [
    {
        "name": "Starter",
        "price": 7.99,
        "credits": 7,
        "tagline": "A full week of daily analysis",
        "popular": False,
        "checkout_url": "https://lightracex.lemonsqueezy.com/checkout/buy/6fcbca4f-3f24-4b79-8701-52be18626963",
        "product_id": "932191",
        "variant_id": "1465499",
    },
    {
        "name": "Standard",
        "price": 14.99,
        "credits": 15,
        "tagline": "Two weeks of insights, plus extras",
        "popular": True,
        "checkout_url": "https://lightracex.lemonsqueezy.com/checkout/buy/968247d6-4de7-4780-a639-ca4a81ba32d7",
        "product_id": "932201",
        "variant_id": "1465515",
    },
    {
        "name": "Pro",
        "price": 22.99,
        "credits": 25,
        "tagline": "A full month of daily analysis",
        "popular": False,
        "checkout_url": "https://lightracex.lemonsqueezy.com/checkout/buy/e2167eac-459a-4818-b730-9fff55072790",
        "product_id": "932203",
        "variant_id": "1465517",
    },
    {
        "name": "Ultra",
        "price": 99.99,
        "credits": 115,
        "tagline": "4+ months of daily usage, best value",
        "popular": False,
        "checkout_url": "https://lightracex.lemonsqueezy.com/checkout/buy/692d5b75-bdf3-471b-aafe-0d6286df3f13",
        "product_id": "932204",
        "variant_id": "1465518",
    },
]


class CheckoutRequest(BaseModel):
    package_name: str = Field(..., description="Package name: Starter, Standard, Pro, Ultra")


class CheckoutResponse(BaseModel):
    success: bool
    checkout_url: Optional[str] = None
    order_number: Optional[str] = None
    price: float = 0
    credit_amount: int = 0
    message: str = ""


@router.get("/balance")
async def get_balance(current_user=Depends(get_current_user)):
    db = get_database()
    balance = db.get_credit_balance(current_user["id"])
    return {
        "credit_balance": balance,
        "username": current_user["username"],
        "user_id": current_user["id"],
    }


@router.get("/transactions")
async def get_transactions(current_user=Depends(get_current_user)):
    db = get_database()
    txns = db.get_credit_transactions(current_user["id"])
    return {"transactions": txns}


@router.get("/packages")
async def get_packages():
    return {
        "currency": "SGD",
        "symbol": "S$",
        "packages": [
            {
                "name": p["name"],
                "price": p["price"],
                "credits": p["credits"],
                "tagline": p["tagline"],
                "popular": p["popular"],
            }
            for p in PACKAGES
        ],
    }


@router.post("/checkout", response_model=CheckoutResponse)
async def create_checkout(request: CheckoutRequest, current_user=Depends(get_current_user)):
    db = get_database()
    user_id = current_user["id"]
    pkg = next((p for p in PACKAGES if p["name"].lower() == request.package_name.lower()), None)
    if not pkg:
        raise HTTPException(status_code=400, detail=f"Unknown package: {request.package_name}")

    order_number = db.create_credit_order(
        user_id=user_id,
        usd_amount=pkg["price"],
        credit_amount=pkg["credits"],
    )

    checkout_url = f"{pkg['checkout_url']}?checkout[custom][user_id]={user_id}&checkout[custom][order_number]={order_number}&checkout[email]={current_user.get('email', '')}"

    return CheckoutResponse(
        success=True,
        checkout_url=checkout_url,
        order_number=order_number,
        price=pkg["price"],
        credit_amount=pkg["credits"],
        message=f"Redirecting to payment for {pkg['credits']} credits",
    )


@router.post("/webhook/lemonsqueezy")
async def lemonsqueezy_webhook(request: Request):
    """LemonSqueezy webhook: verify signature and fulfill order."""
    body = await request.body()
    signature = request.headers.get("x-signature", "")

    if settings.lemonsqueezy_webhook_secret:
        expected = hmac.new(
            settings.lemonsqueezy_webhook_secret.encode(),
            body,
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(signature, expected):
            logger.warning("[Webhook] Invalid LemonSqueezy signature")
            raise HTTPException(status_code=403, detail="Invalid signature")

    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    event_name = payload.get("meta", {}).get("event_name", "")
    if event_name != "order_created":
        return {"success": True, "message": f"Ignored event: {event_name}"}

    data = payload.get("data", {})
    attrs = data.get("attributes", {})
    custom = payload.get("meta", {}).get("custom_data", {})
    user_id = custom.get("user_id")
    order_number = custom.get("order_number")
    status = attrs.get("status", "")

    if status not in ("paid", "refunded"):
        return {"success": True, "message": f"Order status: {status}"}

    if not user_id or not order_number:
        logger.warning(f"[Webhook] Missing custom data: user_id={user_id}, order={order_number}")
        return {"success": False, "message": "Missing custom data"}

    db = get_database()
    lemon_order_id = str(data.get("id", ""))

    if status == "paid":
        success, credit_amount = db.complete_credit_order(order_number, lemon_order_id)
        if success:
            logger.info(f"[Webhook] Order fulfilled: user={user_id}, credits={credit_amount}, order={order_number}")
            db.add_activity(
                int(user_id), "credits_purchased",
                f"Purchased {credit_amount} credits",
                {"order_number": order_number, "credits": credit_amount},
            )
        else:
            logger.warning(f"[Webhook] Order already fulfilled or not found: {order_number}")

    return {"success": True}
