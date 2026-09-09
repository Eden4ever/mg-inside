#!/usr/bin/env bash
set -euo pipefail

runtime_api_key="${DEEPSEEK_API_KEY:-}"
set -a
# shellcheck disable=SC1091
. /etc/mg-expert-database/api.env
set +a
if [[ -n "$runtime_api_key" ]]; then
  DEEPSEEK_API_KEY="$runtime_api_key"
fi
unset runtime_api_key

if [[ -z "${DEEPSEEK_API_KEY:-}" ]]; then
  echo "deepseek_key|missing" >&2
  exit 2
fi

curl --fail --silent --show-error \
  --connect-timeout 10 \
  --max-time 30 \
  -H "Authorization: Bearer ${DEEPSEEK_API_KEY}" \
  https://api.deepseek.com/models \
  | node -e '
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      const payload = JSON.parse(input);
      const ids = Array.isArray(payload.data)
        ? payload.data.map((item) => item?.id).filter((id) => typeof id === "string").sort()
        : [];
      if (!ids.length) throw new Error("DeepSeek returned no model IDs.");
      for (const id of ids) console.log(`model|${id}`);
    });
  '
