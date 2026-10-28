# AI-CMO · 外贸工厂 AI 获客平台

帮助中国外贸工厂用 AI 建立英文 B2B 官网，并持续发现海外采购需求，把它们变成可跟进的商机。

重构计划见 [`plans/`](plans/README.md)，验收记录见 [`docs/acceptance.md`](docs/acceptance.md)。

## 目录

| 目录 | 内容 |
|---|---|
| `apps/web` | 网站前端（React 19 + Vite + TypeScript）：营销首页、登录与建档、带侧边栏的工作台；组件自研，图标使用 lucide |
| `backend` | FastAPI + SQLAlchemy 2 + Alembic；`app/core` 为配置、数据库、日志、错误、安全 |
| `deploy` | Docker Compose（项目名 `aicmo-v2`）、Dockerfile、Nginx 配置 |
| `docs` | UI 缺口登记、授权说明、验收记录等 |

## 本地开发

```bash
# 1. 测试 / 开发数据库（只监听本机，数据在内存中）
docker run -d --name aicmo-v2-testdb -e POSTGRES_USER=aicmo -e POSTGRES_PASSWORD=aicmo_test_only \
  -e POSTGRES_DB=aicmo_test -p 127.0.0.1:55432:5432 --tmpfs /var/lib/postgresql/data postgres:15-alpine

# 2. 后端
cd backend
python3.11 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
export DATABASE_URL=postgresql+psycopg://aicmo:aicmo_test_only@127.0.0.1:55432/aicmo_test
export SECRET_KEY=$(python3 -c "import secrets;print(secrets.token_urlsafe(48))")
.venv/bin/alembic upgrade head
.venv/bin/uvicorn app.asgi:app --reload --port 8000

# 3. 前端（另一个终端，仓库根目录）
npm install
npm run dev          # http://127.0.0.1:5173，/api 代理到 127.0.0.1:8000
```

## 检查

```bash
node scripts/check-all.mjs              # 提交前必须通过
node scripts/check-all.mjs --skip-e2e   # 跳过端到端测试
```

包含：前端规则扫描 / 类型检查 / 构建 / 单元与组件测试，后端 ruff / pytest（覆盖率 ≥ 85%，`core/security` 100%）/
迁移往返，端到端测试，依赖审计（仅报告）。

## 部署（隔离运行）

```bash
cp .env.example deploy/.env.v2   # 填写真实值
docker compose -f deploy/docker-compose.yml --env-file deploy/.env.v2 -p aicmo-v2 up -d --build
curl http://127.0.0.1:9020/health
```

`aicmo-v2` 与旧版容器（`ai-cmo-*`）完全隔离；db 和 api 不对外暴露端口，web 默认只监听 `127.0.0.1:9020`。
切换正式域名前需项目负责人确认（见 `docs/acceptance.md`）。

## 安全基线

所有服务端出网请求必须经过 `app.core.security.ssrf.safe_fetch`；前端禁止 `dangerouslySetInnerHTML`；
密钥只通过环境变量提供，仓库只保留 `.env.example`。详见 `plans/00-overview.md` 第 5 节。
