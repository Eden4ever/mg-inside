from pathlib import Path
import hashlib,json,shlex,subprocess

apps=['mg-resource-one','mg-files-one','mg-office-one','mg-expert-database','mg-token-one/mg-gateway','mg-auth-one-identity']
documents=[json.loads(Path('../'+app+'/services/openapi.json').read_text(encoding='utf-8')) for app in apps]
versions={doc['x-service-id']:doc['info']['version'] for doc in documents}

remote='''from pathlib import Path
import hashlib,json,subprocess
versions=VERSIONS_PLACEHOLDER
configuration=json.loads(subprocess.check_output(['docker','inspect','mg-desktop-desktop-1','--format','{{json .Config.Env}}'],text=True))
if any(value.startswith('SERVICE_DATABASE_URL=') for value in configuration):
 query="SELECT json_build_object('publications',json_agg(json_build_object('manifest',manifest,'contract',contract,'contractDigest',contract_digest)), 'active',(SELECT json_object_agg(service_id,version) FROM service_bindings WHERE environment='production')) FROM service_publications"
 state=json.loads(subprocess.check_output(['docker','exec','mg-service-registry-db-1','psql','-U','registry_owner','-d','mg_services','-At','-c',query],text=True))
else:state=json.loads(Path('/opt/mg-desktop/shared/desktop/services/registry.json').read_text())
result=[]
for item in state['publications']:
 if versions.get(item['manifest']['serviceId'])!=item['manifest']['version']:continue
 contract=item.get('contract')
 digest=hashlib.sha256(json.dumps(contract,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
 result.append({'serviceId':item['manifest']['serviceId'],'version':item['manifest']['version'],'digest':item.get('contractDigest'),'actualDigest':digest,'active':state['active'].get(item['manifest']['serviceId']),'operations':len(item['manifest']['operations'])})
print(json.dumps(result))'''.replace('VERSIONS_PLACEHOLDER',repr(versions))
records=json.loads(subprocess.check_output(['ssh','root@43.139.78.226','python3 -c '+shlex.quote(remote)],text=True))
assert len(records)==len(documents)
for doc in documents:
 expected=hashlib.sha256(json.dumps(doc,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
 record=next(row for row in records if row['serviceId']==doc['x-service-id'])
 assert record['digest']==record['actualDigest']==expected
 assert record['active']==doc['info']['version']
 print(record['serviceId']+' '+record['version']+'：契约摘要一致、当前已启用，共 '+str(record['operations'])+' 个操作')
