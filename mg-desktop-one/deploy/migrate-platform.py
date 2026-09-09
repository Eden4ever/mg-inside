"""本次双主机迁移：只处理明确列举的平台配置、数据和镜像。"""
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import tarfile

ROOT=Path('/opt/mg-desktop')
BACKUP=ROOT/'backups/migrate-20260908T154000Z'
RELEASE='20260908T155000Z'
def run(args,**kwargs):
    return subprocess.run(args,check=True,**kwargs)
def private(path,text):
    path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w') as out: out.write(text)
def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def package(path,entries):
    assert not path.exists()
    with tarfile.open(path,'w:gz') as archive:
        for source,name in entries: archive.add(source,arcname=name)
    os.chmod(path,0o600)
    print(path.name,digest(path))
def extract(path,destination,expected):
    assert digest(path)==expected,'归档摘要不匹配'
    with tarfile.open(path) as archive:
        for m in archive.getmembers():
            p=Path(m.name)
            assert not p.is_absolute() and '..' not in p.parts and (m.isfile() or m.isdir()),'不安全归档条目'
        archive.extractall(destination,filter='data')
def env(path):return dict(line.split('=',1) for line in path.read_text().splitlines() if '=' in line and not line.startswith('#'))
def update_env(path,changes):
    values=env(path);values.update(changes)
    temp=path.with_name(path.name+'.next');private(temp,'\n'.join(f'{k}={v}' for k,v in values.items())+'\n');os.replace(temp,path)
def db_output(query,path):
    with path.open('wb') as out:
        run(['docker','exec','-i','mg-identity-db-1','sh','-c','psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At'],input=query.encode(),stdout=out)
    os.chmod(path,0o600)
INVARIANTS='''SELECT jsonb_build_object(
'users',(SELECT COALESCE(jsonb_agg(to_jsonb(t)-'avatarUrl' ORDER BY id),'[]') FROM "User" t),
'memberships',(SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY "clientId","userId"),'[]') FROM "ApplicationUser" t),
'roles',(SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM "Role" t),
'userRoles',(SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY "userId","roleId"),'[]') FROM "UserRole" t),
'securityKeys',(SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM "SecurityKey" t),
'totp',(SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY "userId"),'[]') FROM "TotpCredential" t));'''
mode=sys.argv[1]
os.umask(0o077)
if mode=='prepare-source':
    entries=[('/opt/mg-identity/compose.yaml','identity/compose.yaml'),('/opt/mg-identity/secrets','identity/secrets'),
       (ROOT/'secrets','desktop/secrets'),('/etc/nginx/conf.d/identity.meta-gravity.conf','nginx/identity.meta-gravity.conf'),
       ('/var/www/mg-identity/public','public')]
    package(BACKUP/'config.tar.gz',entries)
elif mode=='snapshot-source':
    assert not (BACKUP/'database.dump').exists()
    run(['docker','stop','mg-desktop-desktop-1','mg-desktop-files-1','mg-identity-identity-1'])
    with (BACKUP/'database.dump').open('wb') as out:
        run(['docker','exec','mg-identity-db-1','sh','-c','pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc'],stdout=out)
    db_output(INVARIANTS,BACKUP/'invariants.json')
    package(BACKUP/'state.tar.gz',[(ROOT/'shared','shared'),(BACKUP/'database.dump','database.dump'),(BACKUP/'invariants.json','invariants.json')])
