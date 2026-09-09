param(
  [string]$IdentityFile,
  [Parameter(Mandatory = $true)]
  [string]$ArchivePath,
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^stage[1-9]\d*-\d{8}-\d{6}$')]
  [string]$ReleaseId,
  [string]$Server = '43.139.78.226',
  [string]$RemoteUser = 'root'
)

$ErrorActionPreference = 'Stop'
$workspace = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$sshOptions = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes')
if ($IdentityFile) {
  $identity = [System.IO.Path]::GetFullPath($IdentityFile)
  if (-not (Test-Path -LiteralPath $identity -PathType Leaf)) { throw 'SSH identity file does not exist.' }
  $sshOptions += @('-i', $identity)
}
$archive = [System.IO.Path]::GetFullPath($ArchivePath)
$remoteScript = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'remote-deploy-stage1.sh'))

if (-not (Test-Path -LiteralPath $archive -PathType Leaf)) { throw 'Release archive does not exist.' }
if (-not $archive.StartsWith($workspace, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Release archive must be inside the workspace.' }

$remoteArchive = "/tmp/$ReleaseId.tar.gz"
$remoteDeploy = "/tmp/remote-deploy-$ReleaseId.sh"
$target = "${RemoteUser}@${Server}"

& scp @sshOptions -- $archive "${target}:$remoteArchive"
if ($LASTEXITCODE -ne 0) { throw 'Failed to upload release archive.' }
& scp @sshOptions -- $remoteScript "${target}:$remoteDeploy"
if ($LASTEXITCODE -ne 0) { throw 'Failed to upload deployment script.' }
& ssh @sshOptions -- $target "sed -i 's/\r$//' '$remoteDeploy' && bash '$remoteDeploy' '$remoteArchive' '$ReleaseId'"
if ($LASTEXITCODE -ne 0) { throw 'Remote deployment failed. Inspect the reported backup before any rollback.' }
