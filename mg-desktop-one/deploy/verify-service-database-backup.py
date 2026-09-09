"""备份并恢复到唯一临时数据库验证，绝不覆盖正在运行的服务目录。"""
from pathlib import Path
import hashlib,json,re,subprocess,sys
release=sys.argv[1];assert re.fullmatch(r'\d{8}T\d{6}Z',release)
root=Path('/opt/mg-desktop');backup=root/'backups'/('service-storage-'+release)
assert (backup/'completed.json').is_file()
output=backup/'services.dump';assert not output.exists()
name='services_restore_'+release.lower();assert re.fullmatch(r'services_restore_\d{8}t\d{6}z',name)
container='mg-service-registry-db-1'
def command(*args,input=None):return subprocess.check_output(['docker','exec',*(['-i'] if input is not None else []),container,*args],input=input)
def query(database,sql):return command('psql','-U','registry_owner','-d',database,'-At','-v','ON_ERROR_STOP=1','-c',sql)
dump=command('pg_dump','-U','registry_owner','-d','mg_services','--format=custom','--no-owner','--no-acl')
with output.open('xb') as file:file.write(dump)
output.chmod(0o600)
command('createdb','-U','registry_owner','--template=template0',name)
try:
 query('mg_services',f'REVOKE ALL ON DATABASE "{name}" FROM PUBLIC')
 command('pg_restore','-U','registry_owner','-d',name,'--no-owner','--no-acl','--exit-on-error',input=dump)
 restored=json.loads(query(name,"SELECT json_build_object('publications',(SELECT json_agg(json_build_object('manifest',manifest,'digest',digest,'contractDigest',contract_digest)) FROM service_publications),'audit',(SELECT json_agg(event) FROM service_audit),'activity',(SELECT json_agg(event) FROM service_activity),'active',(SELECT json_object_agg(service_id,version) FROM service_bindings WHERE environment='production'))"))
 source=json.loads((backup/'source.json').read_text())
 for item in source['publications']:
  found=next(p for p in restored['publications'] if p['manifest']['serviceId']==item['manifest']['serviceId'] and p['manifest']['version']==item['manifest']['version'])
  assert found['manifest']==item['manifest'] and found['digest']==item['digest'] and found['contractDigest']==item.get('contractDigest')
 for kind in ['audit','activity']:
  values={item['id']:item for item in restored[kind] or []}
  for item in source[kind]:assert values[item['id']]==item
 assert len(restored['active'])==6
 result={'release':release,'backup':str(output),'sha256':hashlib.sha256(dump).hexdigest(),'restoredPublications':len(restored['publications']),'originalRecordsPreserved':True}
 (backup/'restore-verification.json').write_text(json.dumps(result))
 print(json.dumps(result))
finally:
 command('dropdb','-U','registry_owner',name)
 print('唯一临时恢复数据库已删除，生产目录保持原位。')
