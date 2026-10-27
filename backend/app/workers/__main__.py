"""worker 进程入口：python -m app.workers

计划 01 只运行心跳空循环；计划 02 起接入任务表执行器，计划 05 接入定时调度。
"""

from __future__ import annotations

import logging
import signal
import time

from app.core.config import get_settings
from app.core.logging import configure_logging

logger = logging.getLogger("app.worker")


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
    logger.info("worker started (env=%s)", settings.app_env)
    last_beat = 0.0
    while not stopping:
        now = time.monotonic()
        if now - last_beat >= 60:
            logger.info("worker heartbeat")
            last_beat = now
        time.sleep(1)


if __name__ == "__main__":
    main()
