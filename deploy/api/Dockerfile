# syntax=docker/dockerfile:1
# api 镜像：不安装浏览器，非 root 运行。
FROM python:3.11-slim-bookworm AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
RUN groupadd --system --gid 10001 app && useradd --system --uid 10001 --gid app --home /app app

COPY requirements.txt ./
RUN pip install -r requirements.txt

COPY alembic.ini ./
COPY alembic ./alembic
COPY app ./app
COPY evals ./evals
COPY --from=templates . /app/site-templates

RUN mkdir -p /data/sites /data/storage && chown -R app:app /data
USER app
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
  CMD python -c "import urllib.request,sys;sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health',timeout=4).status==200 else 1)"
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.asgi:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='10.0.0.0/8,172.16.0.0/12,192.168.0.0/16'"]
