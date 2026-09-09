"""只读核验生产部署绑定；发布前保留版本、修订和历史记录基线。"""
from pathlib import Path
import hashlib,json,shlex,subprocess,sys

remote=r'''
from pathlib import Path
import json,subprocess
def output(args):return subprocess.check_output(args,text=True).strip()
container=json.loads(output(['docker','inspect','mg-desktop-desktop-1']))[0]
settings=dict(item.split('=',1) for item in container['Config']['Env'] if '=' in item)
def query(sql):return json.loads(output(['docker','exec','mg-service-registry-db-1','psql','-U','registry_owner','-d','mg_services','-At','-c',sql]))
data={'current':str(Path('/opt/mg-desktop/current').resolve(strict=True)),'image':container['Config']['Image'],'health':container['State']['Health']['Status'],'environment':settings['SERVICE_ENVIRONMENT'],
 'publications':query("SELECT json_agg(json_build_object('serviceId',service_id,'version',version,'manifestDigest',digest,'contractDigest',contract_digest)) FROM service_publications"),
 'bindings':query("SELECT json_agg(to_jsonb(b)) FROM service_bindings b WHERE environment='production'"),
 'audit':query("SELECT json_agg(id) FROM service_audit WHERE environment='production'"),
 'activity':query("SELECT json_agg(id) FROM service_activity WHERE environment='production'")}
if settings.get('SERVICE_DEPLOYMENTS_FILE'):
 path=Path('/opt/mg-desktop/config/services-deployments.json');info=path.stat()
 data.update({'catalog':json.loads(path.read_text()),'configUid':info.st_uid,'configMode':info.st_mode&0o777,'configPath':settings['SERVICE_DEPLOYMENTS_FILE'],
 'readOnlyMount':any(m['Source']=='/opt/mg-desktop/config' and m['Destination']=='/etc/mg-desktop' and not m['RW'] for m in container['Mounts'])})
print(json.dumps(data))
'''
data=json.loads(subprocess.check_output(['ssh','root@43.139.78.226','python3 -c '+shlex.quote(remote)],text=True))
baseline=Path('artifacts/service-binding-baseline.json')
if sys.argv[1]=='--capture':
 assert not baseline.exists(),'基线已存在，不能覆盖'
 baseline.write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8');print('已保存发布前基线：'+str(baseline));sys.exit()
release=sys.argv[1];before=json.loads(baseline.read_text(encoding='utf-8'))
assert data['current']=='/opt/mg-desktop/releases/'+release and data['image']=='mg-desktop-service:'+release and data['health']=='healthy'
assert data['environment']=='production' and data['configPath']=='/etc/mg-desktop/services-deployments.json'
assert data['configUid']==0 and data['configMode']==0o644 and data['readOnlyMount']
by_version=lambda items:{(p['serviceId'],p['version']):p for p in items}
assert by_version(before['publications']).items()<=by_version(data['publications']).items(),'历史版本被改变或删除'
for key in ['audit','activity']:assert set(before[key] or [])<=set(data[key] or []),'历史记录丢失：'+key
previous={b['service_id']:b for b in before['bindings']}
deployments=data['catalog']['environments'][0]['deployments'];assert len(deployments)==6
captured=json.loads(Path('artifacts/service-deployments-production.json').read_text(encoding='utf-8'))['environments'][0]['deployments']
assert {d['endpointRef']:d for d in deployments}=={d['endpointRef']:d for d in captured},'实际捕获的运行产物与正式登记不一致'
for binding in data['bindings']:
 if not binding['version']:continue
 old=previous[binding['service_id']];assert binding['version']==old['version'] and binding['revision']==old['revision']+1
 deployment=next(d for d in deployments if d['endpointRef']==binding['endpoint_ref'])
 digest=hashlib.sha256(json.dumps(deployment,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
 assert binding['deployment_digest']==digest and binding['deployment_id']==deployment['deploymentId']
 assert any(s['serviceId']==binding['service_id'] and s['version']==binding['version'] and s['manifestDigest']==binding['manifest_digest'] and s['contractDigest']==binding['contract_digest'] for s in deployment['services'])
print(json.dumps({'release':release,'verified':True,'bindings':len(deployments),'historicalVersions':len(data['publications']),'historyPreserved':True,'rootOwnedReadOnlyConfig':True}))
