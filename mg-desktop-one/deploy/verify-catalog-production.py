"""生产只读检查，不输出密钥、用户或授权明细。"""
import json, subprocess, urllib.request
for url in ['https://desktop.meta-gravity.com/api/health','https://identity.meta-gravity.com/health','https://desktop.meta-gravity.com/apps/app-manager/version.json']:
    with urllib.request.urlopen(url,timeout=15) as response:
        assert response.status==200
        print(url, response.status)
script="""const r=await fetch(process.env.APPLICATION_REGISTRY_URL,{headers:{'X-Application-Registry-Key':process.env.APPLICATION_REGISTRY_KEY}});if(!r.ok)throw new Error('directory status '+r.status);const d=await r.json();console.log(JSON.stringify({count:d.applications.length,ids:d.applications.map(a=>a.id).sort(),pending:d.applications.filter(a=>!a.runtimeReady).map(a=>a.id)}));"""
result=subprocess.check_output(['docker','exec','mg-identity-identity-1','node','--input-type=module','-e',script],text=True)
directory=json.loads(result)
assert directory['count']==14
assert 'document-one' in directory['pending']
print(json.dumps(directory,ensure_ascii=False))
sql='SELECT column_name FROM information_schema.columns WHERE table_name=\'ApplicationReference\' ORDER BY ordinal_position'
columns=subprocess.check_output(['docker','exec','mg-identity-db-1','psql','-U','identity','-d','identity','-Atc',sql],text=True).strip().splitlines()
assert columns==['clientId']
print('身份应用引用表仅保留 clientId。')
