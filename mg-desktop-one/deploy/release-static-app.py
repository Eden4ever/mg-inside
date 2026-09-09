"""逐应用静态发布；校验全部构建文件摘要后原子切换 current。"""
from pathlib import Path
import hashlib,json,os,re,shutil,sys,tarfile,subprocess
root=Path('/opt/mg-desktop');release,app,filename,expected=sys.argv[1:]
assert re.fullmatch(r'\d{8}T\d{6}Z',release) and re.fullmatch(r'[a-z0-9-]+',app)
archive=Path(filename);assert hashlib.sha256(archive.read_bytes()).hexdigest()==expected
previous=(root/'current').resolve(strict=True);assert previous.is_relative_to(root/'releases')
target=root/'releases'/release;assert not target.exists()
shutil.copytree(previous,target)
appdir=target/'static/apps'/app;assert appdir.is_dir()
with tarfile.open(archive) as package:
    for item in package.getmembers():
        path=Path(item.name);assert not path.is_absolute() and '..' not in path.parts and (item.isfile() or item.isdir())
    package.extractall(appdir,filter='data')
manifest=json.loads((appdir/'build-checksums.json').read_text())
for name,digest in manifest.items():
    file=appdir/name;assert file.resolve().is_relative_to(appdir.resolve())
    assert hashlib.sha256(file.read_bytes()).hexdigest()==digest,name
os.chmod(target,0o755)
for path in appdir.rglob('*'):os.chmod(path,0o755 if path.is_dir() else 0o644)
images={}
for service in ['desktop','files']:
    image=subprocess.check_output(['docker','inspect','mg-desktop-'+service+'-1','--format','{{.Config.Image}}'],text=True).strip()
    subprocess.run(['docker','tag',image,'mg-'+service+'-service:'+release],check=True);images[service]=image
(target/'static-release.json').write_text(json.dumps({'application':app,'previous':str(previous),'archiveSHA256':expected,'images':images}))
link=root/('current-'+release);link.symlink_to(target);link.replace(root/'current')
print(json.dumps({'release':release,'application':app,'filesVerified':len(manifest),'previous':str(previous)}))
