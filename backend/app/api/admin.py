import logging
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, cast, Date, case, distinct

from app.database import get_database, User, Session as DBSession, Conversation, Recommendation, \
    PaymentOrder, CreditTransaction, SEOHealthSnapshot, GEOVisibility, Competitor, ActivityFeed
from app.middleware.auth_middleware import require_admin

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/admin", tags=["admin"])


# ---------- helpers ----------

def _date_series(session, model_cls, date_col, days: int = 30):
    """Return [{date, count}] for the last N days."""
    since = datetime.utcnow() - timedelta(days=days)
    rows = (
        session.query(cast(date_col, Date).label("d"), func.count().label("c"))
        .filter(date_col >= since)
        .group_by("d").order_by("d").all()
    )
    return [{"date": str(r.d), "count": r.c} for r in rows]


def _today():
    return datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)


# ---------- 1. Overview ----------

@router.get("/stats/overview")
async def admin_overview(_=Depends(require_admin)):
    db = get_database()
    s = db.get_session()
    try:
        today = _today()
        yesterday = today - timedelta(days=1)
        week_ago = today - timedelta(days=7)

        total_users = s.query(func.count(User.id)).scalar() or 0
        users_today = s.query(func.count(User.id)).filter(User.created_at >= today).scalar() or 0
        users_yesterday = s.query(func.count(User.id)).filter(
            User.created_at >= yesterday, User.created_at < today
        ).scalar() or 0

        total_analyses = s.query(func.count(Conversation.id)).scalar() or 0
        analyses_today = s.query(func.count(Conversation.id)).filter(Conversation.created_at >= today).scalar() or 0
        analyses_yesterday = s.query(func.count(Conversation.id)).filter(
            Conversation.created_at >= yesterday, Conversation.created_at < today
        ).scalar() or 0

        total_revenue = s.query(func.coalesce(func.sum(PaymentOrder.amount), 0)).filter(
            PaymentOrder.status == "paid"
        ).scalar()
        revenue_today = s.query(func.coalesce(func.sum(PaymentOrder.amount), 0)).filter(
            PaymentOrder.status == "paid", PaymentOrder.paid_at >= today
        ).scalar()

        total_credits_consumed = s.query(
            func.coalesce(func.sum(func.abs(CreditTransaction.amount)), 0)
        ).filter(CreditTransaction.type == "consume").scalar()

        active_7d = s.query(func.count(distinct(Conversation.user_id))).filter(
            Conversation.created_at >= week_ago
        ).scalar() or 0

        # Trends (30 days)
        reg_trend = _date_series(s, User, User.created_at, 30)
        analysis_trend = _date_series(s, Conversation, Conversation.created_at, 30)

        since_30d = datetime.utcnow() - timedelta(days=30)
        rev_rows = (
            s.query(cast(PaymentOrder.paid_at, Date).label("d"), func.sum(PaymentOrder.amount).label("amt"))
            .filter(PaymentOrder.status == "paid", PaymentOrder.paid_at >= since_30d)
            .group_by("d").order_by("d").all()
        )
        revenue_trend = [{"date": str(r.d), "amount": float(r.amt or 0)} for r in rev_rows]

        plat_rows = (
            s.query(Recommendation.platform, func.count().label("c"))
            .group_by(Recommendation.platform).order_by(func.count().desc()).limit(10).all()
        )
        platform_dist = [{"platform": r.platform, "count": r.c} for r in plat_rows]

        return {
            "kpi": {
                "total_users": total_users,
                "users_today": users_today,
                "users_yesterday": users_yesterday,
                "total_analyses": total_analyses,
                "analyses_today": analyses_today,
                "analyses_yesterday": analyses_yesterday,
                "total_revenue": float(total_revenue),
                "revenue_today": float(revenue_today),
                "total_credits_consumed": int(total_credits_consumed),
                "active_7d": active_7d,
            },
            "trends": {
                "registrations": reg_trend,
                "analyses": analysis_trend,
                "revenue": revenue_trend,
            },
            "platform_distribution": platform_dist,
        }
    finally:
        s.close()


# ---------- 2. Users ----------

@router.get("/users")
async def admin_users(
    search: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    _=Depends(require_admin),
):
    db = get_database()
    s = db.get_session()
    try:
        q = s.query(
            User.id, User.username, User.email, User.credit_balance,
            User.is_premium, User.is_admin, User.is_active, User.created_at,
            User.country, User.last_login_at,
            func.count(Conversation.id).label("analysis_count"),
        ).outerjoin(Conversation, Conversation.user_id == User.id).group_by(User.id)

        if search:
            like = f"%{search}%"
            q = q.filter((User.username.ilike(like)) | (User.email.ilike(like)))

        total = q.count()
        rows = q.order_by(User.id.desc()).offset((page - 1) * limit).limit(limit).all()

        users = []
        for r in rows:
            users.append({
                "id": r.id, "username": r.username, "email": r.email,
                "credit_balance": r.credit_balance, "is_premium": r.is_premium,
                "is_admin": r.is_admin, "is_active": r.is_active,
                "analysis_count": r.analysis_count,
                "country": r.country or "",
                "last_login_at": r.last_login_at.isoformat() if r.last_login_at else None,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            })

        return {"users": users, "total": total, "page": page, "limit": limit}
    finally:
        s.close()


