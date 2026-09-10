"""在隔离数据库恢复备份并比较身份关系，只输出计数和差异分类。"""
import json, subprocess, uuid
from pathlib import Path
container='mg-identity-db-1'
temporary='catalog_audit_'+uuid.uuid4().hex
def command(args,**kwargs):
    return subprocess.run(['docker','exec',container,*args],check=True,**kwargs)
def rows(database,table):
    sql='SELECT coalesce(json_agg(t),\'[]\') FROM "'+table+'" t'
    result=subprocess.check_output(['docker','exec',container,'psql','-U','identity','-d',database,'-Atc',sql],text=True)
    return json.loads(result)
command(['createdb','-U','identity',temporary])
try:
    backup=Path('/opt/mg-desktop/backups/catalog-20260909T173539Z/identity.dump')
    with backup.open('rb') as stream:
        subprocess.run(['docker','exec','-i',container,'pg_restore','-U','identity','-d',temporary,'--exit-on-error'],stdin=stream,check=True)
    for table,keys in [('User',['id']),('ApplicationUser',['clientId','userId']),('UserRole',['userId','roleId']),('RoleApplication',['roleId','clientId']),('Role',['id'])]:
        before=rows(temporary,table); after=rows('identity',table)
        key=lambda r:tuple(r[k] for k in keys)
        old={key(r):r for r in before}; new={key(r):r for r in after}
        removed=set(old)-set(new)
        modified=[k for k in old.keys()&new.keys() if any(new[k].get(c)!=v for c,v in old[k].items())]
        added=[new[k] for k in new.keys()-old.keys()]
        allowed=not added
        if table=='Role': allowed=all(r.get('key') in ['division-admin','organization-admin'] for r in added)
        if table=='RoleApplication':
            admins={r['id'] for r in rows('identity','Role') if r.get('key')=='platform-admin'}
            allowed=all(r['clientId']=='service-manager' and r['roleId'] in admins and r['enabled'] for r in added)
        print(json.dumps({'table':table,'before':len(before),'after':len(after),'removed':len(removed),'modified':len(modified),'added':len(added),'expectedAdditions':allowed}))
        assert not removed and not modified and allowed, '身份数据存在未解释差异：'+table
    print('迁移前账号和授权全部保留；新增记录符合已执行迁移。')
finally:
    command(['dropdb','-U','identity',temporary])
