"""切换已完成目录迁移的内核和身份服务，密钥仅写入受控文件。"""
import json, os, secrets, subprocess
from pathlib import Path
release='20260910T012500Z'
root=Path('/opt/mg-desktop/releases')/release
def run(args):
    subprocess.run(args,check=True)
run(['docker','stop','mg-desktop-desktop-1','mg-identity-identity-1'])
backup=Path('/opt/mg-desktop/backups/catalog-20260909T173539Z')
with (backup/'identity-after-migration.dump').open('wb') as stream:
    subprocess.run(['docker','exec','mg-identity-db-1','pg_dump','-U','identity','-d','identity','-Fc'],stdout=stream,check=True)
keyfile=Path('/opt/mg-desktop/secrets/kernel-catalog.env')
if not keyfile.exists():
    descriptor=os.open(keyfile,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(descriptor,'w') as stream:
        stream.write('APPLICATION_REGISTRY_KEY='+secrets.token_hex(32)+'\nAPPLICATION_REGISTRY_URL=https://desktop.meta-gravity.com/internal/applications\n')
desktop_override=root/'deploy/catalog-override.json'
desktop_override.write_text(json.dumps({'services':{'desktop':{'env_file':['/opt/mg-desktop/secrets/kernel-catalog.env']}}}))
identity_override=Path('/opt/mg-identity')/('catalog-'+release+'.json')
identity_override.write_text(json.dumps({'services':{'identity':{'image':'mg-identity-service:'+release,'env_file':['/opt/mg-desktop/secrets/kernel-catalog.env']}}}))
os.environ['RELEASE_ID']=release
run(['docker','compose','-f',str(root/'deploy/compose.yaml'),'-f',str(desktop_override),'up','-d','--no-build','--wait','--wait-timeout','120'])
run(['docker','compose','-f','/opt/mg-identity/compose.yaml','-f',str(identity_override),'up','-d','--no-build','--wait','--wait-timeout','120','identity'])
run(['curl','-fsS','http://127.0.0.1:4200/health'])
run(['curl','-fsS','http://127.0.0.1:4300/api/health'])
nextlink=Path('/opt/mg-desktop/.current-catalog-next')
nextlink.symlink_to(root)
nextlink.replace('/opt/mg-desktop/current')
print('内核、身份和平台静态入口已切换；业务验收待执行。')