class CreditAdjust(BaseModel):
    amount: int
    reason: str = "Admin adjustment"


@router.put("/users/{user_id}/credits")
async def admin_adjust_credits(user_id: int, body: CreditAdjust, admin=Depends(require_admin)):
    db = get_database()
    s = db.get_session()
    try:
        user = s.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        new_balance = user.credit_balance + body.amount
        if new_balance < 0:
            raise HTTPException(status_code=400, detail="Balance cannot go below 0")
        user.credit_balance = new_balance
        tx = CreditTransaction(
            user_id=user_id,
            type="recharge" if body.amount > 0 else "consume",
            amount=body.amount,
            balance_after=new_balance,
            description=f"[Admin] {body.reason} (by {admin['username']})",
        )
        s.add(tx)
        s.commit()
        logger.info(f"[Admin] Credits adjusted for user {user_id}: {body.amount:+d} -> {new_balance} by {admin['username']}")
        return {"success": True, "new_balance": new_balance}
    except HTTPException:
        raise
    except Exception as e:
        s.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        s.close()


@router.get("/users/stats")
async def admin_users_stats(_=Depends(require_admin)):
    """User overview stats: paid ratio, country distribution, etc."""
    db = get_database()
    s = db.get_session()
    try:
        total = s.query(func.count(User.id)).scalar() or 0
        premium_count = s.query(func.count(User.id)).filter(User.is_premium == True).scalar() or 0

        # Users who have ever paid (have at least 1 paid order)
        paid_user_ids = s.query(distinct(PaymentOrder.user_id)).filter(PaymentOrder.status == "paid")
        paid_count = s.query(func.count(distinct(PaymentOrder.user_id))).filter(PaymentOrder.status == "paid").scalar() or 0

        # Country distribution
        country_rows = (
            s.query(
                func.coalesce(User.country, 'Unknown').label("c"),
                func.count().label("n"),
            )
            .group_by("c").order_by(func.count().desc()).limit(20).all()
        )
        countries = [{"country": r.c or "Unknown", "count": r.n} for r in country_rows]

        # Registration trend (last 30 days)
        today = _today()
        week_ago = today - timedelta(days=7)
        month_ago = today - timedelta(days=30)

        reg_today = s.query(func.count(User.id)).filter(User.created_at >= today).scalar() or 0
        reg_week = s.query(func.count(User.id)).filter(User.created_at >= week_ago).scalar() or 0
        reg_month = s.query(func.count(User.id)).filter(User.created_at >= month_ago).scalar() or 0

        # Response language distribution
        lang_rows = (
            s.query(User.response_language, func.count().label("n"))
            .group_by(User.response_language).order_by(func.count().desc()).all()
        )
        languages = [{"language": r.response_language or "en", "count": r.n} for r in lang_rows]

        # Average credits per user
        avg_credits = s.query(func.avg(User.credit_balance)).scalar() or 0

        # Total credits purchased
        total_purchased = s.query(func.coalesce(func.sum(CreditTransaction.amount), 0)).filter(
            CreditTransaction.type == "recharge"
        ).scalar()

        return {
            "total_users": total,
            "premium_count": premium_count,
            "paid_count": paid_count,
            "paid_ratio": round(paid_count / total * 100, 1) if total else 0,
            "reg_today": reg_today,
            "reg_week": reg_week,
            "reg_month": reg_month,
            "avg_credits": round(float(avg_credits), 1),
            "total_credits_purchased": int(total_purchased),
            "countries": countries,
            "languages": languages,
        }
    finally:
        s.close()


