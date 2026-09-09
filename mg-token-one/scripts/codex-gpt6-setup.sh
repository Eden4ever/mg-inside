#!/usr/bin/env bash
set -euo pipefail

codex_home="${CODEX_HOME:-$HOME/.codex}"
catalog_path="$codex_home/token-one-gpt6-models.json"
config_path="$codex_home/config.toml"
mkdir -p "$codex_home"
cat > "$catalog_path" <<'JSON'
{"models":[{"slug":"gpt-6-astra","display_name":"GPT-6 Astra","description":"Token One Responses relay model backed by the configured upstream provider.","default_reasoning_level":"medium","supported_reasoning_levels":[{"effort":"low","description":"Fast responses with lighter reasoning"},{"effort":"medium","description":"Balances speed and reasoning depth for everyday tasks"},{"effort":"high","description":"Greater reasoning depth for complex problems"},{"effort":"xhigh","description":"Extra high reasoning depth for complex problems"}],"shell_type":"shell_command","visibility":"list","supported_in_api":true,"priority":1,"additional_speed_tiers":[],"availability_nux":null,"upgrade":null,"model_messages":{"instructions_template":"You are Codex, an AI coding agent using the GPT-6 Astra model."},"input_modalities":["text"],"output_modalities":["text"],"context_window":1048576,"max_context_window":1048576,"effective_context_window_percent":95,"truncation_policy":{"mode":"tokens","limit":10000},"supports_image_detail_original":false,"supports_parallel_tool_calls":true,"support_verbosity":true,"default_verbosity":"low","use_responses_lite":false,"supports_search_tool":false,"web_search_tool_type":"text","experimental_supported_tools":[],"include_plugin_usage_instructions":true,"include_skills_usage_instructions":true}]}
JSON

tmp_config="$(mktemp "${TMPDIR:-/tmp}/codex-gpt6-config.XXXXXX")"
trap 'rm -f -- "$tmp_config"' EXIT
catalog_line="model_catalog_json = \"$catalog_path\""
if [ -f "$config_path" ]; then
  awk -v model_line='model = "gpt-6-astra"' -v catalog_line="$catalog_line" '
  BEGIN { in_table=0; table_started=0; model_seen=0; catalog_seen=0; model_count=0; catalog_count=0 }
  {
    if ($0 ~ /^[[:space:]]*\[/) {
      if (!table_started) { if (!model_seen) print model_line; if (!catalog_seen) print catalog_line; table_started=1 }
      in_table=1
    }
    if (!in_table && $0 ~ /^[[:space:]]*model[[:space:]]*=/) { model_count++; if (model_count > 1) exit 2; print model_line; model_seen=1; next }
    if (!in_table && $0 ~ /^[[:space:]]*model_catalog_json[[:space:]]*=/) { catalog_count++; if (catalog_count > 1) exit 3; print catalog_line; catalog_seen=1; next }
    print
  }
  END { if (!table_started) { if (!model_seen) print model_line; if (!catalog_seen) print catalog_line } }
  ' "$config_path" > "$tmp_config"
  if ! cmp -s "$config_path" "$tmp_config"; then
    cp -p -- "$config_path" "$config_path.bak.gpt6-$(date -u +%Y%m%dT%H%M%SZ)"
    mv -- "$tmp_config" "$config_path"
  fi
else
  printf '%s\n%s\n' 'model = "gpt-6-astra"' "$catalog_line" > "$config_path"
fi
trap - EXIT
printf '%s\n' 'GPT-6 Astra model catalog installed.' 'Model: gpt-6-astra' 'Existing CC Switch provider configuration was preserved.' 'Restart Codex Desktop to reload the model selector.'
