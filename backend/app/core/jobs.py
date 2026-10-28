"""通用任务表：api 写入任务，worker 通过 SELECT ... FOR UPDATE SKIP LOCKED 领取，支持多实例。

任务处理函数通过 @job_handler("kind") 注册。处理函数接收 (session, job)，可以是同步或异步函数；
抛出 RetryableJobError 时按指数退避重试，其他异常记为失败。
"""

from __future__ import annotations

import asyncio
import inspect
import logging
import os
import socket
import uuid
from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, select, update
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, Session, mapped_column

from app.core.db import Base, IdMixin, TimestampMixin, utcnow

logger = logging.getLogger(__name__)

JobHandler = Callable[[Session, "Job"], Any | Awaitable[Any]]
_HANDLERS: dict[str, JobHandler] = {}
WORKER_ID = f"{socket.gethostname()}:{os.getpid()}"
STALE_LOCK = timedelta(minutes=10)


class Job(IdMixin, TimestampMixin, Base):
    __tablename__ = "jobs"
    __table_args__ = (Index("ix_jobs_status_run_after", "status", "run_after"),)

    kind: Mapped[str] = mapped_column(String(64), nullable=False)
    company_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="queued")  # queued/running/done/failed
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    run_after: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    locked_by: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    last_error: Mapped[str] = mapped_column(Text, nullable=False, default="")
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class RetryableJobError(Exception):
    """临时性失败（网络、限流等），任务稍后重试。"""


def job_handler(kind: str) -> Callable[[JobHandler], JobHandler]:
    def register(func: JobHandler) -> JobHandler:
        _HANDLERS[kind] = func
        return func

    return register


def registered_kinds() -> list[str]:
    return sorted(_HANDLERS)


def enqueue(
    session: Session,
    kind: str,
    payload: dict[str, Any],
    *,
    company_id: uuid.UUID | None = None,
    run_after: datetime | None = None,
    max_attempts: int = 3,
) -> Job:
    job = Job(
        kind=kind,
        payload=payload,
        company_id=company_id,
        run_after=run_after or utcnow(),
        max_attempts=max_attempts,
    )
    session.add(job)
    session.flush()
    return job


def claim_next(session: Session, *, kinds: list[str] | None = None, worker_id: str = WORKER_ID) -> Job | None:
    """领取一个到期任务并标记为 running。调用方负责 commit。"""
    now = utcnow()
    # 回收锁超时的任务（worker 崩溃后遗留）
    session.execute(
        update(Job)
        .where(Job.status == "running", Job.locked_at < now - STALE_LOCK)
        .values(status="queued", locked_at=None, locked_by="")
    )
    stmt = (
        select(Job)
        .where(Job.status == "queued", Job.run_after <= now)
        .order_by(Job.run_after, Job.created_at)
        .limit(1)
        .with_for_update(skip_locked=True)
    )
    if kinds:
        stmt = stmt.where(Job.kind.in_(kinds))
    job = session.scalars(stmt).first()
    if job is None:
        return None
    job.status = "running"
    job.locked_at = now
    job.locked_by = worker_id
    job.attempts += 1
    session.flush()
    return job


def _run_handler(handler: JobHandler, session: Session, job: Job) -> None:
    from contextlib import nullcontext

    from app.services.metering import metering

    # 属于某企业的任务：其中的 LLM 调用计入该企业用量（计费与成本看板）
    meter = metering(session, job.company_id) if job.company_id else nullcontext()
    with meter:
        result = handler(session, job)
        if inspect.isawaitable(result):
            _drive(result)


def _drive(result: Awaitable[Any]) -> None:
    """同步执行异步处理函数（asyncio.run 会复制当前 contextvars，计量上下文随之传入）。"""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        asyncio.run(_await(result))
    else:  # pragma: no cover - 处理函数不应在事件循环内被同步调用
        raise RuntimeError("run_job 不能在事件循环中调用")


async def _await(awaitable: Awaitable[Any]) -> Any:
    return await awaitable


def run_job(session: Session, job: Job) -> None:
    """执行已领取的任务，并提交结果。处理函数内的数据库修改与任务状态在同一事务中提交。"""
    handler = _HANDLERS.get(job.kind)
    try:
        if handler is None:
            raise LookupError(f"未注册的任务类型：{job.kind}")
        _run_handler(handler, session, job)
    except RetryableJobError as exc:
        session.rollback()
        job = session.get(Job, job.id)  # type: ignore[assignment]
        exhausted = job.attempts >= job.max_attempts
        if exhausted:
            job.status, job.finished_at = "failed", utcnow()
        else:
            job.status = "queued"
            job.run_after = utcnow() + timedelta(seconds=10 * 2 ** (job.attempts - 1))
        job.last_error = str(exc)[:2000]
        job.locked_at, job.locked_by = None, ""
        logger.warning("job %s (%s) retryable error: %s", job.id, job.kind, exc)
        if exhausted and (on_fail := _FAILURE_HOOKS.get(job.kind)) is not None:
            on_fail(session, job)
    except Exception as exc:
        session.rollback()
        job = session.get(Job, job.id)  # type: ignore[assignment]
        job.status, job.finished_at = "failed", utcnow()
        job.last_error = f"{type(exc).__name__}: {exc}"[:2000]
        job.locked_at, job.locked_by = None, ""
        logger.exception("job %s (%s) failed", job.id, job.kind)
        on_fail = _FAILURE_HOOKS.get(job.kind)
        if on_fail is not None:
            on_fail(session, job)
    else:
        job.status, job.finished_at = "done", utcnow()
        job.locked_at, job.locked_by = None, ""
    session.commit()


_FAILURE_HOOKS: dict[str, Callable[[Session, Job], None]] = {}


def on_job_failure(kind: str) -> Callable[[Callable[[Session, Job], None]], Callable[[Session, Job], None]]:
    """任务最终失败时的回调（在同一事务中执行），用于把业务记录标记为失败。"""

    def register(func: Callable[[Session, Job], None]) -> Callable[[Session, Job], None]:
        _FAILURE_HOOKS[kind] = func
        return func

    return register


def run_pending(session: Session, *, limit: int = 100, kinds: list[str] | None = None) -> int:
    """处理当前所有到期任务（测试和单进程模式使用）。返回处理数量。"""
    count = 0
    while count < limit:
        job = claim_next(session, kinds=kinds)
        if job is None:
            break
        session.commit()
        run_job(session, job)
        count += 1
    return count
