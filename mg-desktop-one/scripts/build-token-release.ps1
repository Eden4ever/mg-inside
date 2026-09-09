$ErrorActionPreference = 'Stop'
$savedOrigin = $env:VITE_DESKTOP_ORIGIN
$savedMode = $env:VITE_IDENTITY_TOKEN_MODE
try {
    $env:VITE_DESKTOP_ORIGIN = 'https://desktop.meta-gravity.com'
    $env:VITE_IDENTITY_TOKEN_MODE = 'unified'
    & npm run typecheck --prefix ../mg-token-one/mg-gateway/apps/web
    if ($LASTEXITCODE -ne 0) { throw 'Token 前端类型检查失败' }
    & npm run build --prefix ../mg-token-one/mg-gateway/apps/web
    if ($LASTEXITCODE -ne 0) { throw 'Token 前端生产构建失败' }
} finally {
    $env:VITE_DESKTOP_ORIGIN = $savedOrigin
    $env:VITE_IDENTITY_TOKEN_MODE = $savedMode
}
