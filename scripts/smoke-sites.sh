#!/usr/bin/env bash
# 部署自检：在 aicmo-v2 中发布一个演示站点，并经 sites 容器验证静态托管、安全头与询盘表单链路。
# 用法：bash scripts/smoke-sites.sh   （依赖已运行的 aicmo-v2 compose 项目）
set -euo pipefail
SITES=${SITES_URL:-http://127.0.0.1:9021}
BASE=${SITES_BASE_DOMAIN:-sites.localtest.me}
OUT=$(docker compose -p aicmo-v2 exec -T api python -m app.workers.smoke_publish | tail -1)
HOST=$(printf '%s' "$OUT" | python3 -c 'import sys,json;print(json.load(sys.stdin)["host"])')
SID=$(printf '%s' "$OUT" | python3 -c 'import sys,json;print(json.load(sys.stdin)["site_id"])')
fail() { echo "✗ $1"; exit 1; }
curl -fs -H "Host: $HOST" "$SITES/" | grep -q "<h1>Deployment smoke check</h1>" || fail "首页"
curl -fsI -H "Host: $HOST" "$SITES/" | grep -qi "script-src 'none'" || fail "CSP"
[ "$(curl -s -o /dev/null -w '%{http_code}' -H "Host: unknown.$BASE" "$SITES/")" = "404" ] || fail "未知域名应 404"
CODE=$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' -H "Host: $HOST" -X POST \
  --data 'name=Smoke&email=s@example.com&message=Deployment+inquiry+test&company_name=Smoke+Buyer' "$SITES/__inquiry/$SID")
case "$CODE" in "303 "*thank-you.html) ;; *) fail "询盘提交：$CODE" ;; esac
[ "$(curl -s -o /dev/null -w '%{http_code}' -H "Host: $HOST" "$SITES/__inquiry/$SID")" = "403" ] || fail "询盘只允许 POST"
echo "✓ 官网托管与询盘链路正常（$HOST）"
