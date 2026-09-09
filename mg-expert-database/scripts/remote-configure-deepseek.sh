#!/usr/bin/env bash
set -euo pipefail

model="${1:-deepseek-v4-flash}"
backup_id="${2:?backup id is required}"
env_file="/etc/mg-expert-database/api.env"
backup_root="/opt/mg-expert-database/backups/$backup_id"

case "$backup_id" in
  m4-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]) ;;
  *) echo "invalid backup id" >&2; exit 2 ;;
esac

case "$model" in
  deepseek-v4-flash|deepseek-v4-pro) ;;
  *) echo "unsupported production model" >&2; exit 2 ;;
esac

test -f "$env_file"
test ! -e "$backup_root"
IFS= read -r api_key
if [[ ! "$api_key" =~ ^sk-[A-Za-z0-9._-]+$ ]]; then
  echo "invalid API key format" >&2
  exit 2
fi

mkdir -p "$backup_root"
cp -a "$env_file" "$backup_root/api.env"
tmp_file="$(mktemp /etc/mg-expert-database/api.env.XXXXXX)"
trap 'unset api_key; rm -f "$tmp_file"' EXIT

key_seen=0
model_seen=0
timeout_seen=0
tokens_seen=0
rate_seen=0
while IFS= read -r line || [[ -n "$line" ]]; do
  case "$line" in
    DEEPSEEK_API_KEY=*) printf 'DEEPSEEK_API_KEY="%s"\n' "$api_key"; key_seen=1 ;;
    DEEPSEEK_MODEL=*) printf 'DEEPSEEK_MODEL="%s"\n' "$model"; model_seen=1 ;;
    DEEPSEEK_REQUEST_TIMEOUT_MS=*) printf 'DEEPSEEK_REQUEST_TIMEOUT_MS=45000\n'; timeout_seen=1 ;;
    DEEPSEEK_MAX_OUTPUT_TOKENS=*) printf 'DEEPSEEK_MAX_OUTPUT_TOKENS=1200\n'; tokens_seen=1 ;;
    AI_MAX_REQUESTS_PER_USER_PER_MINUTE=*) printf 'AI_MAX_REQUESTS_PER_USER_PER_MINUTE=5\n'; rate_seen=1 ;;
    *) printf '%s\n' "$line" ;;
  esac
done < "$env_file" > "$tmp_file"

[[ "$key_seen" == 1 ]] || printf 'DEEPSEEK_API_KEY="%s"\n' "$api_key" >> "$tmp_file"
[[ "$model_seen" == 1 ]] || printf 'DEEPSEEK_MODEL="%s"\n' "$model" >> "$tmp_file"
[[ "$timeout_seen" == 1 ]] || printf 'DEEPSEEK_REQUEST_TIMEOUT_MS=45000\n' >> "$tmp_file"
[[ "$tokens_seen" == 1 ]] || printf 'DEEPSEEK_MAX_OUTPUT_TOKENS=1200\n' >> "$tmp_file"
[[ "$rate_seen" == 1 ]] || printf 'AI_MAX_REQUESTS_PER_USER_PER_MINUTE=5\n' >> "$tmp_file"

install -o root -g root -m 600 "$tmp_file" "$env_file"
unset api_key
systemctl restart mg-expert-database-api

for _ in $(seq 1 30); do
  if systemctl is-active --quiet mg-expert-database-api && curl --fail --silent http://127.0.0.1:4100/api/health >/dev/null; then
    break
  fi
  sleep 1
done

systemctl is-active --quiet mg-expert-database-api
curl --fail --silent --show-error http://127.0.0.1:4100/api/health >/dev/null
curl --fail --silent --show-error http://127.0.0.1:4100/api/ai/status \
  | node -e '
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      const status = JSON.parse(input);
      console.log(JSON.stringify({
        configured: status.configured,
        provider: status.provider,
        model: status.model,
        streaming: status.streaming,
        promptVersion: status.promptVersion,
      }));
      if (!status.configured || status.model !== process.argv[1]) process.exitCode = 2;
    });
  ' "$model"

echo "backup|$backup_root/api.env"
