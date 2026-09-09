$ErrorActionPreference = 'Stop'
$savedBase = $env:VITE_APP_BASE
$savedOrigin = $env:VITE_DESKTOP_ORIGIN
try {
    $env:VITE_APP_BASE = '/apps/office-one/'
    $env:VITE_DESKTOP_ORIGIN = 'https://desktop.meta-gravity.com'
    & npm run build --prefix ../mg-office-one
    if ($LASTEXITCODE -ne 0) { throw 'Office 生产构建失败' }
} finally {
    $env:VITE_APP_BASE = $savedBase
    $env:VITE_DESKTOP_ORIGIN = $savedOrigin
}
