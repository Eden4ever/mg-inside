"""知识库前端增量发布，保留后端、数据库和所有旧哈希资源。"""
from pathlib import Path
import hashlib,json,os,re,shutil,sys,tarfile
release,filename,digest=sys.argv[1:];assert re.fullmatch(r'\d{8}T\d{6}Z',release)
archive=Path(filename);assert hashlib.sha256(archive.read_bytes()).hexdigest()==digest
live=Path('/var/www/mg-expert-database/knowledge-base-inside');assert live.is_dir()
stage=Path('/opt/mg-expert-database/frontend-releases')/release;assert not stage.exists();stage.parent.mkdir(exist_ok=True);shutil.copytree(live,stage)
with tarfile.open(archive) as package:
 for item in package.getmembers():
  path=Path(item.name);assert not path.is_absolute() and '..' not in path.parts and (item.isfile() or item.isdir())
 package.extractall(stage,filter='data')
manifest=json.loads((stage/'build-checksums.json').read_text())
for name,digest in manifest.items():
 file=stage/name;assert file.resolve().is_relative_to(stage.resolve());assert hashlib.sha256(file.read_bytes()).hexdigest()==digest
backup=Path('/opt/mg-expert-database/backups')/('frontend-services-'+release);backup.mkdir(parents=True,mode=0o700);shutil.copy2(live/'index.html',backup/'index.html')
for name in manifest:
 if name=='index.html':continue
 source=stage/name;target=live/name;target.parent.mkdir(parents=True,exist_ok=True)
 if target.exists() and target.read_bytes()==source.read_bytes():continue
 temp=target.with_name(target.name+'.'+release);shutil.copyfile(source,temp);os.chmod(temp,0o644);temp.replace(target)
temp=live/('index-'+release+'.html');shutil.copyfile(stage/'index.html',temp);os.chmod(temp,0o644);temp.replace(live/'index.html')
(stage/'published.json').write_text(json.dumps({'archiveSHA256':hashlib.sha256(archive.read_bytes()).hexdigest(),'backup':str(backup)}))
print('知识库前端已发布 '+release)
