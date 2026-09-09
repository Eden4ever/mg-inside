from pathlib import Path
import hashlib,json,io,re,sys,tarfile,subprocess
release=sys.argv[1];source=Path('../mg-token-one/mg-gateway/apps/web/dist');archive=Path('artifacts')/('token-services-'+release+'.tar.gz');assert not archive.exists();checksums={}
subprocess.run(['node',str(Path(__file__).with_name('check-embedded-build.mjs')),str(source)],check=True,stdout=sys.stderr)
subprocess.run([sys.executable,str(Path(__file__).with_name('application-version.py')),str(source),'token-one',release],check=True)
existing=set(subprocess.check_output(['ssh','root@1.12.253.86','find /var/www/mg-token-one-services/current/assets -maxdepth 1 -type f -printf "%f\\n"'],text=True).splitlines())
assets=re.findall(r'(?:src|href)="([^"]+\.(?:js|css))"',(source/'index.html').read_text(encoding='utf-8'))
assert assets and all(path.startswith('/assets/') for path in assets),'Token 前端必须以独立站点根路径构建'
with tarfile.open(archive,'w:gz') as package:
 for file in source.rglob('*'):
  if not file.is_file():continue
  assert not file.is_symlink() and file.name not in ['.env','.env.local']
  name=file.relative_to(source).as_posix();checksums[name]=hashlib.sha256(file.read_bytes()).hexdigest()
  if name.startswith('assets/') and file.name in existing:continue
  package.add(file,arcname=name)
 data=json.dumps(checksums).encode();item=tarfile.TarInfo('build-checksums.json');item.size=len(data);package.addfile(item,io.BytesIO(data))
print(str(archive));print(hashlib.sha256(archive.read_bytes()).hexdigest())
