"""官网询盘：公开接口的校验、限流、蜜罐、人机校验与垃圾评分；新询盘通知企业成员。"""

from __future__ import annotations

import re
from datetime import timedelta
from typing import Protocol

from pydantic import BaseModel, EmailStr, Field, ValidationError, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import utcnow
from app.core.security.ssrf import safe_fetch
from app.modules.sites.models import Notification, Site, SiteInquiry

PER_SITE_WINDOW = timedelta(minutes=10)
PER_SITE_LIMIT = 5
PER_IP_DAILY_LIMIT = 20


class InquiryForm(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    email: EmailStr
    company_name: str = Field(default="", max_length=150)
    country: str = Field(default="", max_length=80)
    product_ref: str = Field(default="", max_length=200)
    message: str = Field(min_length=10, max_length=3000)
    website: str = Field(default="", max_length=200)  # 蜜罐：真实用户看不到，必须为空

    @field_validator("name", "company_name", "country", "product_ref", "message")
    @classmethod
    def _clean(cls, value: str) -> str:
        return "".join(ch for ch in value if ch in "\n\t" or ord(ch) >= 32).strip()


class HumanVerifier(Protocol):
    async def verify(self, token: str, ip: str) -> bool: ...


class NoopVerifier:
    """未配置人机校验时只依赖限流与蜜罐。"""

    async def verify(self, token: str, ip: str) -> bool:
        return True


class FakeVerifier:
    async def verify(self, token: str, ip: str) -> bool:
        return token != "fail"  # noqa: S105 - 测试用假实现


class TurnstileVerifier:
    URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

    def __init__(self, secret: str) -> None:
        self.secret = secret

    async def verify(self, token: str, ip: str) -> bool:
        from urllib.parse import urlencode

        if not token:
            return False
        body = urlencode({"secret": self.secret, "response": token, "remoteip": ip}).encode()
        try:
            result = await safe_fetch(
                self.URL,
                method="POST",
                content=body,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                max_bytes=10_000,
            )
            import json

            return bool(json.loads(result.content).get("success"))
        except Exception:
            return False


def verifier() -> HumanVerifier:
    settings = get_settings()
    if settings.test_mode:
        return FakeVerifier()
    if settings.turnstile_secret:
        return TurnstileVerifier(settings.turnstile_secret.get_secret_value())
    return NoopVerifier()


class InquiryRejected(Exception):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason  # invalid / limited / spam / captcha


def parse_form(data: dict[str, str]) -> InquiryForm:
    try:
        return InquiryForm.model_validate(data)
    except ValidationError as exc:
        raise InquiryRejected("invalid") from exc


def rate_limited(db: Session, site: Site, ip_hash: str) -> bool:
    now = utcnow()
    recent_site = (
        db.scalar(
            select(func.count())
            .select_from(SiteInquiry)
            .where(
                SiteInquiry.site_id == site.id,
                SiteInquiry.ip_hash == ip_hash,
                SiteInquiry.created_at > now - PER_SITE_WINDOW,
            )
        )
        or 0
    )
    daily = (
        db.scalar(
            select(func.count())
            .select_from(SiteInquiry)
            .where(SiteInquiry.ip_hash == ip_hash, SiteInquiry.created_at > now - timedelta(days=1))
        )
        or 0
    )
    return recent_site >= PER_SITE_LIMIT or daily >= PER_IP_DAILY_LIMIT


_URL = re.compile(r"https?://|www\.", re.I)
_SPAM_WORDS = re.compile(r"\b(casino|viagra|crypto|seo service|backlinks?|loan|bitcoin)\b", re.I)


def spam_score(form: InquiryForm) -> int:
    score = 0
    links = len(_URL.findall(form.message))
    score += min(links, 5) * 15
    if _SPAM_WORDS.search(form.message):
        score += 40
    if form.message.isupper() and len(form.message) > 30:
        score += 10
    if len(set(form.message)) < 8:
        score += 20
    return min(score, 100)


def notify_members(db: Session, site: Site, inquiry: SiteInquiry) -> None:
    title = f"新询盘：{inquiry.company_name or inquiry.name}"
    body = f"{inquiry.country} · {inquiry.product_ref}".strip(" ·")[:200] or inquiry.message[:120]
    db.add(
        Notification(
            company_id=site.company_id,
            kind="site_inquiry",
            title=title[:120],
            body=body,
            link=f"/site/inquiries/{inquiry.id}",
        )
    )


async def submit(
    db: Session, site: Site, data: dict[str, str], *, ip: str, ip_hash: str, user_agent: str, captcha_token: str
) -> SiteInquiry:
    if data.get("website"):
        raise InquiryRejected("spam")
    form = parse_form(data)
    if rate_limited(db, site, ip_hash):
        raise InquiryRejected("limited")
    if not await verifier().verify(captcha_token, ip):
        raise InquiryRejected("captcha")
    score = spam_score(form)
    inquiry = SiteInquiry(
        site_id=site.id,
        company_id=site.company_id,
        name=form.name,
        email=str(form.email),
        company_name=form.company_name,
        country=form.country,
        product_ref=form.product_ref,
        message=form.message,
        ip_hash=ip_hash,
        user_agent=user_agent[:255],
        spam_score=score,
        status="spam" if score >= 60 else "new",
    )
    db.add(inquiry)
    db.flush()
    if inquiry.status == "new":
        notify_members(db, site, inquiry)
    return inquiry
