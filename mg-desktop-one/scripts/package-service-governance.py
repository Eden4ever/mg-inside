from pathlib import Path
import hashlib,json,io,re,subprocess,sys,tarfile
release=sys.argv[1];assert re.fullmatch(r'\d{8}T\d{6}Z',release)
source=Path('../mg-service-one/dist');archive=Path('artifacts')/('service-governance-'+release+'.tar.gz');assert not archive.exists()
subprocess.run(['node',str(Path(__file__).with_name('check-embedded-build.mjs')),str(source)],check=True,stdout=sys.stderr)
subprocess.run([sys.executable,str(Path(__file__).with_name('application-version.py')),str(source),'service-manager',release],check=True)
index=(source/'index.html').read_text(encoding='utf-8');assert 'src="/apps/service-manager/assets/' in index and 'href="/apps/service-manager/assets/' in index,'服务管理必须以生产子路径构建'
existing=set(subprocess.check_output(['ssh','root@43.139.78.226','find /opt/mg-desktop/current/static/apps/service-manager/assets -maxdepth 1 -type f -printf "%f\\n"'],text=True).splitlines());checksums={}
with tarfile.open(archive,'w:gz') as package:
 package.add('dist/server/main.mjs',arcname='desktop/main.mjs')
 package.add('dist/server/service-storage-admin.mjs',arcname='desktop/service-storage-admin.mjs')
 for file in source.rglob('*'):
  if not file.is_file():continue
  name=file.relative_to(source).as_posix();checksums[name]=hashlib.sha256(file.read_bytes()).hexdigest()
  if name.startswith('assets/') and file.name in existing:continue
  package.add(file,arcname='static/apps/service-manager/'+name)
 data=json.dumps(checksums).encode();item=tarfile.TarInfo('service-front-checksums.json');item.size=len(data);package.addfile(item,io.BytesIO(data))
print(str(archive));print(hashlib.sha256(archive.read_bytes()).hexdigest())
