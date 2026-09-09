"""更新已启用的 Token 独立静态部署，保留现有 Nginx、网关和所有旧哈希资源。"""
from pathlib import Path
import hashlib,json,os,re,shutil,subprocess,sys,tarfile

release,filename,digest=sys.argv[1:]
assert re.fullmatch(r'\d{8}T\d{6}Z',release)
archive=Path(filename);assert hashlib.sha256(archive.read_bytes()).hexdigest()==digest
root=Path('/var/www/mg-token-one-services');current=root/'current'
previous=current.resolve(strict=True);assert current.is_symlink() and previous.is_relative_to(root/'releases')
target=root/'releases'/release;assert not target.exists()
backup=Path('/opt/mg-gateway/backups')/('frontend-services-'+release);assert not backup.exists()
shutil.copytree(previous,target)
with tarfile.open(archive) as package:
 for item in package.getmembers():
  path=Path(item.name);assert not path.is_absolute() and '..' not in path.parts and (item.isfile() or item.isdir())
 package.extractall(target,filter='data')
for name,expected in json.loads((target/'build-checksums.json').read_text()).items():
 path=target/name;assert path.resolve().is_relative_to(target.resolve())
 assert hashlib.sha256(path.read_bytes()).hexdigest()==expected
subprocess.run(['chmod','-R','a+rX',str(target)],check=True)
backup.mkdir(mode=0o700)
(backup/'release.json').write_text(json.dumps({'previous':str(previous),'release':str(target),'archiveSHA256':digest}))
link=root/('current-'+release);link.symlink_to(target);link.replace(current)
try:
 subprocess.run(['curl','--noproxy','*','-fsS','-o','/dev/null','--resolve','token.meta-gravity.com:443:127.0.0.1','https://token.meta-gravity.com/'],check=True)
except Exception:
 rollback=root/('rollback-'+release);rollback.symlink_to(previous);rollback.replace(current);raise
print('Token 静态前端已更新，网关与 Nginx 配置保持当前部署：'+release)
