param([string]$CodexHome)
$ErrorActionPreference = "Stop"

$homePath = if ($CodexHome) { $CodexHome } elseif ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME '.codex' }
$homePath = [IO.Path]::GetFullPath($homePath)
$catalogPath = Join-Path $homePath 'token-one-gpt6-models.json'
$configPath = Join-Path $homePath 'config.toml'
$catalog = @'
{"models":[{"slug":"gpt-6-astra","display_name":"GPT-6 Astra","description":"Token One Responses relay model backed by the configured upstream provider.","default_reasoning_level":"medium","supported_reasoning_levels":[{"effort":"low","description":"Fast responses with lighter reasoning"},{"effort":"medium","description":"Balances speed and reasoning depth for everyday tasks"},{"effort":"high","description":"Greater reasoning depth for complex problems"},{"effort":"xhigh","description":"Extra high reasoning depth for complex problems"}],"shell_type":"shell_command","visibility":"list","supported_in_api":true,"priority":1,"additional_speed_tiers":[],"availability_nux":null,"upgrade":null,"model_messages":{"instructions_template":"You are Codex, an AI coding agent using the GPT-6 Astra model."},"input_modalities":["text"],"output_modalities":["text"],"context_window":1048576,"max_context_window":1048576,"effective_context_window_percent":95,"truncation_policy":{"mode":"tokens","limit":10000},"supports_image_detail_original":false,"supports_parallel_tool_calls":true,"support_verbosity":true,"default_verbosity":"low","use_responses_lite":false,"supports_search_tool":false,"web_search_tool_type":"text","experimental_supported_tools":[],"include_plugin_usage_instructions":true,"include_skills_usage_instructions":true}]}
'@

function Set-TopLevelKey([string]$text, [string]$key, [string]$value) {
    $lines = if ($text) { @($text -split "\r?\n") } else { @() }
    $pattern = '^\s*' + [regex]::Escape($key) + '\s*='
    $found = @()
    $firstTable = -1
    $inTable = $false
    for ($index = 0; $index -lt $lines.Count; $index++) {
        if ($lines[$index] -match '^\s*\[[^\[]') { $inTable = $true; if ($firstTable -lt 0) { $firstTable = $index } }
        if (-not $inTable -and $lines[$index] -match $pattern) { $found += $index }
    }
    if ($found.Count -gt 1) { throw "Duplicate top-level key: $key" }
    $replacement = "$key = $value"
    if ($found.Count -eq 1) { $lines[$found[0]] = $replacement }
    elseif ($firstTable -ge 0) {
        $before = if ($firstTable -gt 0) { @($lines[0..($firstTable - 1)]) } else { @() }
        $lines = @($before + $replacement + @($lines[$firstTable..($lines.Count - 1)]))
    } else {
        if ($lines.Count -gt 0 -and $lines[$lines.Count - 1]) { $lines += '' }
        $lines += $replacement
    }
    return (($lines -join "`n").TrimEnd("`n") + "`n")
}

New-Item -ItemType Directory -Path $homePath -Force | Out-Null
$catalog | Set-Content -LiteralPath $catalogPath -Encoding UTF8
$original = if (Test-Path -LiteralPath $configPath) { Get-Content -Raw -Encoding UTF8 $configPath } else { '' }
$updated = Set-TopLevelKey $original 'model' '"gpt-6-astra"'
$escapedCatalogPath = $catalogPath.Replace('\', '\\').Replace('"', '\"')
$updated = Set-TopLevelKey $updated 'model_catalog_json' ('"' + $escapedCatalogPath + '"')
if ($original -ne $updated -and (Test-Path -LiteralPath $configPath)) {
    Copy-Item -LiteralPath $configPath -Destination ($configPath + '.bak.gpt6-' + (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ'))
}
if ($original -ne $updated -or -not (Test-Path -LiteralPath $configPath)) { $updated | Set-Content -LiteralPath $configPath -Encoding UTF8 }
Write-Output "GPT-6 Astra model catalog installed."
Write-Output "Model: gpt-6-astra"
Write-Output "Existing CC Switch provider configuration was preserved."
Write-Output "Restart Codex Desktop to reload the model selector."
