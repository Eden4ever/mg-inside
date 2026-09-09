$ErrorActionPreference = 'Stop'
$savedBase = $env:VITE_APP_BASE_URL
$savedApi = $env:VITE_API_BASE_URL
$savedOrigin = $env:VITE_DESKTOP_ORIGIN
$savedMode = $env:VITE_IDENTITY_TOKEN_MODE
try {
    $env:VITE_APP_BASE_URL = '/knowledge-base-inside/'
    $env:VITE_API_BASE_URL = '/knowledge-base-inside/api'
    $env:VITE_DESKTOP_ORIGIN = 'https://desktop.meta-gravity.com'
    $env:VITE_IDENTITY_TOKEN_MODE = 'unified'
    & npm run build --prefix ../mg-expert-database/apps/web
    if ($LASTEXITCODE -ne 0) { throw '知识库生产构建失败' }
} finally {
    $env:VITE_APP_BASE_URL = $savedBase
    $env:VITE_API_BASE_URL = $savedApi
    $env:VITE_DESKTOP_ORIGIN = $savedOrigin
    $env:VITE_IDENTITY_TOKEN_MODE = $savedMode
}
