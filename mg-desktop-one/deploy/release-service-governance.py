from pathlib import Path
import gzip,hashlib,json,os,re,shutil,subprocess,sys,tarfile
release,filename,digest=sys.argv[1:4];binding_catalog=Path(sys.argv[4]) if len(sys.argv)==5 else None
assert len(sys.argv) in [4,5] and re.fullmatch(r'\d{8}T\d{6}Z',release)
archive=Path(filename);assert hashlib.sha256(archive.read_bytes()).hexdigest()==digest
root=Path('/opt/mg-desktop');previous=(root/'current').resolve(strict=True);assert previous.is_relative_to(root/'releases')
target=root/'releases'/release;backup=root/'backups'/('service-governance-'+release);assert not target.exists() and not backup.exists()
def run(args,**kwargs):return subprocess.run(args,check=True,**kwargs)
def image(service):return subprocess.check_output(['docker','inspect','mg-desktop-'+service+'-1','--format','{{.Config.Image}}'],text=True).strip()
old_desktop=image('desktop');old_files=image('files');backup.mkdir(mode=0o700)
(backup/'previous.json').write_text(json.dumps({'release':str(previous),'desktopImage':old_desktop,'filesImage':old_files}))
shutil.copy2(root/'shared/desktop/services/registry.json',backup/'registry.json')
configuration=json.loads(subprocess.check_output(['docker','inspect','mg-desktop-desktop-1','--format','{{json .Config.Env}}'],text=True))
settings=dict(value.split('=',1) for value in configuration if '=' in value)
if any(value.startswith('SERVICE_DATABASE_URL=') for value in configuration):
 data=subprocess.check_output(['docker','exec','mg-service-registry-db-1','pg_dump','-U','registry_owner','-d','mg_services','--no-owner','--no-acl'])
 dump=backup/'services.sql.gz';dump.write_bytes(gzip.compress(data));dump.chmod(0o600)
if settings.get('SERVICE_DEPLOYMENTS_FILE'):
 shutil.copy2(root/'config/services-deployments.json',backup/'deployments.json')
shutil.copytree(previous,target)
with tarfile.open(archive) as package:
 for item in package.getmembers():
  path=Path(item.name);assert not path.is_absolute() and '..' not in path.parts and (item.isfile() or item.isdir())
 package.extractall(target,filter='data')
appdir=target/'static/apps/service-manager'
for name,digest in json.loads((target/'service-front-checksums.json').read_text()).items():
 file=appdir/name;assert file.resolve().is_relative_to(appdir.resolve());assert hashlib.sha256(file.read_bytes()).hexdigest()==digest
run(['chmod','-R','a+rX',str(target)])
dockerfile=target/'deploy/service-governance.Dockerfile';dockerfile.write_text(f'FROM {old_desktop}\nCOPY desktop/main.mjs /app/main.mjs\n')
run(['docker','build','-t','mg-desktop-service:'+release,'-f',str(dockerfile),str(target)])
run(['docker','tag',old_files,'mg-files-service:'+release])
envfile=root/'secrets/services.env';config=root/'config/services-deployments.json'
def admin(action,path=None):
 args=['docker','run','--rm','--user','0:0','--network','host','--env-file','/opt/mg-service-registry/secrets/admin.env','-v',str(root)+':/deployment',old_desktop,'node','/deployment/releases/'+release+'/desktop/service-storage-admin.mjs',action]
 if path:args.append('/deployment/'+str(path.relative_to(root)))
 run(args)
if settings.get('SERVICE_DATABASE_URL'):
 admin('install')
 run(['docker','exec','-i','mg-service-registry-db-1','psql','-U','registry_owner','-d','mg_services','-v','ON_ERROR_STOP=1'],input='GRANT SELECT,INSERT ON service_version_lifecycles TO registry_app; GRANT UPDATE(value) ON service_version_lifecycles TO registry_app;',text=True,stdout=subprocess.DEVNULL)
if binding_catalog:
 assert not settings.get('SERVICE_DEPLOYMENTS_FILE'),'此参数仅用于首次绑定启用；后续受控部署更新单独执行'
 catalog=json.loads(binding_catalog.read_text())
 assert len(catalog['environments'])==1 and catalog['environments'][0]['id']=='production'
 expected={'resource-manager':settings['RESOURCE_API_URL'],'files':settings['FILES_API_URL'],'office-one':settings['FILES_API_URL'].rstrip('/')+'/office','expert-database':settings['EXPERT_API_URL'],'token-one':settings['TOKEN_API_URL'],'identity':settings['IDENTITY_ISSUER'].rstrip('/')+'/api'}
 assert {d['appId']:d['baseUrl'] for d in catalog['environments'][0]['deployments']}=={key:value.rstrip('/') for key,value in expected.items()},'首次绑定必须保留原上游地址'
 shutil.copy2(envfile,backup/'services.env');assert not config.exists()
 config.parent.mkdir(exist_ok=True,mode=0o755)
 compose=target/'deploy/compose.yaml';content=compose.read_text();needle='- /opt/mg-desktop/shared/desktop:/var/lib/mg-desktop';assert content.count(needle)==1
 compose.write_text(content.replace(needle,needle+'\n      - /opt/mg-desktop/config:/etc/mg-desktop:ro'))
 run(['docker','exec','-i','mg-service-registry-db-1','psql','-U','registry_owner','-d','mg_services','-v','ON_ERROR_STOP=1'],input='GRANT UPDATE(endpoint_ref,deployment_id,deployment_digest,manifest_digest,contract_digest) ON service_bindings TO registry_app;',text=True,stdout=subprocess.DEVNULL)
 run(['docker','stop','--time','30','mg-desktop-desktop-1'],stdout=subprocess.DEVNULL)
try:
 if binding_catalog:
  config.write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n');config.chmod(0o644)
  admin('bind',config);admin('verify-bindings',config)
  envfile.write_text(envfile.read_text().rstrip()+'\nSERVICE_DEPLOYMENTS_FILE=/etc/mg-desktop/services-deployments.json\n');envfile.chmod(0o600)
 run(['docker','compose','-f',str(target/'deploy/compose.yaml'),'up','-d','--no-deps','--no-build','--wait','--wait-timeout','120','desktop'],env={**os.environ,'RELEASE_ID':release})
 link=root/('current-'+release);link.symlink_to(target);link.replace(root/'current')
 print('服务版本治理已部署 '+release)
except Exception:
 if binding_catalog:
  shutil.copy2(backup/'services.env',envfile)
  if config.exists():config.rename(backup/'unactivated-deployments.json')
 run(['docker','tag',old_desktop,'mg-desktop-service:'+previous.name])
 run(['docker','compose','-f',str(previous/'deploy/compose.yaml'),'up','-d','--no-deps','--no-build','--wait','desktop'],env={**os.environ,'RELEASE_ID':previous.name});raise
