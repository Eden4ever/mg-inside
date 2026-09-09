import json,shlex,subprocess

remote=r'''
from pathlib import Path
import json,subprocess
from urllib.parse import urlparse
root=Path('/opt/mg-desktop');current=(root/'current').resolve()
configuration=dict(value.split('=',1) for value in json.loads(subprocess.check_output(['docker','inspect','mg-desktop-desktop-1','--format','{{json .Config.Env}}'],text=True)) if '=' in value)
connection=urlparse(configuration['SERVICE_DATABASE_URL'])
assert connection.username=='registry_app' and connection.hostname=='127.0.0.1' and connection.port==15440 and connection.path=='/mg_services'
assert configuration['SERVICE_ENVIRONMENT']=='production'
source=json.loads((root/'backups/service-storage-20260908T195300Z/source.json').read_text())
query="""SELECT json_build_object(
 'publications',(SELECT json_agg(json_build_object('manifest',manifest,'digest',digest,'contract',contract,'contractDigest',contract_digest,'at',published_at,'actor',actor) ORDER BY sequence) FROM service_publications),
 'active',(SELECT json_object_agg(service_id,version) FROM service_bindings WHERE environment='production'),
 'revisions',(SELECT json_object_agg(service_id,revision) FROM service_bindings WHERE environment='production'),
 'audit',(SELECT json_agg(event) FROM service_audit WHERE environment='production'),
 'activity',(SELECT json_agg(event) FROM service_activity WHERE environment='production'),
 'generation',(SELECT generation FROM service_environments WHERE name='production'),
 'restricted',(SELECT NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole FROM pg_roles WHERE rolname='registry_app'),
 'immutable',NOT has_table_privilege('registry_app','service_publications','UPDATE'),
 'no_create',NOT has_schema_privilege('registry_app','public','CREATE'),
 'runtime_connections',(SELECT count(*) FROM pg_stat_activity WHERE datname='mg_services' AND usename='registry_app'))"""
data=json.loads(subprocess.check_output(['docker','exec','mg-service-registry-db-1','psql','-U','registry_owner','-d','mg_services','-At','-c',query],text=True))
for item in source['publications']:
 current_item=next(p for p in data['publications'] if p['manifest']['serviceId']==item['manifest']['serviceId'] and p['manifest']['version']==item['manifest']['version'])
 for key,value in item.items():assert current_item[key]==value
assert data['active']==source['active']
for service,revision in source.get('revisions',{}).items():assert data['revisions'][service]==revision
for kind in ['audit','activity']:
 saved={item['id']:item for item in data[kind] or []}
 for item in source[kind]:assert saved[item['id']]==item
assert data['restricted'] and data['immutable'] and data['no_create']
cache=json.loads((root/'shared/desktop/services/postgres-snapshot-production.json').read_text())
assert cache['environment']=='production' and cache['state']['active']==data['active']
print(json.dumps({'release':current.name,'publications':len(data['publications']),'bindings':len(data['active']),'audit':len(data['audit'] or []),'activity':len(data['activity'] or []),'generation':data['generation'],'restrictedRole':data['restricted'],'immutableVersions':data['immutable'],'runtimeConnections':data['runtime_connections'],'sourcePreserved':True,'snapshotPresent':True}))
'''
result=json.loads(subprocess.check_output(['ssh','root@43.139.78.226','python3 -c '+shlex.quote(remote)],text=True))
print(json.dumps(result,ensure_ascii=False,indent=2))
