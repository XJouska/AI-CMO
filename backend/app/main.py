"""FastAPI 入口。"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from sqlalchemy import text

from app.core.config import APP_VERSION, get_settings
from app.core.db import get_engine
from app.core.errors import install_error_handlers
from app.core.logging import RequestContextMiddleware, configure_logging
from app.modules.admin import notifications as _notifications  # noqa: F401  注册通知投递事件
from app.modules.admin.compliance import router as compliance_router
from app.modules.admin.router import router as admin_router
from app.modules.assistant.router import router as assistant_router
from app.modules.auth.router import router as auth_router
from app.modules.billing.router import router as billing_router
from app.modules.companies.router import router as companies_router
from app.modules.leads.router import router as leads_router
from app.modules.outreach.router import router as outreach_router
from app.modules.sites.router import public as sites_public_router
from app.modules.sites.router import router as sites_router
from app.modules.sources.router import router as sources_router

logger = logging.getLogger(__name__)

API_PREFIX = "/api/v1"

MODULE_ROUTERS = [
    auth_router,
    companies_router,
    assistant_router,
    sites_router,
    sources_router,
    leads_router,
    outreach_router,
    billing_router,
    admin_router,
    compliance_router,
    sites_public_router,
]


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        logger.info("api starting (env=%s, version=%s)", settings.app_env, APP_VERSION)
        yield

    app = FastAPI(
        title="AI-CMO API",
        version=APP_VERSION,
        lifespan=lifespan,
        # 生产环境不公开接口文档。
        docs_url=None if settings.is_production else "/docs",
        redoc_url=None,
        openapi_url=None if settings.is_production else "/openapi.json",
    )
    install_error_handlers(app)
    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_credentials=False,
            allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE"],
            allow_headers=["Authorization", "Content-Type", "X-Company-Id", "X-Request-Id"],
        )
    app.add_middleware(RequestContextMiddleware)

    @app.get("/health", tags=["system"])
    def health() -> JSONResponse:
        try:
            with get_engine().connect() as conn:
                conn.execute(text("SELECT 1"))
            db_ok = True
        except Exception:
            logger.exception("health: database unreachable")
            db_ok = False
        body = {"status": "ok" if db_ok else "degraded", "database": "ok" if db_ok else "error"}
        return JSONResponse(body, status_code=200 if db_ok else 503)

    @app.get("/metrics", tags=["system"], include_in_schema=False)
    def prometheus_metrics(request: Request) -> PlainTextResponse:
        from app.core.db import get_sessionmaker
        from app.core.observability import business_metrics, metrics, metrics_allowed

        if not metrics_allowed(
            request.client.host if request.client else None, request.headers.get("authorization", "")
        ):
            return PlainTextResponse("forbidden", status_code=403)
        lines = metrics.render()
        try:
            with get_sessionmaker()() as db:
                lines += business_metrics(db)
            lines += ["aicmo_db_up 1"]
        except Exception:
            logger.exception("metrics: database unreachable")
            lines += ["aicmo_db_up 0"]
        return PlainTextResponse("\n".join(lines) + "\n", media_type="text/plain; version=0.0.4")

    @app.get(f"{API_PREFIX}/meta", tags=["system"])
    def meta() -> dict[str, object]:
        return {
            "name": "AI-CMO",
            "version": APP_VERSION,
            "env": settings.app_env,
            "features": {"llm": settings.llm_enabled},
        }

    for router in MODULE_ROUTERS:
        app.include_router(router, prefix=API_PREFIX)

    return app
