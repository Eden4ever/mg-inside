$ErrorActionPreference='Stop'
foreach($taskApp in @(@{Id='service-manager';Repo='mg-service-one'},@{Id='resource-manager';Repo='mg-resource-one'},@{Id='files';Repo='mg-files-one'},@{Id='office-one';Repo='mg-office-one'})) {
  $env:VITE_APP_BASE="/apps/$($taskApp.Id)/"; $env:VITE_DESKTOP_ORIGIN='https://desktop.meta-gravity.com'
  & npm run build --prefix "../$($taskApp.Repo)"
  if($LASTEXITCODE -ne 0){throw '构建失败'}
  $taskRelease=[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
  $taskPackage=& python scripts/package-static-app.py $taskApp.Id "../$($taskApp.Repo)/dist" $taskRelease
  if($LASTEXITCODE -ne 0){throw '打包失败'}
  $taskInfo=$taskPackage|ConvertFrom-Json
  & scp $taskInfo.archive root@43.139.78.226:/tmp/
  if($LASTEXITCODE -ne 0){throw '上传失败'}
  $taskName=[IO.Path]::GetFileName($taskInfo.archive)
  & ssh root@43.139.78.226 "python3 /tmp/release-static-app.py $taskRelease $($taskApp.Id) /tmp/$taskName $($taskInfo.sha256)"
  if($LASTEXITCODE -ne 0){throw '发布失败'}
}
