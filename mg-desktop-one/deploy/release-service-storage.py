"""首次将服务目录从 JSON 切换到独立库；回退先导出数据库的新状态。"""
from pathlib import Path
import hashlib,json,os,re,shutil,subprocess,sys,tarfile

release,filename,digest=sys.argv[1:];assert re.fullmatch(r'\d{8}T\d{6}Z',release)
archive=Path(filename);assert hashlib.sha256(archive.read_bytes()).hexdigest()==digest
root=Path('/opt/mg-desktop');previous=(root/'current').resolve(strict=True);assert previous.is_relative_to(root/'releases')
target=root/'releases'/release;backup=root/'backups'/('service-storage-'+release)
assert not target.exists() and not backup.exists()
assert Path('/opt/mg-service-registry/provisioned.json').is_file()
def run(args,**kwargs):return subprocess.run(args,check=True,**kwargs)
def image(service):return subprocess.check_output(['docker','inspect','mg-desktop-'+service+'-1','--format','{{.Config.Image}}'],text=True).strip()
old_desktop=image('desktop');old_files=image('files')
# 此脚本仅负责首次切换，已启用数据库的后续发布沿通用治理脚本执行。
existing_env=json.loads(subprocess.check_output(['docker','inspect','mg-desktop-desktop-1','--format','{{json .Config.Env}}'],text=True))
assert not any(value.startswith('SERVICE_DATABASE_URL=') for value in existing_env),'当前已使用数据库，禁止重复首迁移'
backup.mkdir(mode=0o700)
(backup/'previous.json').write_text(json.dumps({'release':str(previous),'desktopImage':old_desktop,'filesImage':old_files}))
shutil.copytree(previous,target)
with tarfile.open(archive) as package:
 for item in package.getmembers():
  path=Path(item.name);assert not path.is_absolute() and '..' not in path.parts and (item.isfile() or item.isdir())
 package.extractall(target,filter='data')
appdir=target/'static/apps/service-manager'
for name,checksum in json.loads((target/'service-front-checksums.json').read_text()).items():
 file=appdir/name;assert file.resolve().is_relative_to(appdir.resolve());assert hashlib.sha256(file.read_bytes()).hexdigest()==checksum
compose=target/'deploy/compose.yaml'
text=compose.read_text();needle='env_file: /opt/mg-desktop/secrets/desktop.env'
assert text.count(needle)==1
compose.write_text(text.replace(needle,'env_file:\n      - /opt/mg-desktop/secrets/desktop.env\n      - /opt/mg-desktop/secrets/services.env'))
run(['chmod','-R','a+rX',str(target)])
(target/'deploy/service-storage.Dockerfile').write_text(f'FROM {old_desktop}\nCOPY desktop/main.mjs /app/main.mjs\n')
run(['docker','build','-t','mg-desktop-service:'+release,'-f',str(target/'deploy/service-storage.Dockerfile'),str(target)])
run(['docker','tag',old_files,'mg-files-service:'+release])

def admin(action,path=None):
 # 临时容器无宿主 Docker socket，管理连接仅由私密 env_file 提供。
 args=['docker','run','--rm','--user','0:0','--network','host','--env-file','/opt/mg-service-registry/secrets/admin.env','-v',str(root)+':/deployment',old_desktop,'node','/deployment/releases/'+release+'/desktop/service-storage-admin.mjs',action]
 if path:args.append('/deployment/'+str(path.relative_to(root)))
 return run(args)
admin('install')
grants='''GRANT SELECT ON ALL TABLES IN SCHEMA public TO registry_app;
GRANT INSERT ON service_publications,service_bindings,service_audit,service_activity TO registry_app;
GRANT INSERT ON service_version_lifecycles TO registry_app;
GRANT UPDATE(value) ON service_version_lifecycles TO registry_app;
GRANT UPDATE(version,revision) ON service_bindings TO registry_app;
GRANT UPDATE(generation) ON service_environments TO registry_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO registry_app;'''
run(['docker','exec','-i','mg-service-registry-db-1','psql','-U','registry_owner','-d','mg_services','-v','ON_ERROR_STOP=1'],input=grants,text=True,stdout=subprocess.DEVNULL)
started_new=False
run(['docker','stop','--time','30','mg-desktop-desktop-1'],stdout=subprocess.DEVNULL)
try:
 shutil.copy2(root/'shared/desktop/services/registry.json',backup/'source.json')
 admin('import',backup/'source.json');admin('verify',backup/'source.json')
 started_new=True
 run(['docker','compose','-f',str(compose),'up','-d','--no-deps','--no-build','--wait','--wait-timeout','120','desktop'],env={**os.environ,'RELEASE_ID':release})
 link=root/('current-'+release);link.symlink_to(target);link.replace(root/'current')
 (backup/'completed.json').write_text(json.dumps({'release':release,'database':'mg_services','environment':'production'}))
 print('独立服务数据库迁移完成 '+release)
except Exception:
 if started_new:
  run(['docker','stop','--time','30','mg-desktop-desktop-1'],stdout=subprocess.DEVNULL)
  # 不能用迁移前快照覆盖已成功写入数据库的新版本或状态。
  try:
   admin('export',backup/'rollback-latest.json')
   temp=root/'shared/desktop/services/registry-postgres-rollback.tmp';shutil.copy2(backup/'rollback-latest.json',temp);os.chown(temp,1000,1000);temp.chmod(0o600);temp.replace(root/'shared/desktop/services/registry.json')
  except Exception:
   # 数据库不可导出时继续使用新程序及已确认快照，保留全部数据库写入，等待恢复。
   run(['docker','compose','-f',str(compose),'up','-d','--no-deps','--no-build','desktop'],env={**os.environ,'RELEASE_ID':release})
   raise RuntimeError('数据库导出未完成，未回退至旧 JSON；保留新程序等待数据库恢复')
 run(['docker','tag',old_desktop,'mg-desktop-service:'+previous.name])
 run(['docker','compose','-f',str(previous/'deploy/compose.yaml'),'up','-d','--no-deps','--no-build','--wait','desktop'],env={**os.environ,'RELEASE_ID':previous.name})
 raise
