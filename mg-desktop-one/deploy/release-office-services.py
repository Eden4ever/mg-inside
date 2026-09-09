"""Office 服务出口和最近打开历史增量发布，兼容已有文档与编辑会话。"""
from pathlib import Path
import hashlib,json,os,re,shutil,subprocess,sys,tarfile
release,frontend,frontend_sha,backend,backend_sha=sys.argv[1:]
assert re.fullmatch(r'\d{8}T\d{6}Z',release)
root=Path('/opt/mg-desktop');previous=(root/'current').resolve(strict=True);assert previous.is_relative_to(root/'releases')
target=root/'releases'/release;backup=root/'backups'/('office-services-'+release);assert not target.exists() and not backup.exists()
for name,digest in [(frontend,frontend_sha),(backend,backend_sha)]:assert hashlib.sha256(Path(name).read_bytes()).hexdigest()==digest
def run(args,**kwargs):return subprocess.run(args,check=True,**kwargs)
def image(service):return subprocess.check_output(['docker','inspect','mg-desktop-'+service+'-1','--format','{{.Config.Image}}'],text=True).strip()
old_files=image('files');old_desktop=image('desktop')
backup.mkdir(mode=0o700);(backup/'previous.json').write_text(json.dumps({'release':str(previous),'filesImage':old_files,'desktopImage':old_desktop}))
# 仅作备份，不在失败时恢复业务数据，避免覆盖并发编辑。
for name in ['metadata.json','office/sessions.json']:
    source=root/'shared/files'/name
    if source.exists():
        dest=backup/name;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,dest);os.chmod(dest,0o600)
shutil.copytree(previous,target)
for name,destination in [(frontend,target/'static/apps/office-one'),(backend,target/'files/server')]:
    with tarfile.open(name) as package:
        for item in package.getmembers():
            path=Path(item.name);assert not path.is_absolute() and '..' not in path.parts and (item.isfile() or item.isdir())
        package.extractall(destination,filter='data')
appdir=target/'static/apps/office-one'
for name,digest in json.loads((appdir/'build-checksums.json').read_text()).items():
    file=appdir/name;assert file.resolve().is_relative_to(appdir.resolve());assert hashlib.sha256(file.read_bytes()).hexdigest()==digest
run(['chmod','-R','a+rX',str(target)])
dockerfile=target/'deploy/office-services.Dockerfile';dockerfile.write_text(f'FROM {old_files}\nCOPY files/server /app/server\n')
run(['docker','build','-t','mg-files-service:'+release,'-f',str(dockerfile),str(target)])
run(['docker','tag',old_desktop,'mg-desktop-service:'+release])
try:
    run(['docker','compose','-f',str(target/'deploy/compose.yaml'),'up','-d','--no-deps','--no-build','--wait','--wait-timeout','120','files'],env={**os.environ,'RELEASE_ID':release})
    link=root/('current-'+release);link.symlink_to(target);link.replace(root/'current')
    print('Office 服务出口与最近打开已部署 '+release)
except Exception:
    run(['docker','tag',old_files,'mg-files-service:'+previous.name])
    run(['docker','compose','-f',str(previous/'deploy/compose.yaml'),'up','-d','--no-deps','--no-build','--wait','files'],env={**os.environ,'RELEASE_ID':previous.name});raise
