"""通知：用户开关、站外渠道（邮件 / 企业微信）投递。

- 站内通知（notifications 表）由各业务模块写入；写入时（after_flush 事件）自动在同一事务中创建投递任务，
  业务回滚则任务一并回滚
- 投递任务在 worker 中执行：按每位成员的开关决定渠道；同一 (通知, 用户, 渠道) 只投递一次（唯一约束）；
  失败按任务表的指数退避重试，最终失败记录在 notification_deliveries
- 邮件渠道使用平台系统发信账号（SYSTEM_SMTP_*）；未配置时跳过（status=skipped）
- 企业微信：企业在设置中填写群机器人 Webhook（加密存储；只允许 qyapi.weixin.qq.com，经 safe_fetch 发出）
"""

from __future__ import annotations

import json
import uuid
from typing import Any

from sqlalchemy import event, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import utcnow
from app.core.jobs import Job, RetryableJobError, job_handler
from app.modules.admin.models import NotificationDelivery, NotificationPref

DELIVER_JOB = "notifications.deliver"

# 通知类型 → 中文名；默认开关（站内总是开启，不可关闭）
KINDS: dict[str, str] = {
    "new_leads": "新商机",
    "new_lead": "新商机",
    "new_inquiry": "新询盘",
    "follow_up_due": "跟进提醒",
    "deadline_soon": "招标截止提醒",
    "weekly_report": "效果周报",
    "system": "系统消息",
}
PREF_GROUPS: dict[str, dict[str, Any]] = {
    "leads": {"label": "新商机", "kinds": ["new_leads", "new_lead"], "default": {"email": True, "wecom": True}},
    "inquiry": {"label": "新询盘", "kinds": ["new_inquiry"], "default": {"email": True, "wecom": True}},
    "follow_up": {
        "label": "跟进与截止提醒",
        "kinds": ["follow_up_due", "deadline_soon"],
        "default": {"email": False, "wecom": True},
    },
    "report": {"label": "效果周报", "kinds": ["weekly_report"], "default": {"email": True, "wecom": False}},
    "system": {"label": "系统消息", "kinds": ["system"], "default": {"email": True, "wecom": False}},
}
CHANNELS = ("email", "wecom")
WECOM_HOST = "qyapi.weixin.qq.com"


def group_of(kind: str) -> str | None:
    for key, group in PREF_GROUPS.items():
        if kind in group["kinds"]:
            return key
    return None


def effective_prefs(pref: NotificationPref | None) -> dict[str, dict[str, bool]]:
    stored = pref.prefs if pref else {}
    return {
        key: {ch: bool(stored.get(key, {}).get(ch, group["default"][ch])) for ch in CHANNELS}
        for key, group in PREF_GROUPS.items()
    }


def wants(db: Session, user_id: uuid.UUID, company_id: uuid.UUID, kind: str, channel: str) -> bool:
    group = group_of(kind)
    if group is None:
        return False
    pref = db.get(NotificationPref, (user_id, company_id))
    return effective_prefs(pref)[group][channel]


# ── 自动入队 ───────────────────────────────────────────────────────────


@event.listens_for(Session, "before_flush")
def _enqueue_deliveries(session: Session, flush_context: Any, instances: Any) -> None:
    """新通知 → 同一事务内加入投递任务（before_flush 中只 add，不能再触发 flush）。"""
    from app.core.db import new_id
    from app.modules.sites.models import Notification

    for obj in list(session.new):
        if isinstance(obj, Notification) and group_of(obj.kind) is not None:
            if obj.id is None:
                obj.id = new_id()
            session.add(
                Job(
                    kind=DELIVER_JOB,
                    payload={"notification_id": str(obj.id)},
                    company_id=obj.company_id,
                    run_after=utcnow(),
                    max_attempts=4,
                )
            )


# ── 渠道实现 ───────────────────────────────────────────────────────────


class ChannelError(Exception):
    pass


async def send_email(to: str, subject: str, body: str) -> bool:
    """平台系统邮件。未配置 SYSTEM_SMTP_HOST 时返回 False（跳过）。"""
    from app.core.providers import providers
    from app.services.mailer import MailSendError, OutgoingMail, SmtpCredentials

    settings = get_settings()
    if settings.test_mode:
        mailer = providers.mailer()
        creds = SmtpCredentials(host="smtp.platform.example", port=465, username="noreply", password="x")  # noqa: S106 — TEST_MODE 假发信
    elif settings.system_smtp_host and settings.system_smtp_password:
        mailer = providers.mailer()
        creds = SmtpCredentials(
            host=settings.system_smtp_host,
            port=settings.system_smtp_port,
            username=settings.system_smtp_username or settings.system_mail_from,
            password=settings.system_smtp_password.get_secret_value(),
        )
    else:
        return False
    try:
        await mailer.send(
            creds,
            OutgoingMail(
                from_address=settings.system_mail_from,
                from_name=settings.system_mail_name,
                to=to,
                subject=subject,
                body=body,
                unsubscribe_url=f"{settings.public_base_url.rstrip('/')}/me/notifications",
            ),
        )
    except MailSendError as exc:
        raise ChannelError(exc.code) from exc
    return True


