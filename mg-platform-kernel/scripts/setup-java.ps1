$ErrorActionPreference = 'Stop'
$workspace = Split-Path $PSScriptRoot -Parent
$toolRoot = Join-Path $workspace '.runtime/java-tools'
New-Item -ItemType Directory -Force -Path $toolRoot | Out-Null
$jdkName = 'OpenJDK25U-jdk_x64_windows_hotspot_25.0.4.1_1.zip'
$jdkPath = Join-Path $toolRoot $jdkName
$jdkUrl = 'https://github.com/adoptium/temurin25-binaries/releases/download/jdk-25.0.4.1%2B1/' + $jdkName
$jdkDigest = '00c847d804f4a78e9f04f2683faf14fed898535b177b7fc704486cb0284e9283'
if (!(Test-Path -LiteralPath (Join-Path $toolRoot 'jdk-25.0.4.1+1/bin/java.exe'))) {
    if (!(Test-Path -LiteralPath $jdkPath)) { Invoke-WebRequest $jdkUrl -OutFile $jdkPath }
    if ((Get-FileHash -LiteralPath $jdkPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $jdkDigest) { throw 'JDK 摘要不匹配' }
    Expand-Archive -LiteralPath $jdkPath -DestinationPath $toolRoot
}
$mavenUrl = 'https://repo.maven.apache.org/maven2/org/apache/maven/apache-maven/3.9.16/apache-maven-3.9.16-bin.zip'
$mavenZip = Join-Path $toolRoot 'apache-maven-3.9.16-bin.zip'
if (!(Test-Path -LiteralPath (Join-Path $toolRoot 'apache-maven-3.9.16/bin/mvn.cmd'))) {
    if (!(Test-Path -LiteralPath $mavenZip)) { Invoke-WebRequest $mavenUrl -OutFile $mavenZip }
    $expected = (Invoke-WebRequest ($mavenUrl + '.sha512')).Content.Trim()
    if ((Get-FileHash -LiteralPath $mavenZip -Algorithm SHA512).Hash.ToLowerInvariant() -ne $expected) { throw 'Maven 摘要不匹配' }
    Expand-Archive -LiteralPath $mavenZip -DestinationPath $toolRoot
}
Write-Output '工作区 Java 工具链就绪，未修改系统 PATH。'
