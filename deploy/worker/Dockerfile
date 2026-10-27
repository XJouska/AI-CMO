# syntax=docker/dockerfile:1
# worker 镜像：包含 Playwright Chromium，非 root 运行。
FROM python:3.11-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
RUN groupadd --system --gid 10001 app && useradd --system --uid 10001 --gid app --home /app app

COPY requirements.txt requirements-worker.txt ./
RUN pip install -r requirements-worker.txt \
 && python -m playwright install --with-deps chromium \
 && chmod -R a+rX /ms-playwright

COPY alembic.ini ./
COPY alembic ./alembic
COPY app ./app
COPY --from=templates . /app/site-templates

RUN mkdir -p /data/sites /data/storage /data/browser-profile && chown -R app:app /data
USER app
CMD ["python", "-m", "app.workers"]