elif mode=='prepare-target':
    stage=BACKUP/'configuration';assert not stage.exists();stage.mkdir(mode=0o700)
    extract(BACKUP/'config.tar.gz',stage,sys.argv[2])
    assert not Path('/opt/mg-identity').exists()
    shutil.copytree(stage/'identity','/opt/mg-identity');os.chmod('/opt/mg-identity',0o700)
    shutil.copytree(stage/'desktop/secrets',ROOT/'secrets')
    for path in (ROOT/'secrets').rglob('*'):
        os.chmod(path,0o700 if path.is_dir() else 0o600)
    shutil.copytree(stage/'public','/var/www/mg-identity/public',dirs_exist_ok=True)
    # 新增采集客户端，已有签名密钥、client secret 和重定向地址逐项保留。
    identity=Path('/opt/mg-identity/secrets/identity.json');config=json.loads(identity.read_text());original=config['clients'][:]
    client=next((x for x in original if x['client_id']=='resource-manager'),None)
    if client is None:
        client={'client_id':'resource-manager','client_name':'资源管理','client_secret':secrets.token_hex(32),'redirect_uris':['https://desktop.meta-gravity.com/apps/resource-manager/']}
        config['clients'].append(client)
    assert config['clients'][:len(original)]==original
    identity.write_text(json.dumps(config,ensure_ascii=False,indent=2)+'\n')
    run(['chown','-R','1000:1000','/opt/mg-identity/secrets'])
    os.chmod('/opt/mg-identity/secrets',0o700)
    for path in Path('/opt/mg-identity/secrets').iterdir():
        if path.is_file(): os.chmod(path,0o600)
    resource=Path('/opt/mg-resource/shared/resource.env')
    private(resource,f'IDENTITY_ENABLED=true\nIDENTITY_ISSUER=https://identity.meta-gravity.com\nIDENTITY_CLIENT_ID=resource-manager\nIDENTITY_CLIENT_SECRET={client["client_secret"]}\n')
    office=Path('/opt/mg-office/secrets/documentserver.env');jwt=secrets.token_hex(48)
    private(office,f'JWT_SECRET={jwt}\n')
    update_env(ROOT/'secrets/desktop.env',{'OFFICE_WEB_URL':'https://desktop.meta-gravity.com/apps/office-one','RESOURCE_WEB_URL':'https://desktop.meta-gravity.com/apps/resource-manager','RESOURCE_API_URL':'http://127.0.0.1:14370/api'})
    update_env(ROOT/'secrets/files.env',{'OFFICE_DOCUMENT_SERVER_URL':'https://desktop.meta-gravity.com/office-engine','OFFICE_DOCUMENT_SERVER_INTERNAL_URL':'http://127.0.0.1:14460','OFFICE_CALLBACK_BASE':'https://desktop.meta-gravity.com','OFFICE_JWT_SECRET':jwt})
    private(Path('/opt/mg-identity')/f'platform-{RELEASE}.yaml',f'services:\n  identity:\n    image: mg-identity-service:{RELEASE}\n')
    print('迁移配置已准备；原账号密钥与已有客户端保持，未输出凭据。')
elif mode=='restore-target':
    stage=BACKUP/'state';assert not stage.exists();stage.mkdir(mode=0o700)
    extract(BACKUP/'state.tar.gz',stage,sys.argv[2])
    assert not (ROOT/'shared').exists()
    shutil.copytree(stage/'shared',ROOT/'shared')
    run(['chown','-R','1000:1000',str(ROOT/'shared')]);os.chmod(ROOT/'shared',0o700)
    run(['docker','compose','-f','compose.yaml','up','-d','--wait','db'],cwd='/opt/mg-identity')
    with (stage/'database.dump').open('rb') as dump:
        run(['docker','exec','-i','mg-identity-db-1','sh','-c','pg_restore --exit-on-error --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB"'],stdin=dump)
    db_output(INVARIANTS,BACKUP/'restored-invariants.json')
    assert json.loads((stage/'invariants.json').read_text())==json.loads((BACKUP/'restored-invariants.json').read_text()),'身份数据恢复校验不一致'
    compose=['docker','compose','-f','compose.yaml','-f',f'platform-{RELEASE}.yaml']
    run(compose+['run','--rm','--no-deps','identity','node','node_modules/prisma/build/index.js','migrate','deploy'],cwd='/opt/mg-identity')
    db_output(INVARIANTS,BACKUP/'migrated-invariants.json')
    assert json.loads((stage/'invariants.json').read_text())==json.loads((BACKUP/'migrated-invariants.json').read_text()),'迁移改变了已有用户、直接授权、角色成员或 MFA 凭据'
    print('数据库恢复、追加迁移及用户/权限/MFA 数据一致性校验通过。')
else:raise SystemExit('未知迁移步骤')
