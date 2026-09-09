#!/usr/bin/env bash
set -euo pipefail

base="${TOKEN_ONE_BASE_URL:-http://127.0.0.1:3001}"

live=$(curl -fsS "$base/api/health/live")
ready=$(curl -fsS "$base/api/health/ready")
messages_status=$(curl -sS -o /tmp/token-one-messages-error.json -w '%{http_code}' \
  -X POST "$base/v1/messages" \
  -H 'anthropic-version: 2023-06-01' \
  -H 'Content-Type: application/json' \
  -d '{"model":"claude-sonnet-4-6","max_tokens":8,"messages":[{"role":"user","content":"hi"}]}')

printf 'live=%s\nready=%s\nmessages_unauthorized=%s\n' "$live" "$ready" "$messages_status"
printf '%s' "$live" | grep -q '"status":"ok"'
printf '%s' "$ready" | grep -q '"status":"ready"'
printf '%s' "$ready" | grep -q '"autoCircuitBreakerEnabled":false'
printf '%s' "$live" | grep -Eq '"releaseId":"[0-9]{8}T[0-9]{6}Z"'
printf '%s' "$ready" | grep -Eq '"releaseId":"[0-9]{8}T[0-9]{6}Z"'
printf '%s' "$live" | grep -Eq '"releaseSha256":"[a-f0-9]{64}"'
printf '%s' "$ready" | grep -Eq '"releaseSha256":"[a-f0-9]{64}"'
live_release=$(printf '%s' "$live" | sed -n 's/.*"releaseId":"\([^"]*\)".*/\1/p')
ready_release=$(printf '%s' "$ready" | sed -n 's/.*"releaseId":"\([^"]*\)".*/\1/p')
live_sha256=$(printf '%s' "$live" | sed -n 's/.*"releaseSha256":"\([^"]*\)".*/\1/p')
ready_sha256=$(printf '%s' "$ready" | sed -n 's/.*"releaseSha256":"\([^"]*\)".*/\1/p')
test -n "$live_release"
test "$live_release" = "$ready_release"
test -n "$live_sha256"
test "$live_sha256" = "$ready_sha256"
test "$messages_status" = "401"
grep -q '"type":"authentication_error"' /tmp/token-one-messages-error.json
rm -f /tmp/token-one-messages-error.json
