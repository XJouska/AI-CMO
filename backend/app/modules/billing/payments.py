"""在线支付网关接口（支付宝 / 微信支付等）。首版只提供假网关，用于验证回调流程。

回调处理原则（真实网关同样适用）：
1. 验签：签名不正确直接拒绝
2. 金额以服务端订单为准：回调金额与订单不一致拒绝
3. 幂等：同一 provider_trade_no 重复回调只生效一次
"""

from __future__ import annotations

import hashlib
import hmac
import json
from dataclasses import dataclass
from typing import Any, Protocol

from app.core.config import get_settings


@dataclass
class PaymentNotice:
    order_id: str
    trade_no: str
    amount_cents: int
    paid: bool


class PaymentGateway(Protocol):
    name: str

    def checkout_url(self, order_id: str, amount_cents: int, subject: str) -> str: ...

    def parse_notice(self, body: bytes, headers: dict[str, str]) -> PaymentNotice:
        """验签并解析回调；签名无效抛出 ValueError。"""
        ...


class FakeGateway:
    """HMAC-SHA256 签名的假网关（密钥派生自 SECRET_KEY）。测试与演示用。"""

    name = "fake"

    def _key(self) -> bytes:
        return hmac.new(get_settings().secret_key.get_secret_value().encode(), b"fake-pay", hashlib.sha256).digest()

    def sign(self, body: bytes) -> str:
        return hmac.new(self._key(), body, hashlib.sha256).hexdigest()

    def checkout_url(self, order_id: str, amount_cents: int, subject: str) -> str:
        return f"/pay/fake/{order_id}"

    def parse_notice(self, body: bytes, headers: dict[str, str]) -> PaymentNotice:
        signature = headers.get("x-signature", "")
        if not hmac.compare_digest(self.sign(body), signature):
            raise ValueError("bad signature")
        data: dict[str, Any] = json.loads(body)
        return PaymentNotice(
            order_id=str(data["order_id"]),
            trade_no=str(data["trade_no"]),
            amount_cents=int(data["amount_cents"]),
            paid=data.get("status") == "paid",
        )


def gateways() -> dict[str, PaymentGateway]:
    """可用网关。真实网关（支付宝 / 微信支付）接入后在此按配置注册；TEST_MODE 下提供假网关。"""
    out: dict[str, PaymentGateway] = {}
    if get_settings().test_mode:
        out["fake"] = FakeGateway()
    return out
