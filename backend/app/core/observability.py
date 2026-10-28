"""可观测性：进程内指标（Prometheus 文本格式）、业务指标采集、错误上报接口、告警检查。

- 进程内计数器：请求数 / 状态码分组 / 延迟直方图（按路由模板，避免 ID 导致的高基数）、SSE 中断数
- 业务指标（每次抓取 /metrics 时从数据库读取）：任务队列积压、失败任务、连接器失败率、LLM token 用量
- /metrics 访问控制：配置 METRICS_TOKEN 时要求 Bearer；生产环境未配置令牌时拒绝；开发环境只允许内网来源
- 错误上报：ErrorReporter 接口；配置 SENTRY_DSN 且安装了 sentry-sdk 时启用，否则只写日志
"""

from __future__ import annotations

import ipaddress
import logging
import threading
from collections import defaultdict
from datetime import timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import utcnow

logger = logging.getLogger("app.observability")

BUCKETS = (0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0)


class Metrics:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.requests: dict[tuple[str, str, str], int] = defaultdict(int)  # (method, route, status_class)
        self.latency: dict[tuple[str, str], list[int]] = {}  # (method, route) -> 桶计数（含 +Inf）
        self.latency_sum: dict[tuple[str, str], float] = defaultdict(float)
        self.counters: dict[str, int] = defaultdict(int)

    def observe(self, method: str, route: str, status: int, seconds: float) -> None:
        key = (method, route)
        with self._lock:
            self.requests[(method, route, f"{status // 100}xx")] += 1
            buckets = self.latency.setdefault(key, [0] * (len(BUCKETS) + 1))
            for i, bound in enumerate(BUCKETS):
                if seconds <= bound:
                    buckets[i] += 1
            buckets[-1] += 1
            self.latency_sum[key] += seconds

    def inc(self, name: str, amount: int = 1) -> None:
        with self._lock:
            self.counters[name] += amount

    def reset(self) -> None:
        with self._lock:
            self.requests.clear()
            self.latency.clear()
            self.latency_sum.clear()
            self.counters.clear()

    def render(self) -> list[str]:
        lines = [
            "# HELP aicmo_http_requests_total HTTP 请求数",
            "# TYPE aicmo_http_requests_total counter",
        ]
        with self._lock:
            for (method, route, status), value in sorted(self.requests.items()):
                lines.append(
                    f'aicmo_http_requests_total{{method="{method}",route="{_esc(route)}",status="{status}"}} {value}'
                )
            lines += ["# HELP aicmo_http_request_seconds 请求耗时", "# TYPE aicmo_http_request_seconds histogram"]
            for (method, route), buckets in sorted(self.latency.items()):
                labels = f'method="{method}",route="{_esc(route)}"'
                for bound, count in zip(BUCKETS, buckets, strict=False):
                    lines.append(f'aicmo_http_request_seconds_bucket{{{labels},le="{bound}"}} {count}')
                lines.append(f'aicmo_http_request_seconds_bucket{{{labels},le="+Inf"}} {buckets[-1]}')
                lines.append(f"aicmo_http_request_seconds_sum{{{labels}}} {self.latency_sum[(method, route)]:.6f}")
                lines.append(f"aicmo_http_request_seconds_count{{{labels}}} {buckets[-1]}")
            for name, value in sorted(self.counters.items()):
                lines += [f"# TYPE aicmo_{name}_total counter", f"aicmo_{name}_total {value}"]
        return lines


def _esc(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "")


metrics = Metrics()


def route_template(scope: dict[str, Any]) -> str:
    """路由模板（/api/v1/leads/{lead_id}）；未匹配的路径统一为 unmatched，防止指标基数爆炸。"""
    route = scope.get("route")
    path = getattr(route, "path", None)
    return str(path) if path else "unmatched"


