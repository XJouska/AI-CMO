# Alipay Integration Guide

## Overview

Alipay PC website payment (`alipay.trade.page.pay`) for Chinese Yuan (CNY) transactions. Uses RSA2 signing with the `python-alipay-sdk` library.

## Setup

1. Register at [open.alipay.com](https://open.alipay.com) and create an application
2. Generate RSA2 key pair: app private key + Alipay public key
3. Configure notify URL (async callback) and return URL (redirect after payment)
4. Store private key file and public key file on server

## Config

```python
ALIPAY_GATEWAY = "https://openapi.alipay.com/gateway.do"
ALIPAY_GATEWAY_SANDBOX = "https://openapi-sandbox.dl.alipaydev.com/gateway.do"

CREDITS_PER_CNY = 2
MIN_AMOUNT_CNY = 1
SUGGESTED_AMOUNTS_CNY = [5, 10, 20, 50, 100]
```

## Environment Variables

```
ALIPAY_APP_ID=2021006136607951
ALIPAY_PRIVATE_KEY_PATH=/path/to/private_key.txt
ALIPAY_PUBLIC_KEY_PATH=/path/to/alipay_public_key.pem
ALIPAY_NOTIFY_URL=https://yourdomain.com/api/v1/credits/alipay/notify
ALIPAY_RETURN_URL=https://yourdomain.com/?page=pricing
ALIPAY_SANDBOX=false
```

## Client Initialization (Singleton)

```python
from alipay import AliPay
from pathlib import Path

_alipay_client = None

def _get_client():
    global _alipay_client
    if _alipay_client is not None:
        return _alipay_client

    private_key = Path(settings.alipay_private_key_path).read_text().strip()
    public_key = Path(settings.alipay_public_key_path).read_text().strip()

    _alipay_client = AliPay(
        appid=settings.alipay_app_id,
        app_notify_url=settings.alipay_notify_url,
        app_private_key_string=private_key,
        alipay_public_key_string=public_key,
        sign_type="RSA2",
        debug=settings.alipay_sandbox,
    )
    return _alipay_client
```

## Creating a Payment

```python
def create_page_pay(order_number: str, cny_amount: int,
                    credit_amount: int, subject: Optional[str] = None) -> Optional[str]:
    client = _get_client()
    if not client:
        return None

    if not subject:
        subject = f"Credit Recharge - {credit_amount} Credits"

    query_string = client.api_alipay_trade_page_pay(
        out_trade_no=order_number,
        total_amount=str(cny_amount),
        subject=subject,
        return_url=settings.alipay_return_url,
        notify_url=settings.alipay_notify_url,
    )

    gateway = ALIPAY_GATEWAY_SANDBOX if settings.alipay_sandbox else ALIPAY_GATEWAY
    return f"{gateway}?{query_string}"
```

## Async Notification Handling

Alipay POSTs form data to the `notify_url` after successful payment. **Must return plain text "success"**.

### Signature Verification

```python
def verify_notify(data: Dict[str, Any]) -> bool:
    client = _get_client()
    signature = data.pop("sign", None)
    sign_type = data.pop("sign_type", None)
    if not signature:
        return False
    success = client.verify(data, signature)
    data["sign"] = signature
    if sign_type:
        data["sign_type"] = sign_type
    return success
```

### Data Parsing

```python
def parse_notify(data: Dict[str, str]) -> Optional[Dict]:
    trade_status = data.get("trade_status", "")
    if trade_status not in ("TRADE_SUCCESS", "TRADE_FINISHED"):
        return None
    return {
        "order_number": data.get("out_trade_no", ""),
        "trade_no": data.get("trade_no", ""),
        "total_amount": data.get("total_amount", "0"),
        "trade_status": trade_status,
        "buyer_id": data.get("buyer_id", ""),
        "gmt_payment": data.get("gmt_payment", ""),
    }
```

### Webhook Endpoint

```python
@router.post("/alipay/notify")
async def alipay_notify(request: Request):
    form_data = dict(await request.form())

    if not alipay_service.verify_notify(form_data):
        return PlainTextResponse("fail")

    parsed = alipay_service.parse_notify(form_data)
    if not parsed:
        return PlainTextResponse("success")

    db.complete_credit_order(order_number=parsed["order_number"],
                             lemon_order_id=parsed.get("trade_no", ""))

    return PlainTextResponse("success")
```

## Key Differences from LemonSqueezy

| Aspect | LemonSqueezy | Alipay |
|--------|-------------|--------|
| Signature | HMAC-SHA256 (header) | RSA2 (form field) |
| Callback | JSON body | URL-encoded form |
| Response | JSON `{"status":"ok"}` | Plain text `"success"` |
| Redirect | Hosted checkout page | Alipay payment page |
| Currency | SGD | CNY |