@router.get("/users/{user_id}/detail")
async def admin_user_detail(user_id: int, _=Depends(require_admin)):
    """Detailed user profile with credit transactions and analysis history."""
    db = get_database()
    s = db.get_session()
    try:
        user = s.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        # Basic info
        info = {
            "id": user.id, "username": user.username, "email": user.email,
            "credit_balance": user.credit_balance, "is_premium": user.is_premium,
            "is_admin": user.is_admin, "is_active": user.is_active,
            "response_language": user.response_language or "en",
            "brand_voice": user.brand_voice or "",
            "primary_url": user.primary_url or "",
            "referral_code": user.referral_code or "",
            "referred_by": user.referred_by,
            "register_ip": user.register_ip or "",
            "last_login_ip": user.last_login_ip or "",
            "country": user.country or "",
            "last_login_at": user.last_login_at.isoformat() if user.last_login_at else None,
            "created_at": user.created_at.isoformat() if user.created_at else None,
        }

        # Credit transactions (last 30)
        tx_rows = (
            s.query(CreditTransaction)
            .filter(CreditTransaction.user_id == user_id)
            .order_by(CreditTransaction.created_at.desc()).limit(30).all()
        )
        transactions = [{
            "id": t.id, "type": t.type, "amount": t.amount,
            "balance_after": t.balance_after, "description": t.description,
            "created_at": t.created_at.isoformat() if t.created_at else None,
        } for t in tx_rows]

        # Payment orders
        order_rows = (
            s.query(PaymentOrder)
            .filter(PaymentOrder.user_id == user_id)
            .order_by(PaymentOrder.created_at.desc()).limit(20).all()
        )
        orders = [{
            "order_number": o.order_number, "amount": o.amount,
            "credit_amount": o.credit_amount, "status": o.status,
            "paid_at": o.paid_at.isoformat() if o.paid_at else None,
        } for o in order_rows]

        # Analysis history (last 20)
        conv_rows = (
            s.query(Conversation)
            .filter(Conversation.user_id == user_id)
            .order_by(Conversation.created_at.desc()).limit(20).all()
        )
        analyses = [{
            "id": str(c.id), "title": c.title, "status": c.status,
            "input_type": c.input_type,
            "input_value": c.input_value[:80] if c.input_value else "",
            "created_at": c.created_at.isoformat() if c.created_at else None,
        } for c in conv_rows]

        # SEO checks count
        seo_count = s.query(func.count(SEOHealthSnapshot.id)).filter(
            SEOHealthSnapshot.user_id == user_id
        ).scalar() or 0

        # GEO scans count
        geo_count = s.query(func.count(GEOVisibility.id)).filter(
            GEOVisibility.user_id == user_id
        ).scalar() or 0

        # Referral info
        referrer = None
        if user.referred_by:
            ref_user = s.query(User.username, User.email).filter(User.id == user.referred_by).first()
            if ref_user:
                referrer = {"username": ref_user.username, "email": ref_user.email}

        referred_count = s.query(func.count(User.id)).filter(User.referred_by == user_id).scalar() or 0

        return {
            "info": info,
            "transactions": transactions,
            "orders": orders,
            "analyses": analyses,
            "seo_count": seo_count,
            "geo_count": geo_count,
            "referrer": referrer,
            "referred_count": referred_count,
        }
    finally:
        s.close()


# ---------- 3. Revenue ----------

@router.get("/revenue/stats")
async def admin_revenue_stats(_=Depends(require_admin)):
    db = get_database()
    s = db.get_session()
    try:
        today = _today()
        week_ago = today - timedelta(days=7)
        month_ago = today - timedelta(days=30)

        def _sum_paid(since=None):
            q = s.query(func.coalesce(func.sum(PaymentOrder.amount), 0)).filter(PaymentOrder.status == "paid")
            if since:
                q = q.filter(PaymentOrder.paid_at >= since)
            return float(q.scalar())

        total_orders = s.query(func.count(PaymentOrder.id)).filter(PaymentOrder.status == "paid").scalar() or 0
        total_revenue = _sum_paid()

        # Package distribution
        pkg_rows = (
            s.query(PaymentOrder.plan_type, func.count().label("c"), func.sum(PaymentOrder.amount).label("amt"))
            .filter(PaymentOrder.status == "paid")
            .group_by(PaymentOrder.plan_type).all()
        )
        packages = [{"plan": r.plan_type, "count": r.c, "amount": float(r.amt or 0)} for r in pkg_rows]

        return {
            "total_revenue": total_revenue,
            "revenue_today": _sum_paid(today),
            "revenue_week": _sum_paid(week_ago),
            "revenue_month": _sum_paid(month_ago),
            "total_orders": total_orders,
            "avg_order_value": round(total_revenue / total_orders, 2) if total_orders else 0,
            "packages": packages,
        }
    finally:
        s.close()