def valid_wecom_webhook(url: str) -> bool:
    from urllib.parse import urlsplit

    parts = urlsplit(url)
    return (
        parts.scheme == "https"
        and parts.hostname == WECOM_HOST
        and parts.path == "/cgi-bin/webhook/send"
        and "key=" in parts.query
    )


async def send_wecom(webhook: str, title: str, body: str, link: str) -> bool:
    from app.core.providers import providers

    if not valid_wecom_webhook(webhook):
        return False
    settings = get_settings()
    url = f"{settings.public_base_url.rstrip('/')}{link}" if link.startswith("/") else ""
    content = f"**{title}**\n{body}" + (f"\n[查看详情]({url})" if url else "")
    payload = json.dumps({"msgtype": "markdown", "markdown": {"content": content[:4000]}}, ensure_ascii=False).encode()
    try:
        result = await providers.webhook().post(webhook, payload)
    except Exception as exc:
        raise ChannelError(type(exc).__name__) from exc
    if result.status_code >= 400:
        raise ChannelError(f"http_{result.status_code}")
    return True


# ── 投递任务 ───────────────────────────────────────────────────────────


def _delivery(
    db: Session, note_id: uuid.UUID, company_id: uuid.UUID, user_id: uuid.UUID, channel: str
) -> NotificationDelivery:
    row = db.scalar(
        select(NotificationDelivery).where(
            NotificationDelivery.notification_id == note_id,
            NotificationDelivery.user_id == user_id,
            NotificationDelivery.channel == channel,
        )
    )
    if row is None:
        row = NotificationDelivery(notification_id=note_id, company_id=company_id, user_id=user_id, channel=channel)
        db.add(row)
        db.flush()
    return row


@job_handler(DELIVER_JOB)
async def deliver(db: Session, job: Job) -> None:
    from app.core.security.secrets_box import DecryptionError, decrypt_json
    from app.modules.admin.models import CompanyChannel
    from app.modules.auth.models import User
    from app.modules.companies.models import CompanyMember
    from app.modules.sites.models import Notification

    note = db.get(Notification, uuid.UUID(job.payload["notification_id"]))
    if note is None:
        return
    members = (
        db.execute(
            select(User)
            .join(CompanyMember, CompanyMember.user_id == User.id)
            .where(
                CompanyMember.company_id == note.company_id, CompanyMember.role != "operator", User.is_active.is_(True)
            )
        )
        .scalars()
        .all()
    )
    if note.user_id is not None:
        members = [m for m in members if m.id == note.user_id]
    channel = db.get(CompanyChannel, (note.company_id, "wecom"))
    try:
        webhook = str(decrypt_json(channel.encrypted_config).get("webhook", "")) if channel else ""
    except DecryptionError:
        webhook = ""
    failures: list[str] = []

    # 企业微信：企业级群机器人，只发一次（任一成员开启即发送）
    if webhook and any(wants(db, m.id, note.company_id, note.kind, "wecom") for m in members) and members:
        row = _delivery(db, note.id, note.company_id, members[0].id, "wecom")
        if row.status not in ("sent", "skipped"):
            row.attempts += 1
            try:
                sent = await send_wecom(webhook, note.title, note.body, note.link)
                row.status, row.sent_at, row.error = (
                    ("sent", utcnow(), "") if sent else ("skipped", None, "invalid_webhook")
                )
            except ChannelError as exc:
                row.status, row.error = "failed", str(exc)[:200]
                failures.append(f"wecom:{exc}")
    for member in members:
        if not wants(db, member.id, note.company_id, note.kind, "email"):
            continue
        row = _delivery(db, note.id, note.company_id, member.id, "email")
        if row.status in ("sent", "skipped"):
            continue
        row.attempts += 1
        try:
            sent = await send_email(
                member.email, note.title, f"{note.body}\n\n{get_settings().public_base_url.rstrip('/')}{note.link}"
            )
            row.status, row.sent_at, row.error = ("sent", utcnow(), "") if sent else ("skipped", None, "not_configured")
        except ChannelError as exc:
            row.status, row.error = "failed", str(exc)[:200]
            failures.append(f"email:{exc}")
    if failures:
        # 记录失败状态后提交，再让任务表按退避重试（已成功的渠道不会重复发送）
        db.commit()
        raise RetryableJobError(", ".join(failures)[:500])
