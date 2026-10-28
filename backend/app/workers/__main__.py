"""worker 进程入口：python -m app.workers

循环领取任务表中的到期任务（SELECT ... FOR UPDATE SKIP LOCKED，支持多实例）。
同时运行 APScheduler 定时调度（见 app/workers/scheduler.py）。
"""

from __future__ import annotations

import logging
import signal
import time

from app.core.config import get_settings
from app.core.db import get_sessionmaker
from app.core.jobs import claim_next, run_job
from app.core.logging import configure_logging
from app.workers import handlers  # noqa: F401  注册任务处理函数

logger = logging.getLogger("app.worker")
IDLE_SLEEP_SECONDS = 1.0


def run_once() -> bool:
    """领取并执行一个任务；没有任务时返回 False。"""
    with get_sessionmaker()() as session:
        job = claim_next(session)
        if job is None:
            session.rollback()
            return False
        session.commit()
        run_job(session, job)
        return True


def beat() -> None:
    """写入心跳（失败只记录日志，不影响任务执行）。"""
    from sqlalchemy.dialects.postgresql import insert

    from app.core.db import utcnow
    from app.core.jobs import WORKER_ID
    from app.modules.admin.models import WorkerHeartbeat

    try:
        with get_sessionmaker()() as session:
            now = utcnow()
            session.execute(
                insert(WorkerHeartbeat)
                .values(worker_id=WORKER_ID, beat_at=now, started_at=now)
                .on_conflict_do_update(index_elements=["worker_id"], set_={"beat_at": now})
            )
            session.commit()
        logger.info("worker heartbeat")
    except Exception:
        logger.exception("worker heartbeat failed")


def main() -> None:
    settings = get_settings()
    configure_logging(settings.log_level)
    stopping = False

    def _stop(signum: int, _frame: object) -> None:
        nonlocal stopping
        logger.info("worker received signal %s, stopping", signum)
        stopping = True

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    from app.workers.scheduler import build_scheduler

    scheduler = build_scheduler()
    scheduler.start()
    logger.info("worker started (env=%s, test_mode=%s)", settings.app_env, settings.test_mode)
    beat()
    last_beat = time.monotonic()
    while not stopping:
        try:
            worked = run_once()
        except Exception:
            logger.exception("worker loop error")
            worked = False
        now = time.monotonic()
        if now - last_beat >= 60:
            beat()
            last_beat = now
        if not worked:
            time.sleep(IDLE_SLEEP_SECONDS)
    scheduler.shutdown(wait=False)


if __name__ == "__main__":
    main()
