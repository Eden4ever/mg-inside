param([Parameter(ValueFromRemainingArguments=$true)][string[]]$MavenArguments)
$ErrorActionPreference = 'Stop'
$workspace = Split-Path $PSScriptRoot -Parent
$toolRoot = Join-Path $workspace '.runtime/java-tools'
$jdk = Get-ChildItem $toolRoot -Directory -Filter 'jdk-25*' | Sort-Object Name -Descending | Select-Object -First 1
$maven = Join-Path $toolRoot 'apache-maven-3.9.16/bin/mvn.cmd'
if (!$jdk -or !(Test-Path $maven)) { throw '缺少 Java 25 或 Maven，请先安装工具链或运行 scripts/setup-java.ps1。' }
$previousJavaHome = $env:JAVA_HOME
try {
    $env:JAVA_HOME = $jdk.FullName
    if ($env:KERNEL_BUILD_DIRECTORY) { $MavenArguments += "-Dkernel.build.directory=$([IO.Path]::GetFullPath($env:KERNEL_BUILD_DIRECTORY).Replace('\', '/'))" }
    & $maven '-f' (Join-Path $workspace 'pom.xml') @MavenArguments
    if ($LASTEXITCODE -ne 0) { throw "Maven 失败：$LASTEXITCODE" }
} finally { $env:JAVA_HOME = $previousJavaHome }
