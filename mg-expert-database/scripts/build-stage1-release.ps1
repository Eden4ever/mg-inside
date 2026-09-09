param(
  [string]$ReleaseId = ('stage1-' + (Get-Date -Format 'yyyyMMdd-HHmmss')),
  [string]$WebSource
)

$ErrorActionPreference = 'Stop'
if ($ReleaseId -notmatch '^stage[1-9]\d*-\d{8}-\d{6}$') { throw 'Invalid release id.' }

$workspace = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$artifactsRoot = [System.IO.Path]::GetFullPath((Join-Path $workspace 'artifacts'))
$releaseRoot = [System.IO.Path]::GetFullPath((Join-Path $artifactsRoot $ReleaseId))
$archivePath = [System.IO.Path]::GetFullPath((Join-Path $artifactsRoot "$ReleaseId.tar.gz"))

if (-not $releaseRoot.StartsWith($artifactsRoot, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Release path escaped artifacts directory.' }
if (Test-Path -LiteralPath $releaseRoot) { throw 'Release directory already exists.' }
if (Test-Path -LiteralPath $archivePath) { throw 'Release archive already exists.' }

$webSource = if ($WebSource) { [System.IO.Path]::GetFullPath($WebSource) } else { Join-Path $workspace 'apps\web\dist' }
$apiSource = Join-Path $workspace 'apps\api'
$contractsSource = Join-Path $workspace 'packages\contracts'
if (-not $webSource.StartsWith($workspace, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Web source must be inside the workspace.' }
if (-not (Test-Path -LiteralPath (Join-Path $apiSource 'src\main.ts') -PathType Leaf)) { throw 'API source is missing.' }
if (-not (Test-Path -LiteralPath (Join-Path $apiSource 'dist\apps\api\src\main.js') -PathType Leaf)) { throw 'API production build is missing.' }
if (-not (Test-Path -LiteralPath (Join-Path $apiSource 'prisma\migrations\20260822000900_add_indicator_system_access\migration.sql') -PathType Leaf)) { throw 'Required access migration is missing.' }
if (-not (Test-Path -LiteralPath (Join-Path $contractsSource 'dist\index.js') -PathType Leaf)) { throw 'Contracts build is missing.' }
if (-not (Test-Path -LiteralPath (Join-Path $contractsSource 'dist\package.json') -PathType Leaf)) { throw 'Contracts runtime package metadata is missing.' }
if (-not (Test-Path -LiteralPath (Join-Path $webSource 'index.html') -PathType Leaf)) { throw 'Web build is missing.' }
if (-not (Select-String -LiteralPath (Join-Path $webSource 'index.html') -SimpleMatch '/knowledge-base-inside/' -Quiet)) { throw 'Web build does not use the production base path.' }
$webScripts = Get-ChildItem -LiteralPath (Join-Path $webSource 'assets') -Filter '*.js' -File
if (-not ($webScripts | Select-String -SimpleMatch '/knowledge-base-inside/api' -Quiet)) { throw 'Web build does not use the production API base path.' }

New-Item -ItemType Directory -Path (Join-Path $releaseRoot 'source\apps\api') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $releaseRoot 'source\packages\contracts') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $releaseRoot 'web') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $releaseRoot 'source\docs') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $releaseRoot 'source\apps\web') -Force | Out-Null
# 携带完整工作区依赖声明，发布端按锁文件安装，不继承旧版本依赖。
foreach ($dependencyFile in @('package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml')) {
  Copy-Item -LiteralPath (Join-Path $workspace $dependencyFile) -Destination (Join-Path $releaseRoot 'source')
}
Copy-Item -LiteralPath (Join-Path $apiSource 'package.json') -Destination (Join-Path $releaseRoot 'source\apps\api')
Copy-Item -LiteralPath (Join-Path $workspace 'apps\web\package.json') -Destination (Join-Path $releaseRoot 'source\apps\web')
Copy-Item -LiteralPath (Join-Path $workspace 'docs\research-module-schema.json') -Destination (Join-Path $releaseRoot 'source\docs')
Copy-Item -LiteralPath (Join-Path $apiSource 'src') -Destination (Join-Path $releaseRoot 'source\apps\api') -Recurse
Copy-Item -LiteralPath (Join-Path $apiSource 'dist') -Destination (Join-Path $releaseRoot 'source\apps\api') -Recurse
Copy-Item -LiteralPath (Join-Path $apiSource 'prisma') -Destination (Join-Path $releaseRoot 'source\apps\api') -Recurse
Copy-Item -LiteralPath (Join-Path $contractsSource 'src') -Destination (Join-Path $releaseRoot 'source\packages\contracts') -Recurse
Copy-Item -LiteralPath (Join-Path $contractsSource 'dist') -Destination (Join-Path $releaseRoot 'source\packages\contracts') -Recurse
Copy-Item -LiteralPath (Join-Path $contractsSource 'package.json') -Destination (Join-Path $releaseRoot 'source\packages\contracts')
New-Item -ItemType Directory -Path (Join-Path $releaseRoot 'deploy') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $workspace 'deploy\mg-expert-database-api.service') -Destination (Join-Path $releaseRoot 'deploy')
Copy-Item -LiteralPath (Join-Path $workspace 'deploy\install-node-runtime.sh') -Destination (Join-Path $releaseRoot 'deploy')
Copy-Item -Path (Join-Path $webSource '*') -Destination (Join-Path $releaseRoot 'web') -Recurse

$files = Get-ChildItem -LiteralPath $releaseRoot -Recurse -File | Sort-Object FullName
$manifest = foreach ($file in $files) {
  $relative = [System.IO.Path]::GetRelativePath($releaseRoot, $file.FullName).Replace('\', '/')
  $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  "$hash  $relative"
}
[System.IO.File]::WriteAllText((Join-Path $releaseRoot 'SHA256SUMS'), (($manifest -join "`n") + "`n"), [System.Text.UTF8Encoding]::new($false))

& tar -czf $archivePath -C $releaseRoot .
if ($LASTEXITCODE -ne 0) { throw 'Failed to create release archive.' }

[pscustomobject]@{
  ReleaseId = $ReleaseId
  Directory = $releaseRoot
  Archive = $archivePath
  Sha256 = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  Bytes = (Get-Item -LiteralPath $archivePath).Length
} | ConvertTo-Json -Compress
