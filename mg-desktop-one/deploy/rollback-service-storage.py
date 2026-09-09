"""人工回退首次数据库迁移；必须从最新数据库导出，不自动恢复旧业务快照。"""
from pathlib import Path
import json,os,re,shutil,subprocess,sys
release=sys.argv[1];assert re.fullmatch(r'\d{8}T\d{6}Z',release)
root=Path('/opt/mg-desktop');current=(root/'current').resolve(strict=True)
assert current==root/'releases'/release,'只回退指定的当前迁移批次，避免覆盖后续发布'
backup=root/'backups'/('service-storage-'+release);before=json.loads((backup/'previous.json').read_text())
previous=Path(before['release']).resolve(strict=True);assert previous.is_relative_to(root/'releases')
output=backup/'manual-rollback-latest.json';assert not output.exists()
def run(args,**kwargs):return subprocess.run(args,check=True,**kwargs)
run(['docker','stop','--time','30','mg-desktop-desktop-1'],stdout=subprocess.DEVNULL)
try:
 run(['docker','run','--rm','--user','0:0','--network','host','--env-file','/opt/mg-service-registry/secrets/admin.env','-v',str(root)+':/deployment',before['desktopImage'],'node','/deployment/releases/'+release+'/desktop/service-storage-admin.mjs','export','/deployment/backups/service-storage-'+release+'/manual-rollback-latest.json'])
 temp=root/'shared/desktop/services/registry-postgres-rollback.tmp';shutil.copy2(output,temp);os.chown(temp,1000,1000);temp.chmod(0o600);temp.replace(root/'shared/desktop/services/registry.json')
 run(['docker','tag',before['desktopImage'],'mg-desktop-service:'+previous.name])
 run(['docker','compose','-f',str(previous/'deploy/compose.yaml'),'up','-d','--no-deps','--no-build','--wait','desktop'],env={**os.environ,'RELEASE_ID':previous.name})
 link=root/('rollback-'+release);link.symlink_to(previous);link.replace(root/'current')
 print('已从最新数据库导出并回退；数据库及迁移记录保留。')
except Exception:
 run(['docker','compose','-f',str(current/'deploy/compose.yaml'),'up','-d','--no-deps','--no-build','--wait','desktop'],env={**os.environ,'RELEASE_ID':release})
 raise
