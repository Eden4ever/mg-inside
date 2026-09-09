"""Token 前端独立静态发布，API 与模型转发仍由原网关处理。"""
from pathlib import Path
import hashlib,json,os,re,shutil,subprocess,sys,tarfile
release,filename,digest=sys.argv[1:];assert re.fullmatch(r'\d{8}T\d{6}Z',release)
archive=Path(filename);assert hashlib.sha256(archive.read_bytes()).hexdigest()==digest
root=Path('/var/www/mg-token-one-services');target=root/'releases'/release;assert not target.exists();target.mkdir(parents=True)
def run(args):return subprocess.run(args,check=True)
# 保留旧哈希文件供仍打开的页面加载；不会复制网关配置或环境变量。
run(['docker','cp','mg-gateway:/app/web-dist/.',str(target)])
with tarfile.open(archive) as package:
 for item in package.getmembers():
  path=Path(item.name);assert not path.is_absolute() and '..' not in path.parts and (item.isfile() or item.isdir())
 package.extractall(target,filter='data')
manifest=json.loads((target/'build-checksums.json').read_text())
for name,digest in manifest.items():
 file=target/name;assert file.resolve().is_relative_to(target.resolve());assert hashlib.sha256(file.read_bytes()).hexdigest()==digest
run(['chmod','-R','a+rX',str(root)])
nginx=Path('/etc/nginx/conf.d/new-api.conf');original=nginx.read_text();start=original.rfind('  location / {');end=original.rfind('\n}')
assert start>original.index('listen 443') and end>start
block=original[start:end];assert 'proxy_pass http://127.0.0.1:3001;' in block
proxy_api=block.replace('location / {','location /api {',1);proxy_relay=block.replace('location / {','location /v1 {',1)
replacement=f'''  # Token 前端独立发布；/api-docs 原文档代理保持原配置。
{proxy_api}
{proxy_relay}
  root {root}/current;
  location ^~ /assets/ {{ try_files $uri =404; }}
  location = /index.html {{ expires -1; }}
  location / {{ try_files $uri $uri/ /index.html; }}
'''
backup=Path('/opt/mg-gateway/backups')/('frontend-services-'+release);backup.mkdir(mode=0o700);shutil.copy2(nginx,backup/'nginx.conf')
current=root/'current';assert not current.exists()
current.symlink_to(target)
try:
 nginx.write_text(original[:start]+replacement+original[end:]);run(['nginx','-t']);run(['systemctl','reload','nginx'])
 run(['curl','--noproxy','*','-fsS','-o','/dev/null','--resolve','token.meta-gravity.com:443:127.0.0.1','https://token.meta-gravity.com/'])
 (backup/'release.json').write_text(json.dumps({'release':release,'staticRoot':str(target),'archiveSHA256':hashlib.sha256(archive.read_bytes()).hexdigest()}))
 print('Token 前端已发布，网关未重启 '+release)
except Exception:
 shutil.copyfile(backup/'nginx.conf',nginx);run(['nginx','-t']);run(['systemctl','reload','nginx']);raise
