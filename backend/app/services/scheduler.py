"""
APScheduler-based task scheduler for automated SEO/GEO monitoring.
"""
import logging
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()


async def daily_seo_check():
    from app.database import get_database, User
    from app.services.seo_service import get_seo_service
    db = get_database()
    session = db.get_session()
    try:
        users = session.query(User).filter(
            User.primary_url.isnot(None), User.primary_url != "", User.is_active == True
        ).all()
        seo = get_seo_service()
        for user in users:
            try:
                logger.info(f"[Scheduler] Daily SEO check for user {user.id}")
                await seo.check(user.primary_url, user.id)
            except Exception as e:
                logger.warning(f"[Scheduler] SEO check failed for user {user.id}: {e}")
    finally:
        session.close()


async def weekly_geo_scan():
    from app.database import get_database, User
    from app.services.geo_service import get_geo_service
    db = get_database()
    session = db.get_session()
    try:
        users = session.query(User).filter(
            User.primary_url.isnot(None), User.primary_url != "", User.is_active == True
        ).all()
        geo = get_geo_service()
        for user in users:
            try:
                profiles = db.get_product_profiles(user.id)
                brand_name = profiles[0]["name"] if profiles else user.username
                logger.info(f"[Scheduler] Weekly GEO scan for user {user.id}")
                await geo.scan(brand_name, [], user.id)
            except Exception as e:
                logger.warning(f"[Scheduler] GEO scan failed for user {user.id}: {e}")
    finally:
        session.close()


def setup_scheduler():
    scheduler.add_job(daily_seo_check, CronTrigger(hour=6, minute=0), id="daily_seo", replace_existing=True)
    scheduler.add_job(weekly_geo_scan, CronTrigger(day_of_week="mon", hour=8, minute=0), id="weekly_geo", replace_existing=True)
    logger.info("[Scheduler] Jobs configured: daily_seo@06:00, weekly_geo@Mon08:00")
    return scheduler
