param(
    [string]$ReleaseId = ([DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')),
    [string]$FilesServerSource = '',
    [string]$FilesAppSource = '',
    [string]$IdentityBackendSource = '',
    [string]$DesktopAppSource = '',
    [string]$ApplicationCatalogSource = ''
)
$ErrorActionPreference = 'Stop'
if ($ReleaseId -notmatch '^\d{8}T\d{6}Z$') { throw '发布编号必须是 UTC yyyyMMddTHHmmssZ。' }
$desktopRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$workspaceRoot = [IO.Path]::GetDirectoryName($desktopRoot)
$releaseRoot = Join-Path $desktopRoot "artifacts/platform-$ReleaseId"
$archive = "$releaseRoot.tar.gz"
if ((Test-Path -LiteralPath $releaseRoot) -or (Test-Path -LiteralPath $archive)) { throw '发布目录已存在，禁止覆盖。' }
$oldBase = $env:VITE_APP_BASE
$oldDesktop = $env:VITE_DESKTOP_ORIGIN
function Run-Build([string]$directory, [string]$base) {
    $env:VITE_APP_BASE = $base
    Push-Location $directory
    try { & npm run build; if ($LASTEXITCODE -ne 0) { throw "构建失败：$directory" } }
    finally { Pop-Location }
}
function Copy-Tree([string]$source, [string]$destination) {
    if (-not (Test-Path -LiteralPath $source -PathType Container)) { throw "缺少目录：$source" }
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    Get-ChildItem -LiteralPath $source -Force | ForEach-Object {
        if ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw '发布素材不能是符号链接。' }
        Copy-Item -LiteralPath $_.FullName -Destination $destination -Recurse
    }
}
try {
    $env:VITE_DESKTOP_ORIGIN = 'https://desktop.meta-gravity.com'
    New-Item -ItemType Directory -Path $releaseRoot | Out-Null
    $desktopApp = if ($DesktopAppSource) { [IO.Path]::GetFullPath($DesktopAppSource) } else { $desktopRoot }
    Run-Build $desktopApp '/'
    New-Item -ItemType Directory -Path "$releaseRoot/desktop" | Out-Null
    Copy-Item -LiteralPath "$desktopApp/dist/server/main.mjs" -Destination "$releaseRoot/desktop/main.mjs"
    if (Test-Path -LiteralPath "$desktopApp/dist/server/service-storage-admin.mjs") {
        Copy-Item -LiteralPath "$desktopApp/dist/server/service-storage-admin.mjs" -Destination "$releaseRoot/desktop/service-storage-admin.mjs"
    }
    Copy-Tree "$desktopApp/dist/web" "$releaseRoot/desktop/web"
    $applicationCatalog = if ($ApplicationCatalogSource) { [IO.Path]::GetFullPath($ApplicationCatalogSource) } else { "$workspaceRoot/mg-platform/packages/frontend/config/application-catalog.json" }
    Copy-Item -LiteralPath $applicationCatalog -Destination "$releaseRoot/application-catalog.json"
    foreach ($app in @(
        @{ Repo='mg-personal-one'; Id='personal-center' },
        @{ Repo='mg-app-manager-one'; Id='app-manager' },
        @{ Repo='mg-service-one'; Id='service-manager' },
        @{ Repo='mg-files-one'; Id='files' },
        @{ Repo='mg-office-one'; Id='office-one' },
        @{ Repo='mg-resource-one'; Id='resource-manager' }
    )) {
        $repo = if ($app.Id -eq 'files' -and $FilesAppSource) { [IO.Path]::GetFullPath($FilesAppSource) } else { Join-Path $workspaceRoot $app.Repo }
        Run-Build $repo "/apps/$($app.Id)/"
        Copy-Tree "$repo/dist" "$releaseRoot/static/apps/$($app.Id)"
    }
    $filesBackend = if ($FilesServerSource) { [IO.Path]::GetFullPath($FilesServerSource) } else { "$workspaceRoot/mg-files-one" }
    Copy-Tree "$filesBackend/server" "$releaseRoot/files/server"
    Copy-Item -LiteralPath "$filesBackend/package.json" -Destination "$releaseRoot/files/package.json"
    Copy-Tree "$workspaceRoot/mg-resource-one/server" "$releaseRoot/resource/server"
    Copy-Item -LiteralPath "$workspaceRoot/mg-resource-one/scripts/install-service.sh" -Destination "$releaseRoot/resource/install-service.sh"
    $identity = Join-Path $workspaceRoot 'mg-auth-one-identity'
    $identityBackend = if ($IdentityBackendSource) { [IO.Path]::GetFullPath($IdentityBackendSource) } else { $identity }
    # 中心登录页和管理应用分别构建。登录原站点仍使用 / 基路径。
    # 不执行中心 npm run build，避免覆盖本机 14200 正在使用的 dist/public。
    Push-Location $identityBackend
    try {
        & node node_modules/typescript/bin/tsc -p tsconfig.json --outDir "$releaseRoot/identity/dist"
        if ($LASTEXITCODE -ne 0) { throw '身份后端构建失败。' }
    } finally { Pop-Location }
    Copy-Tree "$identityBackend/prisma" "$releaseRoot/identity/prisma"
    Copy-Tree "$identityBackend/scripts" "$releaseRoot/identity/scripts"
    Copy-Item -LiteralPath "$identityBackend/package.json", "$identityBackend/package-lock.json" -Destination "$releaseRoot/identity"
    Push-Location "$identity/web"
    try {
        & node node_modules/vue-tsc/bin/vue-tsc.js --noEmit
        if ($LASTEXITCODE -ne 0) { throw '身份前端类型检查失败。' }
        $env:VITE_APP_BASE = '/'
        & node node_modules/vite/bin/vite.js build --outDir "$releaseRoot/identity/dist/public"
        if ($LASTEXITCODE -ne 0) { throw '身份登录前端构建失败。' }
        $env:VITE_APP_BASE = '/apps/identity/'
        & node node_modules/vite/bin/vite.js build --outDir "$releaseRoot/static/apps/identity"
        if ($LASTEXITCODE -ne 0) { throw '身份管理前端构建失败。' }
    } finally { Pop-Location }
    foreach ($appDirectory in Get-ChildItem -LiteralPath "$releaseRoot/static/apps" -Directory) {
        & node "$desktopRoot/scripts/check-embedded-build.mjs" $appDirectory.FullName
        if ($LASTEXITCODE -ne 0) { throw "嵌入样式检查失败：$($appDirectory.Name)" }
        $metadata = @{ schemaVersion=1; appId=$appDirectory.Name; version=$ReleaseId; indexSHA256=(Get-FileHash -LiteralPath "$($appDirectory.FullName)/index.html" -Algorithm SHA256).Hash.ToLowerInvariant() } | ConvertTo-Json -Compress
        [IO.File]::WriteAllText("$($appDirectory.FullName)/version.json", $metadata + "`n", [Text.UTF8Encoding]::new($false))
    }
    Copy-Tree $PSScriptRoot "$releaseRoot/deploy"
    foreach ($entry in Get-ChildItem -LiteralPath $releaseRoot -Recurse -Force) {
        if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $entry.Name -eq 'node_modules' -or $entry.Name -eq '.env' -or $entry.Name -match '\.(pem|key|p12)$') {
            throw "发布包出现不允许的条目：$($entry.FullName)"
        }
    }
    $checksums = Get-ChildItem -LiteralPath $releaseRoot -File -Recurse | Sort-Object FullName | ForEach-Object {
        $relative = [IO.Path]::GetRelativePath($releaseRoot, $_.FullName).Replace('\','/')
        "$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant())  $relative"
    }
    [IO.File]::WriteAllText("$releaseRoot/SHA256SUMS", ($checksums -join "`n") + "`n", [Text.UTF8Encoding]::new($false))
    & tar -czf $archive -C $releaseRoot .
    if ($LASTEXITCODE -ne 0) { throw '归档失败。' }
    [pscustomobject]@{ ReleaseId=$ReleaseId; Archive=$archive; Sha256=(Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() } | ConvertTo-Json
} finally {
    $env:VITE_APP_BASE = $oldBase
    $env:VITE_DESKTOP_ORIGIN = $oldDesktop
}
