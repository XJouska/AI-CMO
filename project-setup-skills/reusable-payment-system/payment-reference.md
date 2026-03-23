# Payment System - Complete Code Reference

## Credit Routes (credit_routes.py)

### Request/Response Models

```python
from pydantic import BaseModel, Field
from typing import Optional

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

class BalanceResponse(BaseModel):
    credit_balance: int
    username: str
    user_id: int
```

### Full Checkout Endpoint

```python
@router.post("/checkout", response_model=CheckoutResponse)
async def create_checkout(request: CheckoutRequest, current_user = Depends(get_current_user)):
    db = get_database()
    currency = request.currency.upper()
    amount = request.amount
    credit_amount = lemonsqueezy_service.calculate_credits(amount, currency)

    order_number = db.create_credit_order(
        user_id=current_user["id"],
        usd_amount=float(amount),
        credit_amount=credit_amount,
    )

    if currency == "CNY":
        if not alipay_service.is_configured():
            raise HTTPException(status_code=503, detail="Alipay not available")
        pay_url = alipay_service.create_page_pay(
            order_number=order_number, cny_amount=amount, credit_amount=credit_amount,
        )
        if not pay_url:
            raise HTTPException(status_code=500, detail="Failed to create Alipay URL")
        return CheckoutResponse(
            success=True, checkout_url=pay_url, order_number=order_number,
            sgd_amount=amount, credit_amount=credit_amount,
            message=f"Please pay ¥{amount} = {credit_amount} credits via Alipay",
        )

    if not lemonsqueezy_service.is_configured():
        raise HTTPException(status_code=503, detail="SGD payment not available")
    result = await lemonsqueezy_service.create_checkout(
        user_email=current_user["email"], sgd_amount=amount,
        custom_data={"user_id": str(current_user["id"]), "order_number": order_number},
    )
    if not result:
        raise HTTPException(status_code=500, detail="Failed to create checkout")
    return CheckoutResponse(
        success=True, checkout_url=result["checkout_url"], order_number=order_number,
        sgd_amount=amount, credit_amount=credit_amount,
        message=f"Please pay S${amount} = {credit_amount} credits",
    )
```

### Packages Endpoint (Multi-Currency)

```python
@router.get("/packages")
async def get_packages():
    return {
        "mode": "custom",
        "currency": "SGD",
        "min_amount": MIN_AMOUNT_SGD,
        "suggested_amount": SUGGESTED_AMOUNT_SGD,
        "credits_per_sgd": CREDITS_PER_SGD,
        "rate": "1 SGD = 5 Credits",
        "payment_configured": lemonsqueezy_service.is_configured(),
        "suggested_amounts": SUGGESTED_AMOUNTS_SGD,
        "currencies": {
            "SGD": {
                "symbol": "S$",
                "credits_per_unit": CREDITS_PER_SGD,
                "min_amount": MIN_AMOUNT_SGD,
                "suggested_amount": SUGGESTED_AMOUNT_SGD,
                "suggested_amounts": SUGGESTED_AMOUNTS_SGD,
                "rate": "1 SGD = 5 Credits",
                "payment_methods": ["lemonsqueezy"],
            },
            "CNY": {
                "symbol": "¥",
                "credits_per_unit": CREDITS_PER_CNY,
                "min_amount": MIN_AMOUNT_CNY,
                "suggested_amount": SUGGESTED_AMOUNT_CNY,
                "suggested_amounts": SUGGESTED_AMOUNTS_CNY,
                "rate": "¥1 = 2 Credits",
                "payment_methods": ["alipay"],
            },
        },
    }
```

## Database Methods for Payment Orders

```python
def create_credit_order(self, user_id: int, usd_amount: float, credit_amount: int) -> str:
    order_number = f"CRD{datetime.now().strftime('%Y%m%d%H%M%S')}{secrets.token_hex(4)}"
    order = PaymentOrder(
        user_id=user_id, order_number=order_number,
        amount=usd_amount, credit_amount=credit_amount, plan_type="credit",
    )
    session.add(order)
    session.commit()
    return order_number

def complete_credit_order(self, order_number: str,
                          lemon_order_id: Optional[str] = None) -> tuple[bool, int]:
    order = session.query(PaymentOrder).filter(
        PaymentOrder.order_number == order_number
    ).first()
    if not order or order.status == "paid":
        return False, 0
    order.status = "paid"
    order.paid_at = datetime.now()
    if lemon_order_id:
        order.lemon_order_id = lemon_order_id
    session.commit()
    credit_amount = order.credit_amount or int(order.amount * 5)
    success, balance = self.add_credits(
        user_id=order.user_id, amount=credit_amount,
        description=f"Recharge ${order.amount} = {credit_amount} credits",
        order_number=order_number,
    )
    return success, credit_amount

def complete_credit_order_by_lemon_id(self, lemon_order_id: str,
                                       user_email: str, usd_amount: float) -> tuple[bool, int]:
    # Check for duplicate
    existing = session.query(PaymentOrder).filter(
        PaymentOrder.lemon_order_id == lemon_order_id
    ).first()
    if existing and existing.status == "paid":
        return False, 0
    # Find user by email
    user = session.query(User).filter(User.email == user_email).first()
    if not user:
        return False, 0
    credit_amount = int(usd_amount * 5)
    # Auto-create order if not exists
    if not existing:
        order_number = f"CRD{datetime.now().strftime('%Y%m%d%H%M%S')}{secrets.token_hex(4)}"
        order = PaymentOrder(
            user_id=user.id, order_number=order_number,
            amount=usd_amount, credit_amount=credit_amount,
            plan_type="credit", status="paid",
            paid_at=datetime.now(), lemon_order_id=lemon_order_id,
        )
        session.add(order)
        session.commit()
    success, balance = self.add_credits(user_id=user.id, amount=credit_amount, ...)
    return success, credit_amount
```

## Frontend TypeScript Interfaces

```typescript
export interface CreditCheckoutResponse {
  success: boolean;
  checkout_url?: string;
  order_number?: string;
  sgd_amount: number;
  credit_amount: number;
  message: string;
}

export interface CreditBalance {
  credit_balance: number;
  username: string;
  user_id: number;
}

export interface CreditTransaction {
  id: number;
  type: string;       // "recharge" | "consume" | "refund"
  amount: number;
  balance_after: number;
  description: string;
  order_number?: string;
  video_url?: string;
  created_at: string;
}

export interface CurrencyInfo {
  symbol: string;
  credits_per_unit: number;
  min_amount: number;
  suggested_amount: number;
  suggested_amounts: number[];
  rate: string;
  payment_methods: string[];
}

export interface CreditPackagesInfo {
  mode: string;
  currency: string;
  min_amount: number;
  suggested_amount: number;
  credits_per_sgd: number;
  rate: string;
  payment_configured: boolean;
  suggested_amounts: number[];
  currencies?: Record<string, CurrencyInfo>;
}
```

## Pydantic Settings for Payment Config

```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # LemonSqueezy
    lemonsqueezy_api_key: str = ""
    lemonsqueezy_store_id: str = ""
    lemonsqueezy_webhook_secret: str = ""
    lemonsqueezy_product_id: str = ""
    lemonsqueezy_variant_id: str = ""

    # Alipay
    alipay_app_id: str = ""
    alipay_private_key_path: str = ""
    alipay_public_key_path: str = ""
    alipay_notify_url: str = ""
    alipay_return_url: str = ""
    alipay_sandbox: bool = False

    class Config:
        env_file = ".env"
        extra = "ignore"
```
