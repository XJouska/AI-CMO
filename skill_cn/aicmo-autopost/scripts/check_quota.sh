#!/usr/bin/env bash
# check_quota.sh — 校验 AI-CMO API Key 并打印剩余积分。
#
# 用法：
#   AICMO_API_KEY=sk-cmo-xxx ./check_quota.sh
#
# 退出码：
#   0  Key 有效且积分 > 0
#   1  未设置 API Key
#   2  鉴权失败（401/403）
#   3  积分为 0
#   4  网络或其他错误
set -euo pipefail

if [[ -z "${AICMO_API_KEY:-}" ]]; then
  echo "错误：未设置 AICMO_API_KEY。请到 https://www.aicmo.site → 设置 → API 密钥 获取。" >&2
  exit 1
fi

BASE_URL="${AICMO_API_URL:-https://www.aicmo.site}/api/v1/open"

response="$(curl -sS -w "\n%{http_code}" \
  -H "x-api-key: ${AICMO_API_KEY}" \
  "${BASE_URL}/quota")" || {
  echo "错误：访问 AI-CMO 网络失败" >&2
  exit 4
}

http_code="$(echo "${response}" | tail -n1)"
body="$(echo "${response}" | sed '$d')"

case "${http_code}" in
  200) ;;
  401|403)
    echo "错误：API Key 被拒绝（HTTP ${http_code}），请检查 AICMO_API_KEY。" >&2
    exit 2
    ;;
  *)
    echo "错误：非预期 HTTP ${http_code}：${body}" >&2
    exit 4
    ;;
esac

# 不依赖 jq 解析 credits_remaining
credits="$(printf '%s' "${body}" | sed -n 's/.*"credits_remaining"[[:space:]]*:[[:space:]]*\([0-9]\+\).*/\1/p')"

if [[ -z "${credits}" ]]; then
  echo "错误：无法解析响应：${body}" >&2
  exit 4
fi

echo "AI-CMO 剩余积分：${credits}"

if (( credits <= 0 )); then
  echo "警告：积分不足，请到 https://www.aicmo.site 充值。" >&2
  exit 3
fi
