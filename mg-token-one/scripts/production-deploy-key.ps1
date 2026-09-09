# 用 1Password 中的 SSH 私钥发布生产，密钥只在进程内解析，不落盘、不进命令行。
#
#   .\scripts\production-deploy-key.ps1 -UiOnly       # 纯前端发布
#   .\scripts\production-deploy-key.ps1               # 完整发布
#
# -SecretReference 指向 1Password 的私钥字段。必须带 ?ssh-format=openssh：
# 1Password 默认导出 PKCS#8（BEGIN PRIVATE KEY），虽然发布脚本也能解析，
# 但 OpenSSH 格式是 paramiko 的原生输入，少一次转换。
param(
    [string]$SecretReference = "op://Personal/jtm3zdo7tr3nikh7ijpk5zl3re/private_key?ssh-format=openssh",
    [switch]$UiOnly
)

$ErrorActionPreference = "Stop"

$op = (Get-Command op -ErrorAction SilentlyContinue).Source
if (-not $op) {
    $candidates = @(
        "$env:ProgramFiles\1Password CLI\op.exe",
        "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\AgileBits.1Password.CLI_Microsoft.Winget.Source_8wekyb3d8bbwe\op.exe"
    )
    $op = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $op) {
    throw "找不到 1Password CLI（op）。安装：winget install AgileBits.1Password.CLI"
}

try {
    # op read 按行返回字符串数组；必须显式用换行拼接。直接赋值给 $env: 会用空格
    # 连接各行，私钥随即损坏，且报错只会说“格式不支持”，极难定位。
    $env:MG_DEPLOY_SSH_KEY = (& $op read $SecretReference) -join "`n"
    if (-not $env:MG_DEPLOY_SSH_KEY) {
        throw "op read 未取到私钥：$SecretReference"
    }

    $deploy = Join-Path $PSScriptRoot "production-deploy.py"
    if ($UiOnly) {
        python $deploy --ui-only
    }
    else {
        python $deploy
    }
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}
finally {
    Remove-Item Env:MG_DEPLOY_SSH_KEY -ErrorAction SilentlyContinue
}
