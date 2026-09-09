"""服务管理首版增量发布；仅更换桌面入口和新增服务管理静态页面。"""
from pathlib import Path
import json,os,shutil,subprocess,secrets,sys,tarfile,hashlib,re
root=Path('/opt/mg-desktop');release=sys.argv[1];archive=Path(sys.argv[2]);expected=sys.argv[3]
assert re.fullmatch(r'\d{8}T\d{6}Z',release)
assert hashlib.sha256(archive.read_bytes()).hexdigest()==expected
previous=(root/'current').resolve(strict=True);assert previous.is_relative_to(root/'releases')
target=root/'releases'/release;backup=root/'backups'/('service-manager-'+release)
assert not target.exists() and not backup.exists()
backup.mkdir(mode=0o700);os.umask(0o077)
def run(args,**kwargs):return subprocess.run(args,check=True,**kwargs)
def image(container):return subprocess.check_output(['docker','inspect',container,'--format','{{.Config.Image}}']).decode().strip()
old_image=image('mg-desktop-desktop-1');old_files=image('mg-desktop-files-1')
identity=Path('/opt/mg-identity/secrets/identity.json');env=root/'secrets/desktop.env';nginx=Path('/etc/nginx/conf.d/desktop.meta-gravity.conf')
for source,name in [(identity,'identity.json'),(env,'desktop.env'),(nginx,'nginx.conf')]:shutil.copy2(source,backup/name)
(backup/'previous.json').write_text(json.dumps({'release':str(previous),'desktopImage':old_image,'filesImage':old_files}))
with (backup/'identity.dump').open('wb') as f:run(['docker','exec','mg-identity-db-1','sh','-c','pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc'],stdout=f)
shutil.copytree(previous,target)
with tarfile.open(archive) as package:
    for member in package.getmembers():
        p=Path(member.name);assert not p.is_absolute() and '..' not in p.parts and (member.isfile() or member.isdir())
    package.extractall(target,filter='data')
run(['chmod','-R','a+rX',str(target)])
dockerfile=target/'deploy/services.Dockerfile'
dockerfile.write_text(f'FROM {old_image}\nCOPY desktop/main.mjs /app/main.mjs\nCOPY desktop/web /app/web\nCOPY application-catalog.json /app/application-catalog.json\n')
run(['docker','build','-t','mg-desktop-service:'+release,'-f',str(dockerfile),str(target)])
run(['docker','tag',old_files,'mg-files-service:'+release])
config=json.loads(identity.read_text());assert not any(c['client_id']=='service-manager' for c in config['clients'])
config['clients'].append({'client_id':'service-manager','client_name':'服务管理','client_secret':secrets.token_hex(32),'redirect_uris':['https://desktop.meta-gravity.com/apps/service-manager/']})
sql=(target/'service-manager-registration.sql').read_bytes()
run(['docker','exec','-i','mg-identity-db-1','sh','-c','psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'],input=b'BEGIN;\n'+sql+b'\nCOMMIT;',stdout=subprocess.DEVNULL)
lines=[line for line in env.read_text().splitlines() if not line.startswith('SERVICE_WEB_URL=')]
compose=['docker','compose','-f',str(target/'deploy/compose.yaml')]
try:
    identity.write_text(json.dumps(config,ensure_ascii=False,indent=2)+'\n')
    env.write_text('\n'.join(lines)+'\nSERVICE_WEB_URL=https://desktop.meta-gravity.com/apps/service-manager/\n')
    run(['docker','restart','mg-identity-identity-1'],stdout=subprocess.DEVNULL)
    run(compose+['up','-d','--no-deps','--no-build','--wait','--wait-timeout','120','desktop'],env={**os.environ,'RELEASE_ID':release})
    link=root/('current-'+release);link.symlink_to(target);link.replace(root/'current')
    shutil.copyfile(target/'deploy/nginx-desktop.conf',nginx);run(['nginx','-t']);run(['systemctl','reload','nginx'])
    run(['curl','--noproxy','*','-fsS','--retry','5','--retry-delay','2','--resolve','desktop.meta-gravity.com:443:127.0.0.1','https://desktop.meta-gravity.com/api/health'])
    print('\n服务管理首版已部署 '+release)
except Exception:
    shutil.copyfile(backup/'desktop.env',env);shutil.copyfile(backup/'nginx.conf',nginx);shutil.copyfile(backup/'identity.json',identity)
    rollback=root/('rollback-'+release);rollback.symlink_to(previous);rollback.replace(root/'current')
    run(['docker','restart','mg-identity-identity-1'],stdout=subprocess.DEVNULL)
    old_release=old_image.split(':')[-1]
    run(['docker','compose','-f',str(previous/'deploy/compose.yaml'),'up','-d','--no-deps','--no-build','--wait','desktop'],env={**os.environ,'RELEASE_ID':old_release})
    run(['nginx','-t']);run(['systemctl','reload','nginx']);raise
