"""首次关联已验证的线上契约与实际运行产物；不部署业务程序。"""
from pathlib import Path
import json,shlex,subprocess

token_code="""import json,subprocess
item=json.loads(subprocess.check_output(['docker','inspect','mg-gateway'],text=True))[0]
assert item['State']['Running']
print(json.dumps({'deploymentId':item['Config']['Image'],'artifactDigest':item['Image'].removeprefix('sha256:'),'deployedAt':item['State']['StartedAt']}))"""
token=json.loads(subprocess.check_output(['ssh','root@1.12.253.86','python3 -c '+shlex.quote(token_code)],text=True))
remote=r'''
from pathlib import Path
import hashlib,json,subprocess
token=TOKEN_PLACEHOLDER
def output(args):return subprocess.check_output(args,text=True).strip()
def inspect(name):return json.loads(output(['docker','inspect',name]))[0]
desktop=inspect('mg-desktop-desktop-1');settings=dict(value.split('=',1) for value in desktop['Config']['Env'] if '=' in value)
assert settings['SERVICE_ENVIRONMENT']=='production'
def docker(name):
 item=inspect(name);assert item['State']['Running']
 return {'deploymentId':item['Config']['Image'],'artifactDigest':item['Image'].removeprefix('sha256:'),'deployedAt':item['State']['StartedAt']}
def systemd(unit):
 pid=output(['systemctl','show',unit,'--property=MainPID','--value']);assert int(pid)>0
 cwd=Path('/proc/'+pid+'/cwd').resolve(strict=True)
 arguments=Path('/proc/'+pid+'/cmdline').read_bytes().decode().split('\0')
 entries=[Path(arg) if Path(arg).is_absolute() else cwd/arg for arg in arguments if arg.endswith(('.js','.mjs','.ts'))]
 assert len(entries)==1
 entry=entries[0].resolve(strict=True);assert entry.is_relative_to(cwd)
 files=sorted(p for p in entry.parent.rglob('*') if p.is_file() and p.suffix in ['.js','.mjs','.ts','.json'] and 'node_modules' not in p.parts)
 assert files
 digest=hashlib.sha256()
 for file in files:digest.update(file.relative_to(entry.parent).as_posix().encode()+b'\0'+hashlib.sha256(file.read_bytes()).digest())
 timestamp=output(['systemctl','show',unit,'--property=ActiveEnterTimestamp','--value'])
 started=output(['date','-d',timestamp,'--iso-8601=seconds'])
 return {'deploymentId':unit.removesuffix('.service')+':'+cwd.name,'artifactDigest':digest.hexdigest(),'deployedAt':started}
query="SELECT json_agg(json_build_object('serviceId',p.service_id,'version',p.version,'manifestDigest',p.digest,'contractDigest',p.contract_digest,'appId',p.app_id)) FROM service_publications p JOIN service_bindings b ON b.service_id=p.service_id AND b.version=p.version WHERE b.environment='production'"
services=json.loads(output(['docker','exec','mg-service-registry-db-1','psql','-U','registry_owner','-d','mg_services','-At','-c',query]));assert len(services)==6 and all(p['contractDigest'] for p in services)
files=docker('mg-desktop-files-1')
targets={
 'resource-manager':(settings['RESOURCE_API_URL'],'资源管理 · 新服务器','resource-manager',systemd('mg-resource-one.service'),'43.139.78.226 / mg-resource-one'),
 'files':(settings['FILES_API_URL'],'文件服务 · 新服务器','files',files,'43.139.78.226 / mg-desktop-files-1'),
 'office-one':(settings['FILES_API_URL'].rstrip('/')+'/office','Office 服务 · Files 后端','files',files,'43.139.78.226 / mg-desktop-files-1'),
 'expert-database':(settings['EXPERT_API_URL'],'指标知识库 · 新服务器','expert-database',systemd('mg-expert-database-api.service'),'43.139.78.226 / mg-expert-database-api'),
 'token-one':(settings['TOKEN_API_URL'],'Token 网关 · 原服务器','token-one',token,'1.12.253.86 / mg-gateway'),
 'identity':(settings['IDENTITY_ISSUER'].rstrip('/')+'/api','统一身份 · 新服务器','identity',docker('mg-identity-identity-1'),'43.139.78.226 / mg-identity-identity-1'),
}
deployments=[]
for service in sorted(services,key=lambda value:value['appId']):
 app=service.pop('appId');url,name,provider,artifact,resource=targets[app]
 deployments.append({'endpointRef':app+'-production','name':name,'appId':app,'providerAppId':provider,'environment':'production','baseUrl':url.rstrip('/'),'resourceRef':resource,**artifact,'services':[service]})
print(json.dumps({'schemaVersion':1,'environments':[{'id':'production','name':'生产','deployments':deployments}]},ensure_ascii=False))
'''.replace('TOKEN_PLACEHOLDER',repr(token))
catalog=json.loads(subprocess.check_output(['ssh','root@43.139.78.226','python3 -c '+shlex.quote(remote)],text=True))
path=Path('artifacts/service-deployments-production.json');path.write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('已捕获 6 个真实部署与当前契约：'+str(path))
for deployment in catalog['environments'][0]['deployments']:print(deployment['appId']+' → '+deployment['deploymentId'])
