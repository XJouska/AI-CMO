from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel, Field
from typing import Optional

from app.database import get_database
from app.middleware.auth_middleware import get_current_user
from app.config import settings

router = APIRouter(prefix="/api/v1/credits", tags=["credits"])

CREDITS_PER_SGD = 5
CREDITS_PER_CNY = 2
MIN_AMOUNT_SGD = 1
MIN_AMOUNT_CNY = 5
SUGGESTED_AMOUNTS_SGD = [5, 15, 30]
SUGGESTED_AMOUNTS_CNY = [25, 68, 128]


class CheckoutRequest(BaseModel):
    amount: int = Field(..., ge=1, description="Amount (integer, min 1)")
    currency: str = Field("SGD", description="Currency: SGD or CNY")


class CheckoutResponse(BaseModel):
    success: bool
    checkout_url: Optional[str] = None
    order_number: Optional[str] = None
    sgd_amount: int = 0
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
        "mode": "fixed",
        "packages": [
            {"name": "Starter", "price_sgd": 5, "price_cny": 25, "credits": 25},
            {"name": "Standard", "price_sgd": 15, "price_cny": 68, "credits": 80},
            {"name": "Pro", "price_sgd": 30, "price_cny": 128, "credits": 180},
        ],
        "currencies": {
            "SGD": {
                "symbol": "S$", "credits_per_unit": CREDITS_PER_SGD,
                "min_amount": MIN_AMOUNT_SGD,
                "suggested_amounts": SUGGESTED_AMOUNTS_SGD,
                "rate": "1 SGD = 5 Credits",
            },
            "CNY": {
                "symbol": "¥", "credits_per_unit": CREDITS_PER_CNY,
                "min_amount": MIN_AMOUNT_CNY,
                "suggested_amounts": SUGGESTED_AMOUNTS_CNY,
                "rate": "¥1 = 2 Credits",
            },
        },
    }


@router.post("/checkout", response_model=CheckoutResponse)
async def create_checkout(request: CheckoutRequest, current_user=Depends(get_current_user)):
    db = get_database()
    currency = request.currency.upper()
    amount = request.amount

    if currency == "CNY":
        credit_amount = amount * CREDITS_PER_CNY
    else:
        credit_amount = amount * CREDITS_PER_SGD

    order_number = db.create_credit_order(
        user_id=current_user["id"],
        usd_amount=float(amount),
        credit_amount=credit_amount,
    )

    # Payment provider integration placeholder
    # In production, would create LemonSqueezy or Alipay checkout
    return CheckoutResponse(
        success=True, order_number=order_number,
        sgd_amount=amount, credit_amount=credit_amount,
        message=f"Order created: {credit_amount} credits for {currency} {amount}",
    )


@router.post("/webhook/lemonsqueezy")
async def lemonsqueezy_webhook(request: Request):
    """LemonSqueezy webhook handler"""
    body = await request.body()
    # In production: verify HMAC-SHA256 signature
    # Parse and complete order
    return {"success": True}


@router.post("/webhook/alipay")
async def alipay_webhook(request: Request):
    """Alipay notification handler"""
    form = await request.form()
    # In production: verify RSA2 signature and complete order
    return "success"
