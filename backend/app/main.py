import logging
import os
import time
from datetime import timezone, timedelta
from logging.handlers import TimedRotatingFileHandler
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import init_db
from app.api import auth, chat, credits, open_api, dashboard, ai_chat, feedback, competitors, geo, seo, terminal, content, admin


def setup_logging():
    """Configure logging with daily rotating file handler"""
    # In Docker: /app/logs (mounted volume); locally: project_root/logs
    app_dir = Path(__file__).resolve().parent.parent  # /app or /path/to/backend
    log_dir = app_dir / "logs"
    if not log_dir.exists():
        # Try parent (project root for local dev)
        log_dir = app_dir.parent / "logs"
    log_dir.mkdir(exist_ok=True)

    log_file = log_dir / "ai-cmo.log"

    # Root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(getattr(logging, settings.log_level.upper(), logging.INFO))

    # Format — force Beijing time (UTC+8)
    class BeijingFormatter(logging.Formatter):
        converter = staticmethod(lambda t: time.gmtime(t + 8 * 3600))

    fmt = BeijingFormatter(
        "%(asctime)s | %(levelname)-8s | %(name)-25s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # Console handler
    console = logging.StreamHandler()
    console.setFormatter(fmt)
    root_logger.addHandler(console)

    # File handler: rotate daily, keep 7 days
    file_handler = TimedRotatingFileHandler(
        filename=str(log_file),
        when="midnight",       # Rotate at midnight
        interval=1,            # Every 1 day
        backupCount=1,         # Keep only 1 backup (= delete after 1 day)
        encoding="utf-8",
    )
    file_handler.setFormatter(fmt)
    file_handler.suffix = "%Y-%m-%d"  # Backup file suffix
    root_logger.addHandler(file_handler)

    # Suppress noisy third-party loggers
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("openai").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)

    return root_logger


logger = setup_logging()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: startup and shutdown"""
    logger.info("🚀 AI-CMO Backend starting...")
    logger.info(f"   Database: {settings.database_url[:40]}...")
    logger.info(f"   CORS: {settings.cors_origins}")
    logger.info(f"   Log level: {settings.log_level}")
    init_db()
    logger.info("✅ Database initialized")
    try:
        from app.services.scheduler import setup_scheduler
        setup_scheduler().start()
        logger.info("✅ Scheduler started")
    except Exception as e:
        logger.warning(f"Scheduler not started: {e}")
    yield
    logger.info("👋 AI-CMO Backend shutting down...")


app = FastAPI(
    title="AI-CMO API",
    description="Social Media Promotion Intelligence Platform",
    version="1.0.0",
    lifespan=lifespan,
    redirect_slashes=False,
)

# CORS
origins = [o.strip() for o in settings.cors_origins.split(",")]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routes
app.include_router(auth.router)
app.include_router(chat.router)
app.include_router(credits.router)
app.include_router(open_api.router)
app.include_router(dashboard.router)
app.include_router(ai_chat.router)
app.include_router(feedback.router)
app.include_router(competitors.router)
app.include_router(geo.router)
app.include_router(seo.router)
app.include_router(terminal.router)
app.include_router(content.router)
app.include_router(admin.router)


@app.get("/")
async def root():
    return {"message": "AI-CMO API is running", "version": "1.0.0"}


@app.get("/health")
async def health():
    return {"status": "ok"}
