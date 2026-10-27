"""定时调度（worker 进程内，APScheduler）。

定时任务只负责「把到期的工作写入任务表」，真正的执行由任务执行器（SKIP LOCKED）完成，因此多个 worker 实例
同时运行调度器也不会重复执行同一件事：
- 每分钟：为到期的商机监控计划创建运行任务（leads.schedule_due，行级锁 SKIP LOCKED）
- 每小时：为超过 7 天未检查的已发布官网安排健康检查
- 每 5 分钟：跟进提醒与招标截止提醒（同一事件只提醒一次，行级锁 SKIP LOCKED）
- 每小时：为上一周生成周报并推送到助手（唯一约束防重复；worker 停机后会补发）
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import timedelta

from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.db import get_sessionmaker, utcnow
from app.core.jobs import enqueue, job_handler
from app.modules.leads.pipeline import schedule_due
from app.modules.outreach.service import run_reminders, schedule_weekly_reports
from app.modules.sites.health import run_health_check
from app.modules.sites.models import Site, SiteHealthReport, SiteVersion

logger = logging.getLogger("app.scheduler")
HEALTH_JOB = "sites.health_check"
HEALTH_INTERVAL = timedelta(days=7)


def schedule_site_health(db: Session) -> int:
    latest = (
        select(SiteHealthReport.site_id, func.max(SiteHealthReport.created_at).label("last"))
        .group_by(SiteHealthReport.site_id)
        .subquery()
    )
    rows = db.execute(
        select(Site.id, Site.company_id)
        .outerjoin(latest, latest.c.site_id == Site.id)
        .where(Site.status == "published", (latest.c.last.is_(None)) | (latest.c.last < utcnow() - HEALTH_INTERVAL))
        .limit(200)
    ).all()
    for site_id, company_id in rows:
        enqueue(db, HEALTH_JOB, {"site_id": str(site_id)}, company_id=company_id)
    db.commit()
    return len(rows)


@job_handler(HEALTH_JOB)
def handle_health(db: Session, job) -> None:  # type: ignore[no-untyped-def]
    import uuid

    site = db.get(Site, uuid.UUID(job.payload["site_id"]))
    if site is None or site.published_version_id is None:
        return
    version = db.get(SiteVersion, site.published_version_id)
    if version is not None:
        run_health_check(db, site, version)


def _with_session(func: Callable[[Session], int], name: str) -> Callable[[], None]:
    def run() -> None:
        try:
            with get_sessionmaker()() as db:
                count = func(db)
            if count:
                logger.info("%s scheduled %d", name, count)
        except Exception:
            logger.exception("scheduler task %s failed", name)

    return run


def build_scheduler() -> BackgroundScheduler:
    scheduler = BackgroundScheduler(timezone="UTC", job_defaults={"coalesce": True, "max_instances": 1})
    scheduler.add_job(_with_session(schedule_due, "watch runs"), "interval", minutes=1, id="watch_runs")
    scheduler.add_job(_with_session(schedule_site_health, "site health"), "interval", hours=1, id="site_health")
    scheduler.add_job(_with_session(run_reminders, "reminders"), "interval", minutes=5, id="reminders")
    scheduler.add_job(
        _with_session(schedule_weekly_reports, "weekly reports"), "interval", hours=1, id="weekly_reports"
    )
    return scheduler
