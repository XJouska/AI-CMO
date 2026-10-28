"""计划 07：审计日志、运营工作台、套餐与限额、支付回调、通知投递、合规、可观测性、数据保留。"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from freezegun import freeze_time
from sqlalchemy import select

from app.core.jobs import Job, run_pending
from app.core.providers import providers
from app.modules.admin.models import (
    AuditLog,
    CompanyChannel,
    DataRequest,
    Invoice,
    NotificationDelivery,
    PaymentOrder,
    Subscription,
    UsageRecord,
)
from app.modules.billing import service as billing
from app.modules.billing.payments import FakeGateway
from app.modules.leads.models import Buyer, Lead
from app.modules.sites.models import Notification
from app.services.fetcher import FakeWebhook
from tests.factories import add_member, complete_profile, make_product, make_session, make_tenant, make_user

WECOM = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=secret-key-123"


@pytest.fixture
def tenant(db):
    t = make_tenant(db)
    complete_profile(db, t.company)
    make_product(db, t.company, name_en="Ball Valve", keywords_en=["ball valve"])
    return t


@pytest.fixture
def staff(db):
    user = make_user(db, is_staff=True)
    return user, {"Authorization": f"Bearer {make_session(db, user)}"}


def set_plan(db, company_id, plan_key, **overrides):
    billing.ensure_plans(db)
    for sub in db.scalars(select(Subscription).where(Subscription.company_id == company_id)).all():
        sub.status = "canceled"
    db.add(
        Subscription(
            company_id=company_id,
            plan_key=plan_key,
            ends_at=datetime.now(UTC) + timedelta(days=30),
            source="manual",
            limit_overrides=overrides,
        )
    )
    db.flush()


# ── 套餐与限额 ─────────────────────────────────────────────────────────


def test_new_company_gets_trial(client, db) -> None:
    owner = make_user(db)
    headers = {"Authorization": f"Bearer {make_session(db, owner)}"}
    company = client.post("/api/v1/companies", json={"name_cn": "新工厂", "name_en": ""}, headers=headers).json()
    usage = client.get("/api/v1/billing/usage", headers={**headers, "X-Company-Id": company["id"]}).json()
    assert usage["plan"]["key"] == "trial" and usage["status"] == "active" and usage["source"] == "trial"
    assert {u["kind"] for u in usage["usage"]} == set(billing.QUOTA_LABELS)
    plans = client.get("/api/v1/billing/plans", headers={**headers, "X-Company-Id": company["id"]}).json()
    assert [p["key"] for p in plans] == ["growth", "managed", "site"] or {p["key"] for p in plans} == {
        "site",
        "growth",
        "managed",
    }


def test_legacy_company_without_subscription_gets_trial(db, tenant) -> None:
    ent = billing.entitlement(db, tenant.company.id)
    assert ent.plan.key == "trial" and not ent.expired
    assert billing.entitlement(db, tenant.company.id).subscription.id == ent.subscription.id  # 只开一次


def test_feature_gating_by_plan(client, db, tenant) -> None:
    set_plan(db, tenant.company.id, "site")
    watch = client.post("/api/v1/watches", json={"name": "x", "keywords_en": ["valve"]}, headers=tenant.headers).json()
    r = client.post(f"/api/v1/watches/{watch['id']}/run", headers=tenant.headers)
    assert r.status_code == 402 and r.json()["error"]["code"] == "feature_unavailable"
    assert "商机监控" in r.json()["error"]["message"]
    lead = Lead(company_id=tenant.company.id, type="rfq", title="x", review_status="approved")
    db.add(lead)
    db.flush()
    r = client.post(f"/api/v1/leads/{lead.id}/drafts", json={}, headers=tenant.headers)
    assert r.json()["error"]["code"] == "feature_unavailable"


def test_expired_subscription_blocks_with_clear_message(client, db, tenant) -> None:
    billing.ensure_plans(db)
    db.add(
        Subscription(
            company_id=tenant.company.id,
            plan_key="growth",
            starts_at=datetime.now(UTC) - timedelta(days=60),
            ends_at=datetime.now(UTC) - timedelta(days=1),
        )
    )
    db.flush()
    r = client.post("/api/v1/site/generate", json={}, headers=tenant.headers)
    assert r.status_code == 402 and r.json()["error"]["code"] == "subscription_expired"
    assert client.get("/api/v1/billing/usage", headers=tenant.headers).json()["status"] == "expired"


def test_quota_exceeded_for_watch_runs_and_leads(client, db, tenant) -> None:
    set_plan(db, tenant.company.id, "growth", watch_runs=1, leads=1)
    watch = client.post(
        "/api/v1/watches",
        json={"name": "x", "keywords_en": ["ball valve"], "markets": ["Germany"]},
        headers=tenant.headers,
    ).json()
    assert client.post(f"/api/v1/watches/{watch['id']}/run", headers=tenant.headers).status_code == 202
    run_pending(db)
    leads = db.scalars(select(Lead).where(Lead.company_id == tenant.company.id)).all()
    assert len(leads) == 1  # 商机上限 1：其余跳过
    from app.modules.leads.models import WatchRun

    run = db.scalar(select(WatchRun).where(WatchRun.watch_id == uuid.UUID(watch["id"])))
    assert run.stats.get("quota_skipped", 0) >= 1
    with freeze_time(datetime.now(UTC) + timedelta(hours=1)):  # 绕过手动运行冷却
        r = client.post(f"/api/v1/watches/{watch['id']}/run", headers=tenant.headers)
    assert r.status_code == 402 and r.json()["error"]["code"] == "quota_exceeded"
    assert r.json()["error"]["details"] == {"kind": "watch_runs", "limit": 1, "used": 1}
    usage = {u["kind"]: u for u in client.get("/api/v1/billing/usage", headers=tenant.headers).json()["usage"]}
    assert usage["leads"]["used"] == 1 and usage["watch_runs"]["used"] == 1
    assert usage["llm_tokens"]["used"] > 0  # 流水线 LLM 调用计入用量


def test_scheduled_run_fails_cleanly_when_feature_missing(db, tenant) -> None:
    from app.modules.leads import pipeline
    from app.modules.leads.models import Watch, WatchRun

    set_plan(db, tenant.company.id, "site")
    watch = Watch(company_id=tenant.company.id, name="x", keywords_en=["valve"])
    db.add(watch)
    db.flush()
    pipeline.start_run(db, watch, "schedule")
    run_pending(db)
    run = db.scalar(select(WatchRun).where(WatchRun.watch_id == watch.id))
    assert run.status == "failed" and "商机监控" in run.error
    assert watch.next_run_at is not None


def test_llm_usage_metered_for_assistant_and_drafts(client, db, tenant) -> None:
    from tests.test_assistant import new_conversation, send

    send(client, tenant, new_conversation(client, tenant), "你好")
    records = db.scalars(
        select(UsageRecord).where(UsageRecord.company_id == tenant.company.id, UsageRecord.kind == "llm_tokens")
    ).all()
    assert records and records[0].detail["task"] == "assistant.chat"
    lead = Lead(company_id=tenant.company.id, type="rfq", title="RFQ ball valves", review_status="approved")
    db.add(lead)
    db.flush()
    client.post(f"/api/v1/leads/{lead.id}/drafts", json={}, headers=tenant.headers)
    tasks = {
        r.detail["task"]
        for r in db.scalars(
            select(UsageRecord).where(UsageRecord.company_id == tenant.company.id, UsageRecord.kind == "llm_tokens")
        )
    }
    assert "outreach.draft" in tasks


def test_email_quota(client, db, tenant) -> None:
    from tests.test_outreach import bind_account, make_lead, new_draft, send

    set_plan(db, tenant.company.id, "growth", emails_sent=1)
    account = bind_account(client, tenant).json()["id"]
    first = new_draft(client, tenant, make_lead(db, tenant))
    second = new_draft(client, tenant, make_lead(db, tenant))
    assert send(client, tenant, first, account).status_code == 200
    r = send(client, tenant, second, account)
    assert r.status_code == 402 and r.json()["error"]["code"] == "quota_exceeded"
    assert db.scalar(select(AuditLog).where(AuditLog.action == "email.send")).detail["to"]


# ── 手工开通与支付 ─────────────────────────────────────────────────────


def test_manual_activation_with_invoice(client, db, tenant, staff) -> None:
    user, headers = staff
    r = client.post(
        f"/api/v1/ops/companies/{tenant.company.id}/subscription",
        json={
            "plan_key": "growth",
            "note": "对公转账 2026-10-28",
            "invoice_amount_cents": 199900,
            "limit_overrides": {"leads": 500},
        },
        headers=headers,
    )
    assert r.status_code == 201, r.text
    usage = client.get("/api/v1/billing/usage", headers=tenant.headers).json()
    assert usage["plan"]["key"] == "growth" and usage["source"] == "manual"
    assert next(u for u in usage["usage"] if u["kind"] == "leads")["limit"] == 500
    invoices = client.get("/api/v1/billing/invoices", headers=tenant.headers).json()
    assert invoices[0]["status"] == "paid" and invoices[0]["amount_cents"] == 199900
    log = db.scalar(select(AuditLog).where(AuditLog.action == "subscription.activate"))
    assert log.actor_user_id == user.id and log.company_id == tenant.company.id and log.ip_hash

    # 续期同套餐：从原到期日顺延
    first_end = datetime.fromisoformat(usage["ends_at"])
    client.post(f"/api/v1/ops/companies/{tenant.company.id}/subscription", json={"plan_key": "growth"}, headers=headers)
    renewed = datetime.fromisoformat(client.get("/api/v1/billing/usage", headers=tenant.headers).json()["ends_at"])
    assert renewed - first_end >= timedelta(days=30)

    bad = client.post(
        f"/api/v1/ops/companies/{tenant.company.id}/subscription",
        json={"plan_key": "growth", "limit_overrides": {"bogus": 1}},
        headers=headers,
    )
    assert bad.json()["error"]["code"] == "invalid_limit"
    past = client.post(
        f"/api/v1/ops/companies/{tenant.company.id}/subscription",
        json={"plan_key": "growth", "ends_at": "2020-01-01"},
        headers=headers,
    )
    assert past.json()["error"]["code"] == "invalid_ends_at"
    assert (
        client.post(
            f"/api/v1/ops/companies/{uuid.uuid4()}/subscription", json={"plan_key": "growth"}, headers=headers
        ).status_code
        == 404
    )

    r = client.patch(
        f"/api/v1/ops/invoices/{invoices[0]['id']}", json={"status": "void", "note": "重开"}, headers=headers
    )
    assert r.json()["status"] == "void"


def _notify(
    client, order_id: str, amount: int, trade_no: str = "T1", status: str = "paid", signature: str | None = None
):
    body = json.dumps({"order_id": order_id, "trade_no": trade_no, "amount_cents": amount, "status": status}).encode()
    sig = signature if signature is not None else FakeGateway().sign(body)
    return client.post(
        "/api/v1/public/payments/fake/notify",
        content=body,
        headers={"X-Signature": sig, "Content-Type": "application/json"},
    )


def test_online_payment_verifies_signature_amount_and_is_idempotent(client, db, tenant) -> None:
    r = client.post("/api/v1/billing/checkout", json={"plan_key": "growth", "provider": "fake"}, headers=tenant.headers)
    order = r.json()
    assert r.status_code == 201 and order["amount_cents"] == 199900 and order["pay_url"].endswith(order["order_id"])

    assert _notify(client, order["order_id"], 199900, signature="0" * 64).json()["error"]["code"] == "bad_signature"
    assert _notify(client, order["order_id"], 100).json()["error"]["code"] == "amount_mismatch"  # 金额以服务端订单为准
    assert db.scalar(select(AuditLog).where(AuditLog.action == "payment.amount_mismatch")) is not None
    assert client.get("/api/v1/billing/usage", headers=tenant.headers).json()["plan"]["key"] == "trial"

    assert _notify(client, order["order_id"], 199900).json() == {"status": "ok"}
    assert _notify(client, order["order_id"], 199900).json() == {"status": "ok"}  # 重复回调
    assert _notify(client, order["order_id"], 199900, trade_no="T2").json() == {"status": "ok"}
    subs = db.scalars(
        select(Subscription).where(Subscription.company_id == tenant.company.id, Subscription.plan_key == "growth")
    ).all()
    assert len(subs) == 1 and subs[0].source == "online"
    assert len(db.scalars(select(Invoice).where(Invoice.company_id == tenant.company.id)).all()) == 1
    assert db.get(PaymentOrder, uuid.UUID(order["order_id"])).provider_trade_no == "T1"

    assert _notify(client, str(uuid.uuid4()), 1).status_code == 404
    assert _notify(client, "not-a-uuid", 1).status_code == 404
    assert client.post("/api/v1/public/payments/alipay/notify", content=b"{}").status_code == 404


def test_checkout_validation(client, db, tenant) -> None:
    from tests.factories import add_member

    assert (
        client.post(
            "/api/v1/billing/checkout", json={"plan_key": "trial", "provider": "fake"}, headers=tenant.headers
        ).status_code
        == 404
    )
    r = client.post(
        "/api/v1/billing/checkout", json={"plan_key": "growth", "provider": "alipay"}, headers=tenant.headers
    )
    assert r.json()["error"]["code"] == "payment_unavailable"
    member = make_user(db)
    add_member(db, tenant.company, member)
    headers = {"Authorization": f"Bearer {make_session(db, member)}", "X-Company-Id": str(tenant.company.id)}
    assert (
        client.post(
            "/api/v1/billing/checkout", json={"plan_key": "growth", "provider": "fake"}, headers=headers
        ).status_code
        == 403
    )


def test_failed_payment_notice(client, db, tenant) -> None:
    order = client.post(
        "/api/v1/billing/checkout", json={"plan_key": "growth", "provider": "fake"}, headers=tenant.headers
    ).json()
    assert _notify(client, order["order_id"], 199900, status="failed").json() == {"status": "ok"}
    assert db.get(PaymentOrder, uuid.UUID(order["order_id"])).status == "failed"


# ── 运营工作台与代客操作 ───────────────────────────────────────────────


def test_customer_list_and_detail(client, db, tenant, staff) -> None:
    _, headers = staff
    db.add_all(
        [
            Lead(
                company_id=tenant.company.id,
                type="rfq",
                title="a",
                review_status="approved",
                reviewed_at=datetime.now(UTC),
            ),
            Lead(company_id=tenant.company.id, type="rfq", title="b", review_status="pending"),
        ]
    )
    db.flush()
    rows = client.get("/api/v1/ops/customers", headers=headers).json()
    row = next(r for r in rows if r["id"] == str(tenant.company.id))
    assert row["leads_week"] == 1 and row["pending_review"] == 1 and row["plan"] == "试用版"
    assert row["last_active_at"] is not None and row["operator_joined"] is False
    found = client.get(f"/api/v1/ops/customers?q={tenant.company.name_cn}", headers=headers).json()
    assert [r["id"] for r in found] == [str(tenant.company.id)]
    assert client.get("/api/v1/ops/customers?q=不存在的企业名", headers=headers).json() == []
    detail = client.get(f"/api/v1/ops/customers/{tenant.company.id}", headers=headers).json()
    assert detail["members"][0]["role"] == "owner" and detail["usage"]["plan"]["key"] == "trial"
    assert client.get(f"/api/v1/ops/customers/{uuid.uuid4()}", headers=headers).status_code == 404


def test_operator_join_acts_on_behalf_with_audit(client, db, tenant, staff) -> None:
    user, headers = staff
    r = client.post(f"/api/v1/ops/customers/{tenant.company.id}/join", headers=headers)
    assert r.status_code == 200 and r.json()["operator_joined"] is True
    client.post(f"/api/v1/ops/customers/{tenant.company.id}/join", headers=headers)  # 幂等
    op = {**headers, "X-Company-Id": str(tenant.company.id)}
    # 代客操作：以 operator 身份发布官网等敏感操作标记为「运营代操作」
    from tests.test_outreach import bind_account

    assert bind_account(client, type("T", (), {"headers": op})()).status_code == 201
    log = db.scalar(select(AuditLog).where(AuditLog.action == "mail_account.create"))
    assert log.on_behalf is True and log.actor_user_id == user.id
    logs = client.get(f"/api/v1/ops/audit-logs?company_id={tenant.company.id}&on_behalf=true", headers=headers).json()
    assert {item["action"] for item in logs} >= {"operator.join", "mail_account.create"}
    assert (
        client.get("/api/v1/ops/audit-logs?action=operator", headers=headers).json()[0]["action"].startswith("operator")
    )
    # 运营成员不接收客户通知
    assert client.post(f"/api/v1/ops/customers/{tenant.company.id}/leave", headers=headers).status_code == 204
    assert client.post(f"/api/v1/ops/customers/{tenant.company.id}/leave", headers=headers).status_code == 404
    assert client.get("/api/v1/billing/usage", headers=op).status_code == 403


def test_operator_join_conflicts_with_regular_membership(client, db, tenant, staff) -> None:
    user, headers = staff
    add_member(db, tenant.company, user, "member")
    assert (
        client.post(f"/api/v1/ops/customers/{tenant.company.id}/join", headers=headers).json()["error"]["code"]
        == "already_member"
    )
    assert client.post(f"/api/v1/ops/customers/{uuid.uuid4()}/join", headers=headers).status_code == 404


def test_review_is_audited(client, db, tenant, staff) -> None:
    _, headers = staff
    lead = Lead(company_id=tenant.company.id, type="rfq", title="x", review_status="pending")
    db.add(lead)
    db.flush()
    client.post(f"/api/v1/ops/leads/{lead.id}/review", json={"decision": "rejected"}, headers=headers)
    log = db.scalar(select(AuditLog).where(AuditLog.action == "lead.review.rejected"))
    assert log.target_id == str(lead.id) and log.on_behalf is True


def test_member_changes_audited(client, db, tenant) -> None:
    member = make_user(db)
    add_member(db, tenant.company, member)
    client.post(f"/api/v1/companies/{tenant.company.id}/invites", json={"role": "member"}, headers=tenant.headers)
    client.delete(f"/api/v1/companies/{tenant.company.id}/members/{member.id}", headers=tenant.headers)
    actions = set(db.scalars(select(AuditLog.action).where(AuditLog.company_id == tenant.company.id)).all())
    assert {"invite.create", "member.remove"} <= actions


def test_source_monitor_and_toggle(client, db, tenant, staff) -> None:
    from app.modules.leads.models import SourceRequest

    _, headers = staff
    db.add_all(
        [
            SourceRequest(source_key="web_search", ok=True, duration_ms=100, results=4),
            SourceRequest(source_key="web_search", ok=False, duration_ms=300, error="HTTP 429"),
        ]
    )
    db.flush()
    rows = client.get("/api/v1/ops/sources", headers=headers).json()
    row = next(r for r in rows if r["source_key"] == "web_search")
    assert row["requests"] >= 2 and row["blocked"] >= 1 and 0 < row["success_rate"] < 1
    r = client.patch("/api/v1/ops/sources/web_search", json={"enabled": False}, headers=headers)
    assert r.json() == {"source_key": "web_search", "enabled": False}
    assert client.patch("/api/v1/ops/sources/unknown", json={"enabled": False}, headers=headers).status_code == 404


def test_cost_board(client, db, tenant, staff) -> None:
    from app.modules.admin.audit import record_usage

    _, headers = staff
    record_usage(db, tenant.company.id, "llm_tokens", 10_000)
    record_usage(db, tenant.company.id, "search_queries", 3)
    record_usage(db, tenant.company.id, "fetches", 0)  # 0 不记录
    db.flush()
    board = client.get("/api/v1/ops/costs?days=7", headers=headers).json()
    row = next(c for c in board["companies"] if c["company_id"] == str(tenant.company.id))
    assert row["usage"] == {"llm_tokens": 10_000, "search_queries": 3}
    assert row["cost_micros"] == 20_000 + 3 * 35_000


def test_eval_runs(client, db, staff) -> None:
    _, headers = staff
    listing = client.get("/api/v1/ops/evals", headers=headers).json()
    assert "valves_synthetic.jsonl" in listing["datasets"]
    run = client.post("/api/v1/ops/evals", json={"dataset": "valves_synthetic.jsonl"}, headers=headers).json()
    run_pending(db)
    runs = client.get("/api/v1/ops/evals", headers=headers).json()["runs"]
    done = next(r for r in runs if r["id"] == run["id"])
    assert done["status"] == "done" and done["metrics"]["intent_accuracy"] >= 0.9 and "confusion" not in done["metrics"]
    assert client.post("/api/v1/ops/evals", json={"dataset": "missing.jsonl"}, headers=headers).status_code == 404
    assert client.post("/api/v1/ops/evals", json={"dataset": "../../etc/passwd"}, headers=headers).status_code == 422


def test_eval_failure_recorded(client, db, staff, monkeypatch) -> None:
    import evals.leads

    _, headers = staff

    async def boom(*args, **kwargs):  # type: ignore[no-untyped-def]
        raise RuntimeError("broken dataset")

    monkeypatch.setattr(evals.leads, "evaluate", boom)
    run = client.post("/api/v1/ops/evals", json={}, headers=headers).json()
    run_pending(db)
    runs = client.get("/api/v1/ops/evals", headers=headers).json()["runs"]
    assert next(r for r in runs if r["id"] == run["id"])["error"].startswith("RuntimeError")


# ── 通知 ───────────────────────────────────────────────────────────────


def _deliveries(db, note_id):
    return {
        (d.user_id, d.channel): d
        for d in db.scalars(select(NotificationDelivery).where(NotificationDelivery.notification_id == note_id))
    }


def test_notification_delivery_respects_prefs(client, db, tenant, mailer) -> None:
    colleague = make_user(db)
    add_member(db, tenant.company, colleague)
    other_headers = {"Authorization": f"Bearer {make_session(db, colleague)}", "X-Company-Id": str(tenant.company.id)}
    r = client.patch(
        "/api/v1/notification-prefs",
        json={"group": "inquiry", "channel": "email", "enabled": False},
        headers=other_headers,
    )
    assert next(g for g in r.json()["groups"] if g["key"] == "inquiry")["email"] is False
    note = Notification(
        company_id=tenant.company.id,
        kind="new_inquiry",
        title="新询盘：Buyer GmbH",
        body="Please quote",
        link="/site/inquiries/x",
    )
    db.add(note)
    db.flush()
    assert db.scalar(select(Job).where(Job.kind == "notifications.deliver")) is not None
    run_pending(db)
    rows = _deliveries(db, note.id)
    assert rows[(tenant.user.id, "email")].status == "sent"
    assert (colleague.id, "email") not in rows
    assert [m["To"] for _, m in mailer.sent] == [tenant.user.email]
    assert "/site/inquiries/x" in mailer.sent[0][1].get_content()


def test_wecom_channel_encrypted_and_sent(client, db, tenant) -> None:
    fake = FakeWebhook()
    providers.set(webhook=fake)
    r = client.put("/api/v1/notification-prefs/wecom", json={"webhook": WECOM}, headers=tenant.headers)
    assert r.json()["wecom_configured"] is True and "secret-key-123" not in r.text
    row = db.get(CompanyChannel, (tenant.company.id, "wecom"))
    assert b"secret-key-123" not in row.encrypted_config
    assert "secret-key-123" not in client.get("/api/v1/profile", headers=tenant.headers).text
    for bad in (
        "https://evil.example/cgi-bin/webhook/send?key=1",
        "http://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=1",
        "https://qyapi.weixin.qq.com/other",
    ):
        assert (
            client.put("/api/v1/notification-prefs/wecom", json={"webhook": bad}, headers=tenant.headers).json()[
                "error"
            ]["code"]
            == "invalid_webhook"
        )
    db.add(
        Notification(
            company_id=tenant.company.id, kind="new_leads", title="发现 3 条新商机", body="已复核", link="/leads"
        )
    )
    db.flush()
    run_pending(db)
    url, payload = fake.sent[0]
    assert url == WECOM and "发现 3 条新商机" in json.loads(payload)["markdown"]["content"]
    assert (
        client.put("/api/v1/notification-prefs/wecom", json={"webhook": ""}, headers=tenant.headers).json()[
            "wecom_configured"
        ]
        is False
    )


def test_delivery_failure_retries_without_resending(client, db, tenant, mailer) -> None:
    from app.services.mailer import MailSendError

    fake = FakeWebhook()
    providers.set(webhook=fake)
    client.put("/api/v1/notification-prefs/wecom", json={"webhook": WECOM}, headers=tenant.headers)
    mailer.fail_with = MailSendError("connect_failed", "x")
    note = Notification(company_id=tenant.company.id, kind="new_leads", title="t", body="b", link="/leads")
    db.add(note)
    db.flush()
    run_pending(db)
    rows = _deliveries(db, note.id)
    assert (
        rows[(tenant.user.id, "email")].status == "failed" and rows[(tenant.user.id, "email")].error == "connect_failed"
    )
    job = db.scalar(select(Job).where(Job.kind == "notifications.deliver"))
    assert job.status == "queued" and job.attempts == 1
    mailer.fail_with = None
    job.run_after = datetime.now(UTC) - timedelta(seconds=1)
    db.flush()
    run_pending(db)
    assert _deliveries(db, note.id)[(tenant.user.id, "email")].status == "sent"
    assert len(fake.sent) == 1  # 企业微信第一次已成功，重试不重复发送


def test_system_notice_kinds_without_group_are_not_delivered(db, tenant) -> None:
    db.add(Notification(company_id=tenant.company.id, kind="internal_debug", title="t"))
    db.flush()
    assert db.scalar(select(Job).where(Job.kind == "notifications.deliver")) is None


def test_email_channel_skipped_when_not_configured(db, tenant, monkeypatch) -> None:
    from app.core.config import get_settings
    from app.modules.admin import notifications

    monkeypatch.setattr(get_settings(), "test_mode", False)
    assert asyncio_run(notifications.send_email("a@b.example", "s", "b")) is False
    monkeypatch.setattr(get_settings(), "system_smtp_host", "smtp.platform.example")
    from pydantic import SecretStr

    monkeypatch.setattr(get_settings(), "system_smtp_password", SecretStr("pw"))
    assert asyncio_run(notifications.send_email("a@b.example", "s", "b")) is True


def asyncio_run(coro):  # type: ignore[no-untyped-def]
    import asyncio

    return asyncio.run(coro)


def test_wecom_http_error_raises(db) -> None:
    from app.modules.admin import notifications

    fake = FakeWebhook(status_code=500)
    providers.set(webhook=fake)
    with pytest.raises(notifications.ChannelError):
        asyncio_run(notifications.send_wecom(WECOM, "t", "b", "/leads"))
    assert asyncio_run(notifications.send_wecom("https://evil.example/x", "t", "b", "")) is False


def test_prefs_validation(client, tenant) -> None:
    r = client.patch(
        "/api/v1/notification-prefs",
        json={"group": "bogus", "channel": "email", "enabled": True},
        headers=tenant.headers,
    )
    assert r.json()["error"]["code"] == "invalid_pref"
    prefs = client.get("/api/v1/notification-prefs", headers=tenant.headers).json()
    assert prefs["email"] == tenant.user.email and len(prefs["groups"]) == 5


# ── 合规 ───────────────────────────────────────────────────────────────


def test_export_json_and_csv(client, db, tenant) -> None:
    buyer = Buyer(company_id=tenant.company.id, name="=HYPERLINK(evil)", domain="b.example")
    db.add(buyer)
    db.flush()
    db.add(
        Lead(
            company_id=tenant.company.id,
            buyer_id=buyer.id,
            type="rfq",
            title="+cmd|' /C calc'!A0",
            review_status="approved",
        )
    )
    db.flush()
    r = client.get("/api/v1/compliance/export", headers=tenant.headers)
    assert r.status_code == 200 and "attachment" in r.headers["content-disposition"]
    data = r.json()
    assert data["company"]["id"] == str(tenant.company.id) and data["leads"][0]["title"].startswith("+cmd")
    assert "password" not in r.text and "token_hash" not in r.text
    csv_text = client.get("/api/v1/compliance/export?format=csv", headers=tenant.headers).text
    assert "'+cmd" in csv_text and "'=HYPERLINK" in csv_text  # CSV 公式注入防护
    assert (
        client.get("/api/v1/compliance/export?format=xml", headers=tenant.headers).json()["error"]["code"]
        == "invalid_format"
    )
    assert db.scalar(select(AuditLog).where(AuditLog.action == "data.export")) is not None
    member = make_user(db)
    add_member(db, tenant.company, member)
    headers = {"Authorization": f"Bearer {make_session(db, member)}", "X-Company-Id": str(tenant.company.id)}
    assert client.get("/api/v1/compliance/export", headers=headers).status_code == 403


def test_delete_company(client, db, tenant, storage) -> None:
    from app.modules.companies.models import Company, Product
    from tests.factories import make_asset

    asset = make_asset(db, tenant.company)
    storage_key = asset.storage_key
    storage.put(storage_key, b"x")
    company_id = tenant.company.id
    r = client.post(
        "/api/v1/compliance/delete-company",
        json={"confirm": "DELETE", "company_name": "错误名称"},
        headers=tenant.headers,
    )
    assert r.json()["error"]["code"] == "confirmation_mismatch"
    r = client.post(
        "/api/v1/compliance/delete-company",
        json={"confirm": "DELETE", "company_name": tenant.company.name_cn},
        headers=tenant.headers,
    )
    assert r.status_code == 204
    db.expire_all()
    assert db.get(Company, company_id) is None
    assert db.scalars(select(Product).where(Product.company_id == company_id)).all() == []
    with pytest.raises((FileNotFoundError, KeyError)):
        storage.get(storage_key)
    log = db.scalar(select(AuditLog).where(AuditLog.action == "company.delete"))
    assert log.target_id == str(company_id) and log.company_id is None


def test_contact_erasure_request_flow(client, db, tenant, staff) -> None:
    _, headers = staff
    buyer = Buyer(
        company_id=tenant.company.id,
        name="B",
        domain="b.example",
        public_contacts={"emails": ["Jane@B.example", "sales@b.example"]},
    )
    db.add(buyer)
    db.flush()
    assert client.post("/api/v1/public/data-requests", json={"email": "jane@b.example", "note": "请删除"}).json() == {
        "status": "received"
    }
    assert client.post("/api/v1/public/data-requests", json={"email": "bot@x.example", "website": "spam"}).json() == {
        "status": "received"
    }
    assert db.scalar(select(DataRequest).where(DataRequest.email == "bot@x.example")) is None  # 蜜罐
    assert (
        client.post("/api/v1/public/data-requests", json={"email": "not-email"}).json()["error"]["code"]
        == "invalid_email"
    )
    item = client.get("/api/v1/ops/data-requests", headers=headers).json()[0]
    r = client.post(f"/api/v1/ops/data-requests/{item['id']}", json={"decision": "done"}, headers=headers)
    assert r.json()["result"]["buyers"] == 1
    db.refresh(buyer)
    assert buyer.public_contacts["emails"] == ["sales@b.example"]
    from app.modules.outreach.service import is_suppressed

    assert is_suppressed(db, tenant.company.id, "jane@b.example")
    assert (
        client.post(f"/api/v1/ops/data-requests/{item['id']}", json={"decision": "done"}, headers=headers).json()[
            "error"
        ]["code"]
        == "already_handled"
    )
    assert (
        client.post(f"/api/v1/ops/data-requests/{uuid.uuid4()}", json={"decision": "done"}, headers=headers).status_code
        == 404
    )


def test_contact_erasure_rate_limit(client) -> None:
    for i in range(5):
        assert client.post("/api/v1/public/data-requests", json={"email": f"u{i}@x.example"}).status_code == 202
    assert client.post("/api/v1/public/data-requests", json={"email": "u9@x.example"}).status_code == 429


def test_policies(client) -> None:
    assert client.get("/api/v1/public/policies").json()["privacy"] == "/privacy"


# ── 可观测性与保留 ─────────────────────────────────────────────────────


def test_metrics_endpoint(client, db, monkeypatch) -> None:
    from pydantic import SecretStr

    from app.core.config import get_settings

    client.get("/api/v1/meta")
    r = client.get("/metrics")  # TestClient 来源 testclient：非内网 IP
    assert r.status_code == 403
    monkeypatch.setattr(get_settings(), "metrics_token", SecretStr("m-token"))
    assert client.get("/metrics", headers={"Authorization": "Bearer wrong"}).status_code == 403
    r = client.get("/metrics", headers={"Authorization": "Bearer m-token"})
    assert r.status_code == 200
    assert 'aicmo_http_requests_total{method="GET",route="/api/v1/meta",status="2xx"}' in r.text
    assert (
        "aicmo_jobs_backlog" in r.text and "aicmo_worker_heartbeat_age_seconds" in r.text and "aicmo_db_up 1" in r.text
    )
    assert "/api/v1/leads/" not in r.text.replace("{lead_id}", "")  # 只使用路由模板


def test_metrics_internal_access_and_unmatched_route(monkeypatch) -> None:
    from app.core.config import get_settings
    from app.core.observability import Metrics, metrics_allowed

    assert metrics_allowed("10.0.0.3", "") and metrics_allowed("127.0.0.1", "")
    monkeypatch.setattr(get_settings(), "app_env", "production")
    assert not metrics_allowed("10.0.0.3", "")  # 生产环境必须使用令牌
    monkeypatch.setattr(get_settings(), "app_env", "test")
    assert (
        not metrics_allowed("8.8.8.8", "") and not metrics_allowed(None, "") and not metrics_allowed("testclient", "")
    )
    m = Metrics()
    m.observe("GET", "unmatched", 404, 0.01)
    m.inc("sse_aborted")
    text = "\n".join(m.render())
    assert 'route="unmatched",status="4xx"' in text and "aicmo_sse_aborted_total 1" in text
    m.reset()
    assert "unmatched" not in "\n".join(m.render())


def test_alert_checks(db) -> None:
    from app.core.observability import alert_checks
    from app.modules.admin.models import WorkerHeartbeat
    from app.modules.leads.models import SourceRequest

    db.add(Job(kind="x", payload={}, run_after=datetime.now(UTC) - timedelta(minutes=30)))
    db.add_all([SourceRequest(source_key="bad_src", ok=False) for _ in range(10)])
    db.flush()
    alerts = alert_checks(db)
    assert any("任务积压" in a for a in alerts)
    assert any("bad_src" in a for a in alerts)
    assert any("心跳" in a for a in alerts)
    db.add(WorkerHeartbeat(worker_id="w1", beat_at=datetime.now(UTC)))
    db.flush()
    assert not any("心跳" in a for a in alert_checks(db))


def test_retention_purge(db, tenant) -> None:
    from app.modules.admin.retention import purge_expired
    from app.modules.auth.models import LoginAttempt
    from app.modules.leads.models import SourceRequest

    old = datetime.now(UTC) - timedelta(days=500)
    db.add_all(
        [
            LoginAttempt(ip_hash="x", created_at=old),
            SourceRequest(source_key="s", created_at=old),
            Job(kind="x", payload={}, status="done", finished_at=old),
            UsageRecord(company_id=tenant.company.id, kind="leads", created_at=old),
            UsageRecord(company_id=tenant.company.id, kind="leads"),
        ]
    )
    db.flush()
    assert purge_expired(db) >= 4
    assert len(db.scalars(select(UsageRecord).where(UsageRecord.company_id == tenant.company.id)).all()) == 1


def test_worker_heartbeat(monkeypatch, engine) -> None:
    from sqlalchemy.orm import Session

    from app.core.jobs import WORKER_ID
    from app.modules.admin.models import WorkerHeartbeat
    from app.workers import __main__ as worker

    worker.beat()
    worker.beat()
    with Session(engine) as session:
        row = session.get(WorkerHeartbeat, WORKER_ID)
        assert row is not None
        session.delete(row)
        session.commit()


def test_tls_ask(client, db, tenant, monkeypatch) -> None:
    from app.core.config import get_settings
    from app.modules.sites import router as sites_router
    from app.modules.sites.models import Site

    base = get_settings().sites_base_domain
    db.add(
        Site(
            company_id=tenant.company.id,
            subdomain="demo-valve",
            custom_domain="www.demo-valve.example",
            domain_verified=True,
            status="published",
        )
    )
    db.flush()
    url = "/api/v1/public/internal/tls-ask"
    assert client.get(url, params={"domain": "www.demo-valve.example"}).status_code == 403  # testclient 非内网来源

    class Client:
        host = "172.18.0.5"

    real = sites_router.Request.client
    monkeypatch.setattr(sites_router.Request, "client", property(lambda self: Client()))
    try:
        assert client.get(url, params={"domain": "WWW.demo-valve.example."}).status_code == 200
        assert client.get(url, params={"domain": f"demo-valve.{base}"}).status_code == 200
        assert client.get(url, params={"domain": "evil.example"}).status_code == 404
        assert client.get(url, params={"domain": f"unknown.{base}"}).status_code == 404
    finally:
        monkeypatch.setattr(sites_router.Request, "client", real)


def test_delete_company_purges_published_site_files(client, db, tenant, monkeypatch, tmp_path) -> None:
    """注销后：官网 live 链接与全部已构建版本（HTML、图片）都从磁盘删除。"""
    from app.core.config import get_settings
    from app.modules.sites import render, service
    from app.modules.sites.models import Site

    monkeypatch.setattr(get_settings(), "sites_output_dir", str(tmp_path))
    site = Site(company_id=tenant.company.id, subdomain=f"purge{uuid.uuid4().hex[:6]}", status="published")
    db.add(site)
    db.flush()
    version_dir = render.write_version(
        site.id,
        uuid.uuid4(),
        {"index.html": "<h1>secret</h1>"},
        {f"{uuid.uuid4().hex}-640.webp": b"x"},
        "https://x.example/",
    )
    render.activate(service.site_hosts(site), version_dir)
    live = tmp_path / "live" / service.site_hosts(site)[0]
    site_id = site.id
    assert live.exists() and version_dir.exists()
    r = client.post(
        "/api/v1/compliance/delete-company",
        json={"confirm": "DELETE", "company_name": tenant.company.name_cn},
        headers=tenant.headers,
    )
    assert r.status_code == 204
    assert not live.exists() and not live.is_symlink()
    assert not (tmp_path / "versions" / str(site_id)).exists()


# ── 补充安全审查回归 ───────────────────────────────────────────────────


def test_assistant_blocked_when_quota_exhausted_or_expired(client, db, tenant) -> None:
    from tests.test_assistant import new_conversation

    conv = new_conversation(client, tenant)
    set_plan(db, tenant.company.id, "growth", llm_tokens=100)
    from app.modules.admin.audit import record_usage

    record_usage(db, tenant.company.id, "llm_tokens", 100)
    db.flush()
    r = client.post(f"/api/v1/assistant/conversations/{conv}/messages", json={"text": "你好"}, headers=tenant.headers)
    assert r.status_code == 402 and r.json()["error"]["code"] == "quota_exceeded"


def test_assistant_rate_limited(client, db, tenant, monkeypatch) -> None:
    from app.modules.assistant import router as assistant_router
    from tests.test_assistant import new_conversation, send

    monkeypatch.setattr(assistant_router, "MAX_TURNS_PER_MINUTE", 1)
    conv = new_conversation(client, tenant)
    send(client, tenant, conv, "你好")
    r = client.post(f"/api/v1/assistant/conversations/{conv}/messages", json={"text": "再来"}, headers=tenant.headers)
    assert r.status_code == 429


def test_site_rewrite_and_tools_respect_plan(client, db, tenant) -> None:
    from app.modules.sites import service as site_service

    set_plan(db, tenant.company.id, "growth", llm_tokens=10)
    with pytest.raises(billing.QuotaExceededError):
        site_service.start_generation(db, tenant.company, tenant.user.id)
    r = client.post("/api/v1/site/sections/hero/rewrite", json={"instruction": "更简洁"}, headers=tenant.headers)
    assert r.status_code == 402
    r = client.post(
        "/api/v1/profile/extractions/text",
        json={"text": "我们是做不锈钢球阀的工厂，成立于2008年"},
        headers=tenant.headers,
    )
    assert r.status_code in (402, 404, 405) or r.json()["error"]["code"] == "quota_exceeded"


def test_side_effect_tools_require_confirmation() -> None:
    """所有工具都声明了副作用类型；直接生效（write）的工具必须需要确认；未声明确认的 write 工具无法注册。"""
    from app.modules.assistant import all_tools  # noqa: F401
    from app.modules.assistant.tools import ToolArgs, ToolRegistry, ToolResult, registry, tool

    writes = {t.name for t in registry.tools.values() if t.side_effect == "write"}
    assert {
        "watch_update",
        "lead_run_now",
        "pipeline_update_stage",
        "outreach_send",
        "site_publish",
        "product_delete",
    } <= writes
    assert all(registry.tools[name].requires_confirmation for name in writes)
    unconfirmed = {t.name for t in registry.tools.values() if not t.requires_confirmation}
    assert all(registry.tools[n].side_effect in ("read", "draft") for n in unconfirmed)

    class A(ToolArgs):
        pass

    with pytest.raises(ValueError, match="must require confirmation"):
        tool("bad_write", description="x", args=A, label="x", side_effect="write", target=ToolRegistry())(
            lambda c, a: ToolResult(data={})
        )
    with pytest.raises(ValueError, match="unknown side_effect"):
        tool("bad_kind", description="x", args=A, label="x", side_effect="delete", target=ToolRegistry())


def test_injected_inquiry_cannot_change_watch_without_confirmation(client, db, tenant, llm) -> None:
    """外部询盘内容诱导模型调用 watch_update / pipeline_update_stage：只生成确认卡片，数据不变。"""
    from app.modules.leads.models import Watch
    from tests.test_assistant import call, new_conversation, send

    watch = Watch(company_id=tenant.company.id, name="w", keywords_en=["ball valve"])
    lead = Lead(company_id=tenant.company.id, type="rfq", title="x", review_status="approved")
    db.add_all([watch, lead])
    db.flush()
    llm.script("assistant.chat", call("watch_update", {"remove_keywords": ["ball valve"], "add_keywords": ["casino"]}))
    events = send(client, tenant, new_conversation(client, tenant), "看看询盘")
    card = next(e["data"] for e in events if e["event"] == "block.card")
    assert card["card_type"] == "confirm" and "casino" in card["payload"]["summary"]
    db.refresh(watch)
    assert watch.keywords_en == ["ball valve"]
    llm.script(
        "assistant.chat",
        call("pipeline_update_stage", {"lead_id": str(lead.id), "stage": "lost", "lost_reason": "price"}),
    )
    events = send(client, tenant, new_conversation(client, tenant), "看看询盘")
    card = next(e["data"] for e in events if e["event"] == "block.card")
    assert card["payload"]["danger"] is True
    from app.modules.outreach.models import LeadPipeline

    assert db.scalar(select(LeadPipeline).where(LeadPipeline.lead_id == lead.id)) is None


def test_concurrent_send_only_sends_once(engine, mailer) -> None:
    """同一草稿并发发送两次：只有一个请求发出邮件，另一个得到 draft_sent。"""
    import asyncio

    from sqlalchemy.orm import Session

    from app.core.deps import CompanyScope
    from app.core.errors import AppError
    from app.core.security.secrets_box import encrypt_json
    from app.modules.companies.models import Company
    from app.modules.outreach.models import MailAccount, OutreachDraft
    from app.modules.outreach.router import send_draft

    with Session(engine, expire_on_commit=False) as setup:
        t = make_tenant(setup)
        set_plan(setup, t.company.id, "growth")
        lead = Lead(company_id=t.company.id, type="rfq", title="x", review_status="approved")
        setup.add(lead)
        setup.flush()
        draft = OutreachDraft(lead_id=lead.id, company_id=t.company.id, to_email="b@b.example", subject="s", body="b")
        account = MailAccount(
            company_id=t.company.id,
            from_address="a@a.example",
            encrypted_credentials=encrypt_json(
                {"host": "smtp.a.example", "port": 465, "username": "u", "password": "p"}
            ),
            verified=True,
        )
        setup.add_all([draft, account])
        setup.commit()
        ids = (t.company.id, t.user.id, draft.id, account.id)

    original = mailer.send

    async def slow_send(creds, mail):  # type: ignore[no-untyped-def]
        await asyncio.sleep(0.3)
        return await original(creds, mail)

    mailer.send = slow_send

    async def one() -> str:
        with Session(engine, expire_on_commit=False) as session:
            company = session.get(Company, ids[0])
            from app.modules.auth.models import User

            scope = CompanyScope(company=company, user=session.get(User, ids[1]), role="owner")
            try:
                await send_draft(session, scope, session.get(OutreachDraft, ids[2]), ids[3])
                return "sent"
            except AppError as exc:
                return exc.code

    async def both() -> list[str]:
        return await asyncio.gather(*(asyncio.to_thread(asyncio.run, one()) for _ in range(2)))

    try:
        results = asyncio.run(both())
        assert sorted(results) == ["draft_sent", "sent"]
        assert len(mailer.sent) == 1
        with Session(engine) as check:
            assert check.get(OutreachDraft, ids[2]).status == "sent"
            assert billing.used_this_month(check, ids[0], "emails_sent") == 1
    finally:
        with Session(engine) as cleanup:
            cleanup.execute(Company.__table__.delete().where(Company.id == ids[0]))
            cleanup.commit()


def test_send_failure_releases_reservation(client, db, tenant, mailer) -> None:
    from app.services.mailer import MailSendError
    from tests.test_outreach import bind_account, make_lead, new_draft, send

    set_plan(db, tenant.company.id, "growth", emails_sent=1)
    account = bind_account(client, tenant).json()["id"]
    draft = new_draft(client, tenant, make_lead(db, tenant))
    mailer.fail_with = MailSendError("connect_failed", "x")
    assert send(client, tenant, draft, account).status_code == 502
    mailer.fail_with = None
    assert billing.used_this_month(db, tenant.company.id, "emails_sent") == 0  # 失败不占用额度
    assert send(client, tenant, draft, account).status_code == 200
