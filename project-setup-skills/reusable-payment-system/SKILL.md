---
name: reusable-payment-system
description: Provides a reusable multi-channel payment system with Credit-based billing, LemonSqueezy (international cards), and Alipay (CNY). Includes checkout flow, webhook handling, and credit management. Use when building a product that needs payments, billing, credits, subscriptions, or pricing pages.
---

# Reusable Payment System

A production-ready payment system supporting multiple payment channels with a unified Credit-based billing model. Built with FastAPI backend and React frontend.

## Architecture

```
User -> Frontend PricingPage -> POST /api/v1/credits/checkout
  -> SGD: LemonSqueezy Checkout URL (redirect)
  -> CNY: Alipay Page Pay URL (redirect)

Payment success -> Webhook callback -> Verify signature -> Add credits to user
```

**Core concept**: All payments convert to internal Credits. Users spend Credits to use services. This decouples business logic from payment providers.

## Supported Channels

| Channel | Currency | Integration | Library |
|---------|----------|------------|---------|
| LemonSqueezy | SGD (international) | REST API + Webhook | `httpx` |
| Alipay | CNY (China) | SDK + Async Notify | `python-alipay-sdk` |

## Credit Exchange Rates

```python
CREDITS_PER_SGD = 5    # 1 SGD = 5 credits
CREDITS_PER_CNY = 2    # 1 CNY = 2 credits
```

## Quick Integration Steps

### 1. Database Models

```python
class PaymentOrder(Base):
    __tablename__ = "payment_orders"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, nullable=False, index=True)
    order_number = Column(String(100), unique=True, nullable=False, index=True)
    amount = Column(Float, nullable=False)
    credit_amount = Column(Integer, default=0)
    plan_type = Column(String(20), default="credit")
    status = Column(String(20), default="pending")  # pending, paid, failed
    lemon_order_id = Column(String(100), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    paid_at = Column(DateTime(timezone=True), nullable=True)

class CreditTransaction(Base):
    __tablename__ = "credit_transactions"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, nullable=False, index=True)
    type = Column(String(20), nullable=False, index=True)  # recharge, consume, refund
    amount = Column(Integer, nullable=False)  # positive=add, negative=deduct
    balance_after = Column(Integer, nullable=False)
    description = Column(String(500), nullable=True)
    order_number = Column(String(100), nullable=True, index=True)
    video_url = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
```

### 2. API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/credits/checkout` | Yes | Create checkout (SGD or CNY) |
| POST | `/api/v1/credits/webhook` | No | LemonSqueezy webhook callback |
| POST | `/api/v1/credits/alipay/notify` | No | Alipay async notification |
| GET | `/api/v1/credits/balance` | Yes | Query credit balance |
| GET | `/api/v1/credits/transactions` | Yes | Query transaction history |
| GET | `/api/v1/credits/packages` | No | Get pricing/rate info |

### 3. Checkout Flow

```python
@router.post("/checkout")
async def create_checkout(request: CheckoutRequest, current_user = Depends(get_current_user)):
    currency = request.currency.upper()
    amount = request.amount
    credit_amount = calculate_credits(amount, currency)

    order_number = db.create_credit_order(current_user["id"], float(amount), credit_amount)

    if currency == "CNY":
        pay_url = alipay_service.create_page_pay(order_number, amount, credit_amount)
        return {"success": True, "checkout_url": pay_url, ...}

    # SGD -> LemonSqueezy
    result = await lemonsqueezy_service.create_checkout(
        user_email=current_user["email"],
        sgd_amount=amount,
        custom_data={"user_id": str(current_user["id"]), "order_number": order_number},
    )
    return {"success": True, "checkout_url": result["checkout_url"], ...}
```

### 4. Webhook Pattern

**LemonSqueezy** (HMAC-SHA256 signature):
```python
@router.post("/webhook")
async def lemonsqueezy_webhook(request: Request):
    body = await request.body()
    signature = request.headers.get("X-Signature", "")
    if not verify_webhook_signature(body, signature):
        raise HTTPException(status_code=403)
    data = json.loads(body)
    parsed = parse_order_webhook(data)  # only handles "order_created"
    if not parsed:
        return {"status": "ignored"}
    # Complete order and add credits
    db.complete_credit_order(order_number=parsed["order_number"])
```

**Alipay** (RSA2 signature):
```python
@router.post("/alipay/notify")
async def alipay_notify(request: Request):
    form_data = dict(await request.form())
    if not alipay_service.verify_notify(form_data):
        return PlainTextResponse("fail")
    parsed = alipay_service.parse_notify(form_data)
    if not parsed:
        return PlainTextResponse("success")
    db.complete_credit_order(order_number=parsed["order_number"])
    return PlainTextResponse("success")  # MUST return "success" text
```

### 5. Frontend Pricing Component

```typescript
// Key API calls
export const getCreditPackages = async () => {
  return (await api.get('/api/v1/credits/packages')).data;
};

export const createCreditCheckout = async (amount: number, currency = 'SGD') => {
  return (await api.post('/api/v1/credits/checkout', { amount, currency })).data;
};

export const getCreditBalance = async () => {
  return (await api.get('/api/v1/credits/balance')).data;
};

export const getCreditTransactions = async (limit = 50) => {
  return (await api.get(`/api/v1/credits/transactions?limit=${limit}`)).data;
};
```

## Environment Variables

```
# LemonSqueezy (international payments)
LEMONSQUEEZY_API_KEY=
LEMONSQUEEZY_STORE_ID=
LEMONSQUEEZY_WEBHOOK_SECRET=
LEMONSQUEEZY_PRODUCT_ID=
LEMONSQUEEZY_VARIANT_ID=

# Alipay (CNY payments)
ALIPAY_APP_ID=
ALIPAY_PRIVATE_KEY_PATH=/path/to/private_key.txt
ALIPAY_PUBLIC_KEY_PATH=/path/to/alipay_public_key.pem
ALIPAY_NOTIFY_URL=https://yourdomain.com/api/v1/credits/alipay/notify
ALIPAY_RETURN_URL=https://yourdomain.com/?page=pricing
ALIPAY_SANDBOX=false
```

## Dependencies

```
httpx           # LemonSqueezy API calls
python-alipay-sdk  # Alipay SDK (RSA2 signing)
```

## Detailed Guides

- [LemonSqueezy integration details](lemonsqueezy-guide.md)
- [Alipay integration details](alipay-guide.md)
- [Complete code reference](payment-reference.md)
