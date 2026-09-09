"""复用线上已有的哈希资源，打包变更文件并生成完整构建摘要。"""
from pathlib import Path
import hashlib,json,re,subprocess,sys,tarfile,io
app,source,release=sys.argv[1:]
assert re.fullmatch(r'[a-z0-9-]+',app) and re.fullmatch(r'\d{8}T\d{6}Z',release)
source=Path(source).resolve();archive=Path('artifacts')/(app+'-'+release+'.tar.gz');assert not archive.exists()
subprocess.run(['node',str(Path(__file__).with_name('check-embedded-build.mjs')),str(source)],check=True,stdout=sys.stderr)
subprocess.run([sys.executable,str(Path(__file__).with_name('application-version.py')),str(source),app,release],check=True)
index=(source/'index.html').read_text(encoding='utf-8');assert f'src="/apps/{app}/assets/' in index,f'{app} 必须以生产应用子路径构建'
remote=subprocess.check_output(['ssh','root@43.139.78.226','find /opt/mg-desktop/current/static/apps/'+app+'/assets -maxdepth 1 -type f -printf "%f\\n"'],text=True)
existing=set(remote.splitlines());checksums={};count=0
with tarfile.open(archive,'w:gz') as package:
    for file in source.rglob('*'):
        if not file.is_file():continue
        assert not file.is_symlink()
        name=file.relative_to(source).as_posix();checksums[name]=hashlib.sha256(file.read_bytes()).hexdigest()
        if name.startswith('assets/') and file.name in existing:continue
        package.add(file,arcname=name);count+=1
    data=json.dumps(checksums).encode();item=tarfile.TarInfo('build-checksums.json');item.size=len(data);package.addfile(item,io.BytesIO(data))
print(json.dumps({'archive':str(archive.resolve()),'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'changedFiles':count,'verifiedFiles':len(checksums)}))
