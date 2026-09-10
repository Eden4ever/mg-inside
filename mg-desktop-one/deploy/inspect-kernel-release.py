"""只输出发布拓扑、迁移状态和应用基础清单，不输出凭据。"""
import json, subprocess

def output(args):
    return subprocess.check_output(args, text=True).strip()

def environment(container):
    values=json.loads(output(['docker','inspect',container,'--format','{{json .Config.Env}}']))
    return dict(value.split('=',1) for value in values if '=' in value)

env=environment('mg-identity-db-1')
user=env.get('POSTGRES_USER','postgres');database=env.get('POSTGRES_DB',user)
def identity(sql):
    return output(['docker','exec','mg-identity-db-1','psql','-U',user,'-d',database,'-Atc',sql])

print('身份迁移记录：'+identity('SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY migration_name'))
print('身份应用清单：'+identity('SELECT json_agg(a) FROM (SELECT "clientId",name,enabled FROM "Application" ORDER BY "clientId") a'))
for container in ['mg-desktop-desktop-1','mg-identity-identity-1']:
    data=environment(container)
    public={key:value for key,value in data.items() if key in ['DESKTOP_CONFIG_FILE','DESKTOP_WEB_DIR','DESKTOP_RUNTIME_DIR','SERVICE_ENVIRONMENT','IDENTITY_ISSUER','PORT'] or key.endswith('_API_URL')}
    print(container+': '+json.dumps(public))
