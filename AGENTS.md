# AI-CMO Development Guide

## Cursor Cloud specific instructions

### Architecture
AI-CMO is a social media promotion intelligence platform with two main services:
- **Backend**: Python 3.12 + FastAPI (port 9001) in `backend/`
- **Frontend**: React 19 + TypeScript + Vite (port 5173) in `frontend/`
- **Database**: PostgreSQL 15 (Docker container on port 5434)

### Running services

**PostgreSQL** (must start first):
```bash
sudo dockerd &>/tmp/dockerd.log &
sleep 2
sudo docker start ai_cmo_db || sudo docker run -d --name ai_cmo_db \
  -e POSTGRES_USER=ai_cmo -e POSTGRES_PASSWORD=ai_cmo_pass -e POSTGRES_DB=ai_cmo \
  -p 5434:5432 postgres:15-alpine
```

**Backend**:
```bash
cd /workspace/backend && source venv/bin/activate && uvicorn app.main:app --host 0.0.0.0 --port 9001 --reload
```

**Frontend dev server**:
```bash
cd /workspace/frontend && npx vite --host 0.0.0.0 --port 5173
```

### Key notes
- The `.env` file at repo root holds all backend config. `DATABASE_URL` must point to `localhost:5434` (Docker-mapped port) for local dev.
- The backend config class (`backend/app/config.py`) uses `pydantic-settings` and reads `.env` from the repo root.
- Vite proxies `/api` to `http://localhost:9001` (see `frontend/vite.config.ts`).
- Database tables are auto-created on backend startup via `init_db()` in `app/database.py`.
- External services (Qwen LLM API, AgentGo browser) require API keys in `.env` — the app starts fine without them, but the analysis workflow won't function.
- Frontend lint: `cd frontend && npx eslint .` — there are pre-existing lint warnings/errors (react-hooks, no-explicit-any).
- Frontend build: `cd frontend && npm run build` — outputs to `frontend/dist/`.
- TypeScript check: `cd frontend && npx tsc -b` — passes cleanly.
- Docker daemon in this environment needs `fuse-overlayfs` storage driver and `iptables-legacy`. These are configured during initial setup.
