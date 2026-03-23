# LemonSqueezy Integration Guide

## Overview

LemonSqueezy is a Merchant of Record (MoR) that handles international payments including Visa, Mastercard, and PayPal. It uses a **single variant + custom_price** approach for flexible credit recharges.

## Setup

1. Create a LemonSqueezy account and store
2. Create a product with a single variant (any base price)
3. Get API key from LemonSqueezy dashboard
4. Configure webhook endpoint pointing to `/api/v1/credits/webhook`
5. Set webhook secret for signature verification

## Config

```python
LEMONSQUEEZY_API_BASE = "https://api.lemonsqueezy.com/v1"

CREDITS_PER_SGD = 5
MIN_AMOUNT_SGD = 1
SUGGESTED_AMOUNTS_SGD = [1, 5, 10, 20, 50]
```

## Creating a Checkout

Uses the LemonSqueezy Checkouts API with `custom_price` to override variant price:

```python
async def create_checkout(user_email: str, sgd_amount: int,
                          custom_data: Optional[Dict] = None) -> Optional[Dict]:
    price_in_cents = sgd_amount * 100
    credit_amount = sgd_amount * CREDITS_PER_SGD

    payload = {
        "data": {
            "type": "checkouts",
            "attributes": {
                "custom_price": price_in_cents,
                "checkout_data": {
                    "email": user_email,
                    "custom": {
                        **(custom_data or {}),
                        "sgd_amount": str(sgd_amount),
                        "credit_amount": str(credit_amount),
                    },
                },
                "product_options": {
                    "name": f"Credit Recharge - {credit_amount} Credits",
                    "description": f"S${sgd_amount} = {credit_amount} Credits",
                    "redirect_url": "https://yourdomain.com/?page=pricing",
                },
            },
            "relationships": {
                "store": {"data": {"type": "stores", "id": STORE_ID}},
                "variant": {"data": {"type": "variants", "id": VARIANT_ID}},
            },
        }
    }

    headers = {
        "Accept": "application/vnd.api+json",
        "Content-Type": "application/vnd.api+json",
        "Authorization": f"Bearer {API_KEY}",
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(f"{API_BASE}/checkouts", headers=headers, json=payload)
        if response.status_code in (200, 201):
            data = response.json()
            return {
                "checkout_url": data["data"]["attributes"]["url"],
                "checkout_id": data["data"]["id"],
            }
    return None
```

## Webhook Verification

LemonSqueezy signs webhooks with HMAC-SHA256:

```python
def verify_webhook_signature(payload: bytes, signature: str) -> bool:
    expected = hmac.HMAC(
        WEBHOOK_SECRET.encode(), payload, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature)
```

## Parsing Order Webhook

```python
def parse_order_webhook(data: Dict) -> Optional[Dict]:
    meta = data.get("meta", {})
    if meta.get("event_name") != "order_created":
        return None

    attrs = data["data"]["attributes"]
    order_id = str(data["data"]["id"])
    sgd_amount = attrs.get("total", 0) / 100.0

    return {
        "order_id": order_id,
        "user_email": attrs.get("user_email", ""),
        "sgd_amount": sgd_amount,
        "status": attrs.get("status", ""),
        "custom_data": meta.get("custom_data", {}),
    }
```

## Order Completion

Two strategies for matching webhooks to local orders:

1. **By order_number** (preferred): Pass `order_number` in `custom_data` during checkout
2. **By user email** (fallback): Match via `user_email` field, auto-create order if none exists

```python
custom_data = parsed.get("custom_data", {})
order_number = custom_data.get("order_number")

if order_number:
    db.complete_credit_order(order_number=order_number, lemon_order_id=parsed["order_id"])
else:
    db.complete_credit_order_by_lemon_id(
        lemon_order_id=parsed["order_id"],
        user_email=parsed["user_email"],
        usd_amount=parsed["sgd_amount"],
    )
```