@router.get("/revenue")
async def admin_revenue(
    page: int = Query(1, ge=1),
    limit: int = Query(30, ge=1, le=100),
    _=Depends(require_admin),
):
    db = get_database()
    s = db.get_session()
    try:
        orders_q = s.query(PaymentOrder, User.username).outerjoin(User, User.id == PaymentOrder.user_id)
        total = orders_q.count()
        rows = orders_q.order_by(PaymentOrder.created_at.desc()).offset((page - 1) * limit).limit(limit).all()

        orders = []
        for order, username in rows:
            orders.append({
                "id": order.id, "order_number": order.order_number,
                "username": username, "amount": order.amount,
                "credit_amount": order.credit_amount, "plan_type": order.plan_type,
                "status": order.status,
                "paid_at": order.paid_at.isoformat() if order.paid_at else None,
                "created_at": order.created_at.isoformat() if order.created_at else None,
            })

        # Recent credit transactions
        tx_rows = (
            s.query(CreditTransaction, User.username)
            .outerjoin(User, User.id == CreditTransaction.user_id)
            .order_by(CreditTransaction.created_at.desc()).limit(50).all()
        )
        transactions = []
        for tx, username in tx_rows:
            transactions.append({
                "id": tx.id, "username": username, "type": tx.type,
                "amount": tx.amount, "balance_after": tx.balance_after,
                "description": tx.description,
                "created_at": tx.created_at.isoformat() if tx.created_at else None,
            })

        return {"orders": orders, "total": total, "transactions": transactions}
    finally:
        s.close()


# ---------- 4. Analyses ----------

@router.get("/analyses/stats")
async def admin_analyses_stats(_=Depends(require_admin)):
    db = get_database()
    s = db.get_session()
    try:
        today = _today()
        total = s.query(func.count(Conversation.id)).scalar() or 0
        today_count = s.query(func.count(Conversation.id)).filter(Conversation.created_at >= today).scalar() or 0
        completed = s.query(func.count(Conversation.id)).filter(Conversation.status == "completed").scalar() or 0
        failed = s.query(func.count(Conversation.id)).filter(Conversation.status == "failed").scalar() or 0
        user_count = s.query(func.count(distinct(Conversation.user_id))).scalar() or 0

        seo_total = s.query(func.count(SEOHealthSnapshot.id)).scalar() or 0
        seo_today = s.query(func.count(SEOHealthSnapshot.id)).filter(SEOHealthSnapshot.created_at >= today).scalar() or 0
        geo_total = s.query(func.count(GEOVisibility.id)).scalar() or 0
        geo_today = s.query(func.count(GEOVisibility.id)).filter(GEOVisibility.checked_at >= today).scalar() or 0
        comp_total = s.query(func.count(Competitor.id)).scalar() or 0

        return {
            "total_analyses": total,
            "analyses_today": today_count,
            "completed": completed,
            "failed": failed,
            "success_rate": round(completed / total * 100, 1) if total else 0,
            "avg_per_user": round(total / user_count, 1) if user_count else 0,
            "seo": {"total": seo_total, "today": seo_today},
            "geo": {"total": geo_total, "today": geo_today},
            "competitors": {"total": comp_total},
        }
    finally:
        s.close()


@router.get("/analyses")
async def admin_analyses(
    status: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(30, ge=1, le=100),
    _=Depends(require_admin),
):
    db = get_database()
    s = db.get_session()
    try:
        q = (
            s.query(Conversation, User.username, func.count(Recommendation.id).label("rec_count"))
            .outerjoin(User, User.id == Conversation.user_id)
            .outerjoin(Recommendation, Recommendation.conversation_id == Conversation.id)
            .group_by(Conversation.id, User.username)
        )
        if status:
            q = q.filter(Conversation.status == status)

        total = s.query(func.count(Conversation.id)).scalar() or 0
        rows = q.order_by(Conversation.created_at.desc()).offset((page - 1) * limit).limit(limit).all()

        items = []
        for conv, username, rec_count in rows:
            items.append({
                "id": str(conv.id), "title": conv.title,
                "username": username, "input_type": conv.input_type,
                "input_value": conv.input_value[:100] if conv.input_value else "",
                "status": conv.status, "rec_count": rec_count,
                "created_at": conv.created_at.isoformat() if conv.created_at else None,
            })

        return {"analyses": items, "total": total, "page": page}
    finally:
        s.close()


# ---------- 5. Activity ----------

@router.get("/activity")
async def admin_activity(
    event_type: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    _=Depends(require_admin),
):
    db = get_database()
    s = db.get_session()
    try:
        q = (
            s.query(ActivityFeed, User.username)
            .outerjoin(User, User.id == ActivityFeed.user_id)
        )
        if event_type:
            q = q.filter(ActivityFeed.event_type == event_type)

        total = q.count()
        rows = q.order_by(ActivityFeed.created_at.desc()).offset((page - 1) * limit).limit(limit).all()

        items = []
        for af, username in rows:
            items.append({
                "id": str(af.id), "username": username,
                "event_type": af.event_type, "title": af.title,
                "detail": af.detail,
                "created_at": af.created_at.isoformat() if af.created_at else None,
            })

        # Event type counts for filter
        type_rows = (
            s.query(ActivityFeed.event_type, func.count().label("c"))
            .group_by(ActivityFeed.event_type).all()
        )
        event_types = {r.event_type: r.c for r in type_rows}

        return {"activity": items, "total": total, "event_types": event_types}
    finally:
        s.close()
