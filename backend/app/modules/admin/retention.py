"""数据保留期限（每天由 worker 清理）。

| 数据 | 保留 |
|---|---|
| 已过期 / 已撤销的会话 | 30 天 |
| 登录尝试记录（限流与锁定用） | 30 天 |
| 数据源请求记录（限流与监控用） | 90 天 |
| 已完成 / 失败的任务 | 30 天 |
| 站外通知投递记录 | 90 天 |
| 用量记录 | 400 天（计费对账需要跨年） |
| 审计日志 | 永久（合规要求；不含明文个人信息，IP 只存哈希） |
"""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.core.db import utcnow

RETENTION_DAYS = {
    "sessions": 30,
    "login_attempts": 30,
    "source_requests": 90,
    "jobs": 30,
    "deliveries": 90,
    "usage": 400,
}


def purge_expired(db: Session) -> int:
    from app.core.jobs import Job
    from app.modules.admin.models import NotificationDelivery, UsageRecord
    from app.modules.auth.models import LoginAttempt
    from app.modules.auth.models import Session as UserSession
    from app.modules.leads.models import SourceRequest

    now = utcnow()

    def before(key: str):  # type: ignore[no-untyped-def]
        return now - timedelta(days=RETENTION_DAYS[key])

    statements = [
        delete(UserSession).where(UserSession.expires_at < before("sessions")),
        delete(UserSession).where(UserSession.revoked_at.is_not(None), UserSession.revoked_at < before("sessions")),
        delete(LoginAttempt).where(LoginAttempt.created_at < before("login_attempts")),
        delete(SourceRequest).where(SourceRequest.created_at < before("source_requests")),
        delete(Job).where(Job.status.in_(("done", "failed")), Job.finished_at < before("jobs")),
        delete(NotificationDelivery).where(NotificationDelivery.created_at < before("deliveries")),
        delete(UsageRecord).where(UsageRecord.created_at < before("usage")),
    ]
    total = 0
    for statement in statements:
        total += db.execute(statement).rowcount or 0
    db.commit()
    return total
