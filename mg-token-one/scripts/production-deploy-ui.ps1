$ErrorActionPreference = "Stop"

$securePassword = Read-Host "生产 SSH 密码" -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)

try {
    $env:MG_DEPLOY_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    python (Join-Path $PSScriptRoot "production-deploy.py") --ui-only
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}
finally {
    if ($passwordPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    }
    Remove-Item Env:MG_DEPLOY_PASSWORD -ErrorAction SilentlyContinue
}
