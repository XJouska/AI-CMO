"""审计日志与用量记录的写入入口（各业务模块调用）。

- audit()：只 add，不 commit（与业务操作同一事务提交，业务回滚时审计也回滚）
- record_usage()：同上；估算成本按 COST_TABLE（可通过运营后台观察并调整）
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.orm import Session

from app.core.security.crypto import ip_hash
from app.modules.admin.models import AuditLog, UsageRecord

# 估算成本（人民币百万分之一元 / 单位）。LLM 按 1K token 计。
COST_TABLE: dict[str, int] = {
    "llm_tokens": 2_000,  # 每 1K token ≈ 0.002 元（以实际模型价格为准）
    "search_queries": 35_000,  # 每次搜索 API 调用 ≈ 0.035 元
    "fetches": 500,  # 每次抓取（带宽 / 计算）≈ 0.0005 元
    "emails_sent": 100,
}


def audit(
    db: Session,
    action: str,
    *,
    actor_id: uuid.UUID | None,
    company_id: uuid.UUID | None = None,
    target_type: str = "",
    target_id: str | uuid.UUID = "",
    detail: dict[str, Any] | None = None,
    on_behalf: bool = False,
    ip: str | None = None,
) -> AuditLog:
    entry = AuditLog(
        actor_user_id=actor_id,
        company_id=company_id,
        action=action,
        target_type=target_type,
        target_id=str(target_id),
        detail=detail or {},
        on_behalf=on_behalf,
        ip_hash=ip_hash(ip) if ip else "",
    )
    db.add(entry)
    return entry


def audit_scope(db: Session, scope: Any, action: str, **kwargs: Any) -> AuditLog:
    """以当前企业作用域记录审计；operator 角色自动标记为「运营代操作」。"""
    return audit(
        db,
        action,
        actor_id=scope.user.id,
        company_id=scope.company_id,
        on_behalf=scope.role == "operator",
        **kwargs,
    )


def record_usage(
    db: Session, company_id: uuid.UUID, kind: str, quantity: int = 1, detail: dict[str, Any] | None = None
) -> UsageRecord | None:
    if quantity <= 0:
        return None
    unit = COST_TABLE.get(kind, 0)
    cost = unit * quantity // 1000 if kind == "llm_tokens" else unit * quantity
    record = UsageRecord(company_id=company_id, kind=kind, quantity=quantity, cost_micros=cost, detail=detail or {})
    db.add(record)
    return record