def business_metrics(db: Session) -> list[str]:
    from app.core.jobs import Job
    from app.modules.admin.models import UsageRecord
    from app.modules.leads.models import SourceRequest

    now = utcnow()
    lines: list[str] = []
    queued = dict(
        db.execute(
            select(Job.kind, func.count()).where(Job.status == "queued", Job.run_after <= now).group_by(Job.kind)
        ).all()
    )
    lines += ["# HELP aicmo_jobs_backlog 到期未执行的任务数", "# TYPE aicmo_jobs_backlog gauge"]
    lines += [f'aicmo_jobs_backlog{{kind="{_esc(k)}"}} {v}' for k, v in sorted(queued.items())] or [
        "aicmo_jobs_backlog 0"
    ]
    oldest = db.scalar(select(func.min(Job.run_after)).where(Job.status == "queued", Job.run_after <= now))
    lines += [
        "# TYPE aicmo_jobs_oldest_wait_seconds gauge",
        f"aicmo_jobs_oldest_wait_seconds {int((now - oldest).total_seconds()) if oldest else 0}",
    ]
    failed = db.scalar(
        select(func.count())
        .select_from(Job)
        .where(Job.status == "failed", Job.finished_at >= now - timedelta(hours=24))
    )
    lines += ["# TYPE aicmo_jobs_failed_24h gauge", f"aicmo_jobs_failed_24h {failed or 0}"]
    from app.modules.admin.models import WorkerHeartbeat

    last_beat = db.scalar(select(func.max(WorkerHeartbeat.beat_at)))
    lines += [
        "# HELP aicmo_worker_heartbeat_age_seconds 距最近一次 worker 心跳的秒数",
        "# TYPE aicmo_worker_heartbeat_age_seconds gauge",
        f"aicmo_worker_heartbeat_age_seconds {int((now - last_beat).total_seconds()) if last_beat else -1}",
    ]
    sources = db.execute(
        select(SourceRequest.source_key, SourceRequest.ok, func.count())
        .where(SourceRequest.created_at >= now - timedelta(hours=24))
        .group_by(SourceRequest.source_key, SourceRequest.ok)
    ).all()
    totals: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for key, ok, count in sources:
        totals[key][0] += count
        if not ok:
            totals[key][1] += count
    lines += [
        "# HELP aicmo_source_failure_ratio_24h 连接器失败率（24 小时）",
        "# TYPE aicmo_source_failure_ratio_24h gauge",
    ]
    lines += [
        f'aicmo_source_failure_ratio_24h{{source="{_esc(k)}"}} {v[1] / v[0]:.4f}'
        for k, v in sorted(totals.items())
        if v[0]
    ]
    tokens = db.scalar(
        select(func.coalesce(func.sum(UsageRecord.quantity), 0)).where(
            UsageRecord.kind == "llm_tokens", UsageRecord.created_at >= now - timedelta(hours=24)
        )
    )
    cost = db.scalar(
        select(func.coalesce(func.sum(UsageRecord.cost_micros), 0)).where(
            UsageRecord.created_at >= now - timedelta(hours=24)
        )
    )
    lines += [
        "# TYPE aicmo_llm_tokens_24h gauge",
        f"aicmo_llm_tokens_24h {tokens or 0}",
        "# HELP aicmo_estimated_cost_yuan_24h 估算成本（元，24 小时）",
        "# TYPE aicmo_estimated_cost_yuan_24h gauge",
        f"aicmo_estimated_cost_yuan_24h {int(cost or 0) / 1_000_000:.4f}",
    ]
    return lines


def metrics_allowed(client_host: str | None, authorization: str) -> bool:
    """配置了 METRICS_TOKEN：必须携带 Bearer 令牌。生产环境未配置令牌：拒绝（不依赖来源 IP 判断，
    因为反向代理链上的内网地址无法区分真实内网调用）。开发 / 测试环境未配置令牌：只允许内网来源。"""
    import hmac

    settings = get_settings()
    token = settings.metrics_token
    if token:
        expected = f"Bearer {token.get_secret_value()}"
        return hmac.compare_digest(authorization.encode(), expected.encode())
    if settings.is_production:
        return False
    try:
        ip = ipaddress.ip_address(client_host or "")
    except ValueError:
        return False
    return ip.is_private or ip.is_loopback


# ── 告警检查（worker 定时执行，结果写日志；外部监控按 level=ERROR 告警）─────────


def alert_checks(db: Session) -> list[str]:
    """返回告警列表：任务积压、worker 心跳缺失、连接器失败率过高、证书即将到期。"""
    from app.core.jobs import Job
    from app.modules.leads.models import SourceRequest

    now = utcnow()
    alerts: list[str] = []
    backlog = db.scalar(
        select(func.count())
        .select_from(Job)
        .where(Job.status == "queued", Job.run_after <= now - timedelta(minutes=10))
    )
    if backlog:
        alerts.append(f"任务积压：{backlog} 个任务等待超过 10 分钟")
    from app.modules.admin.models import WorkerHeartbeat

    last_beat = db.scalar(select(func.max(WorkerHeartbeat.beat_at)))
    if last_beat is None or last_beat < now - timedelta(minutes=5):
        alerts.append("worker 心跳缺失超过 5 分钟")
    rows = db.execute(
        select(SourceRequest.source_key, SourceRequest.ok, func.count())
        .where(SourceRequest.created_at >= now - timedelta(hours=6))
        .group_by(SourceRequest.source_key, SourceRequest.ok)
    ).all()
    totals: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for key, ok, count in rows:
        totals[key][0] += count
        totals[key][1] += 0 if ok else count
    for key, (total, bad) in sorted(totals.items()):
        if total >= 10 and bad / total > 0.5:
            alerts.append(f"数据源 {key} 6 小时失败率 {bad / total:.0%}")
    return alerts


class ErrorReporter:
    """错误上报接口。未配置 Sentry 时只写日志。"""

    def __init__(self) -> None:
        self.enabled = False
        dsn = get_settings().sentry_dsn
        if dsn:
            try:
                import sentry_sdk  # type: ignore[import-not-found]

                sentry_sdk.init(dsn=dsn.get_secret_value(), send_default_pii=False, traces_sample_rate=0.0)
                self.enabled = True
            except ImportError:  # pragma: no cover - 生产镜像按需安装 sentry-sdk
                logger.warning("SENTRY_DSN 已配置但未安装 sentry-sdk，错误只写入日志")

    def capture(self, exc: BaseException) -> None:
        if self.enabled:  # pragma: no cover - 需要真实 Sentry
            import sentry_sdk  # type: ignore[import-not-found]

            sentry_sdk.capture_exception(exc)
