#!/usr/bin/env bash
# fetch_promotions.sh — 调用 AI-CMO /analyze/csv 并保存 promotions.csv。
#
# 用法：
#   AICMO_API_KEY=sk-cmo-xxx ./fetch_promotions.sh <产品> [语言] [结果数] [输出路径]
#
# 示例：
#   ./fetch_promotions.sh "https://u2foru.site"
#   ./fetch_promotions.sh "U2forU YouTube 下载器" zh 8 ./promotions.csv
#
# 每次成功调用消耗 1 积分；服务端失败会自动退回。
set -euo pipefail

if [[ -z "${AICMO_API_KEY:-}" ]]; then
  echo "错误：未设置 AICMO_API_KEY。" >&2
  exit 1
fi

if [[ $# -lt 1 ]]; then
  echo "用法：$0 <产品> [语言=zh] [结果数=8] [输出=./promotions.csv]" >&2
  exit 1
fi

product="$1"
language="${2:-zh}"
max_results="${3:-8}"
output="${4:-./promotions.csv}"

BASE_URL="${AICMO_API_URL:-https://www.aicmo.site}/api/v1/open"

# 不依赖 jq 构造 JSON，转义双引号和反斜杠
escape_json() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  printf '%s' "$s"
}
product_esc="$(escape_json "${product}")"
language_esc="$(escape_json "${language}")"
body="{\"product\":\"${product_esc}\",\"language\":\"${language_esc}\",\"max_results\":${max_results}}"

echo "→ 正在分析 '${product}'（语言=${language}，结果数=${max_results}）…"
echo "  通常需要 2–4 分钟（抓取 6 个平台 + AI 评分）。"

tmp="$(mktemp)"
http_code="$(curl -sS --max-time 360 -w "%{http_code}" -o "${tmp}" \
  -X POST "${BASE_URL}/analyze/csv" \
  -H "x-api-key: ${AICMO_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "${body}")" || {
  echo "错误：网络失败或超时。" >&2
  rm -f "${tmp}"
  exit 4
}

case "${http_code}" in
  200)
    mv "${tmp}" "${output}"
    lines="$(wc -l < "${output}" | tr -d ' ')"
    echo "✓ 已保存 ${output}（共 ${lines} 行，含表头）"
    ;;
  401|403)
    echo "错误：API Key 被拒绝（HTTP ${http_code}）。" >&2
    rm -f "${tmp}"; exit 2 ;;
  402)
    echo "错误：积分不足，请到 https://www.aicmo.site 充值。" >&2
    rm -f "${tmp}"; exit 3 ;;
  *)
    echo "错误：HTTP ${http_code}" >&2
    cat "${tmp}" >&2 || true
    rm -f "${tmp}"; exit 4 ;;
esac
