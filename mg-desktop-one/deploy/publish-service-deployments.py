"""用受控发布工具更新部署登记；不改变当前服务绑定，不执行程序部署。"""
from pathlib import Path
import fcntl,hashlib,json,os,shutil,subprocess,sys,uuid
filename,expected=sys.argv[1:];assert len(expected)==64 and all(c in '0123456789abcdef' for c in expected)
root=Path('/opt/mg-desktop');current=(root/'current').resolve(strict=True);assert current.is_relative_to(root/'releases')
target=root/'config/services-deployments.json';assert target.is_file()
with (root/'config/deployments.lock').open('a') as lock:
 fcntl.flock(lock,fcntl.LOCK_EX)
 assert hashlib.sha256(target.read_bytes()).hexdigest()==expected,'部署登记已更新，拒绝覆盖其他发布'
 backup=root/'backups'/('deployment-config-'+uuid.uuid4().hex);backup.mkdir(mode=0o700)
 shutil.copy2(target,backup/'previous.json');shutil.copy2(Path(filename),backup/'incoming.json')
 image='mg-service-registry-admin:'+current.name
 subprocess.run(['docker','run','--rm','--user','0:0','--network','host','--env-file','/opt/mg-service-registry/secrets/admin.env','-v',str(root)+':/deployment',image,'publish-deployments','/deployment/'+str((backup/'incoming.json').relative_to(root)),'/deployment/config/services-deployments.json',expected],check=True)
 print(json.dumps({'registered':True,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'backup':str(backup),'bindingsChanged':False}))
