#!/usr/bin/env bash
# fetch_promotions.sh — call AI-CMO /analyze/csv and save promotions.csv.
#
# Usage:
#   AICMO_API_KEY=sk-cmo-xxx ./fetch_promotions.sh <product> [language] [max_results] [output_path]
#
# Examples:
#   ./fetch_promotions.sh "https://u2foru.site"
#   ./fetch_promotions.sh "U2forU YouTube Downloader" en 8 ./promotions.csv
#
# Consumes 1 credit per successful call. Failed analyses are auto-refunded server-side.
set -euo pipefail

if [[ -z "${AICMO_API_KEY:-}" ]]; then
  echo "ERROR: AICMO_API_KEY is not set." >&2
  exit 1
fi

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <product> [language=en] [max_results=8] [output=./promotions.csv]" >&2
  exit 1
fi

product="$1"
language="${2:-en}"
max_results="${3:-8}"
output="${4:-./promotions.csv}"

BASE_URL="${AICMO_API_URL:-https://www.aicmo.site}/api/v1/open"

# Build JSON body without requiring jq. Escape double quotes and backslashes in product.
escape_json() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  printf '%s' "$s"
}
product_esc="$(escape_json "${product}")"
language_esc="$(escape_json "${language}")"
body="{\"product\":\"${product_esc}\",\"language\":\"${language_esc}\",\"max_results\":${max_results}}"

echo "→ Analyzing '${product}' (language=${language}, max_results=${max_results})…"
echo "  This typically takes 2–4 minutes (scraping 6 platforms + AI scoring)."

tmp="$(mktemp)"
http_code="$(curl -sS --max-time 360 -w "%{http_code}" -o "${tmp}" \
  -X POST "${BASE_URL}/analyze/csv" \
  -H "x-api-key: ${AICMO_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "${body}")" || {
  echo "ERROR: network failure or timeout." >&2
  rm -f "${tmp}"
  exit 4
}

case "${http_code}" in
  200)
    mv "${tmp}" "${output}"
    lines="$(wc -l < "${output}" | tr -d ' ')"
    echo "✓ Saved ${output} (${lines} lines including header)"
    ;;
  401|403)
    echo "ERROR: API key rejected (HTTP ${http_code})." >&2
    rm -f "${tmp}"; exit 2 ;;
  402)
    echo "ERROR: insufficient credits. Top up at https://www.aicmo.site" >&2
    rm -f "${tmp}"; exit 3 ;;
  *)
    echo "ERROR: HTTP ${http_code}" >&2
    cat "${tmp}" >&2 || true
    rm -f "${tmp}"; exit 4 ;;
esac
