from pathlib import Path
import hashlib,json,io,re,subprocess,sys,tarfile
release=sys.argv[1];source=Path('../mg-expert-database/apps/web/dist');archive=Path('artifacts')/('expert-services-'+release+'.tar.gz');assert not archive.exists()
subprocess.run(['node',str(Path(__file__).with_name('check-embedded-build.mjs')),str(source)],check=True,stdout=sys.stderr)
subprocess.run([sys.executable,str(Path(__file__).with_name('application-version.py')),str(source),'expert-database',release],check=True)
index=(source/'index.html').read_text(encoding='utf-8')
assets=re.findall(r'(?:src|href)="([^"]+\.(?:js|css))"',index)
assert assets and all(path.startswith('/knowledge-base-inside/assets/') for path in assets),'知识库构建资源路径错误'
existing=set(subprocess.check_output(['ssh','root@43.139.78.226','find /var/www/mg-expert-database/knowledge-base-inside/assets -maxdepth 1 -type f -printf "%f\\n"'],text=True).splitlines());checksums={}
with tarfile.open(archive,'w:gz') as package:
 for file in source.rglob('*'):
  if not file.is_file():continue
  name=file.relative_to(source).as_posix();checksums[name]=hashlib.sha256(file.read_bytes()).hexdigest()
  if name.startswith('assets/') and file.name in existing:continue
  package.add(file,arcname=name)
 data=json.dumps(checksums).encode();item=tarfile.TarInfo('build-checksums.json');item.size=len(data);package.addfile(item,io.BytesIO(data))
print(str(archive));print(hashlib.sha256(archive.read_bytes()).hexdigest())
