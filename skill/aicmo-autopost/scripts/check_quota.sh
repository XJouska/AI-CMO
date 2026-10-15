#!/usr/bin/env bash
# check_quota.sh — verify AI-CMO API key and print remaining credits.
#
# Usage:
#   AICMO_API_KEY=sk-cmo-xxx ./check_quota.sh
#
# Exit codes:
#   0  key valid, credits > 0
#   1  missing API key
#   2  auth failed (401/403)
#   3  zero credits
#   4  network / other error
set -euo pipefail

if [[ -z "${AICMO_API_KEY:-}" ]]; then
  echo "ERROR: AICMO_API_KEY is not set. Get one at https://www.aicmo.site → Settings → API Keys" >&2
  exit 1
fi

BASE_URL="${AICMO_API_URL:-https://www.aicmo.site}/api/v1/open"

response="$(curl -sS -w "\n%{http_code}" \
  -H "x-api-key: ${AICMO_API_KEY}" \
  "${BASE_URL}/quota")" || {
  echo "ERROR: network failure talking to AI-CMO" >&2
  exit 4
}

http_code="$(echo "${response}" | tail -n1)"
body="$(echo "${response}" | sed '$d')"

case "${http_code}" in
  200) ;;
  401|403)
    echo "ERROR: API key rejected (HTTP ${http_code}). Check AICMO_API_KEY." >&2
    exit 2
    ;;
  *)
    echo "ERROR: unexpected HTTP ${http_code}: ${body}" >&2
    exit 4
    ;;
esac

# Extract credits_remaining without requiring jq
credits="$(printf '%s' "${body}" | sed -n 's/.*"credits_remaining"[[:space:]]*:[[:space:]]*\([0-9]\+\).*/\1/p')"

if [[ -z "${credits}" ]]; then
  echo "ERROR: could not parse response: ${body}" >&2
  exit 4
fi

echo "AI-CMO credits remaining: ${credits}"

if (( credits <= 0 )); then
  echo "WARNING: no credits left. Top up at https://www.aicmo.site" >&2
  exit 3
fi
