#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_PROJECT="ai-cmo"
cd "$PROJECT_DIR"

FULL=false
SKIP_FE=false
SKIP_BE=false
for arg in "$@"; do
  case $arg in
    --full)    FULL=true ;;
    --fe)      SKIP_BE=true ;;
    --be)      SKIP_FE=true ;;
  esac
done

t0=$(date +%s)
step() { echo -e "\n\033[1;36m[$1]\033[0m $2"; }

step "0" "Pre-flight checks"
command -v docker &>/dev/null || { echo "[ERROR] Docker not installed" >&2; exit 1; }
docker compose version &>/dev/null || { echo "[ERROR] Docker Compose V2 not available" >&2; exit 1; }
[ -f .env ] || { echo "[ERROR] .env not found" >&2; exit 1; }

# ── Ensure DB is running (never stop it) ──
if ! docker compose -p "$COMPOSE_PROJECT" ps db --format '{{.State}}' 2>/dev/null | grep -q running; then
  step "DB" "Starting database..."
  docker compose -p "$COMPOSE_PROJECT" up -d db
  echo "  Waiting for DB healthy..."
  for i in $(seq 1 20); do
    docker compose -p "$COMPOSE_PROJECT" ps db --format '{{.Health}}' 2>/dev/null | grep -q healthy && break
    sleep 1
  done
fi

# ── Frontend: build locally (fast, ~8s) ──
if [ "$SKIP_FE" = false ]; then
  step "1" "Building frontend locally..."
  (
    cd frontend
    if [ "$FULL" = true ] || [ ! -d node_modules ]; then
      npm ci --prefer-offline 2>&1 | tail -1
    fi
    export $(grep '^VITE_' ../.env 2>/dev/null | xargs)
    VITE_API_URL="" npm run build 2>&1 | grep -E '(built|error|✓)' || true
  )
  step "1b" "Restarting frontend container..."
  docker compose -p "$COMPOSE_PROJECT" up -d frontend
fi

# ── Backend: rebuild image only if code changed ──
if [ "$SKIP_BE" = false ]; then
  step "2" "Building & restarting backend..."
  if [ "$FULL" = true ]; then
    docker compose -p "$COMPOSE_PROJECT" build --no-cache backend
  else
    docker compose -p "$COMPOSE_PROJECT" build backend
  fi
  docker compose -p "$COMPOSE_PROJECT" up -d backend
fi

# ── Health check ──
step "3" "Waiting for backend health..."
for i in $(seq 1 15); do
  if curl -sf http://localhost:9011/health >/dev/null 2>&1; then
    echo "  Backend healthy!"
    break
  fi
  sleep 1
done

# ── Nginx reload ──
if command -v nginx &>/dev/null; then
  nginx -t 2>/dev/null && nginx -s reload 2>/dev/null && echo "  Host nginx reloaded."
fi

# ── Summary ──
t1=$(date +%s)
elapsed=$((t1 - t0))
echo ""
echo "========================================="
echo " Deploy done in ${elapsed}s"
echo "========================================="
docker compose -p "$COMPOSE_PROJECT" ps --format 'table {{.Name}}\t{{.State}}\t{{.Ports}}'
IP=$(curl -sf --max-time 2 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
echo ""
echo " URL:  http://${IP}"
echo " Hint: --fe (frontend only)  --be (backend only)  --full (no cache)"
echo "========================================="
