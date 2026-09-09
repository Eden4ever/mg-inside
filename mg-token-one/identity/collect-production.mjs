import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { preview } from './match.mjs';

// 仅查询原账号的身份字段。连接机密留在生产进程内，员工资料只写入受限报告。
const output = path.join(import.meta.dirname, 'private/production');
let stage = '读取受限配置';
function remote(host, command, input) {
  const result = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=12', `root@${host}`, command],
    { input, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) throw new Error('远端只读查询失败');
  return JSON.parse(result.stdout);
}
try {
  const config = parseEnv(await fs.readFile(path.join(output, 'providers.env'), 'utf8'));
  if (!config.WECOM_CORP_ID || !config.WECOM_APP_SECRET) throw new Error('企业配置不完整');
  stage = '读取 Token One 生产账号';
  const token = remote('1.12.253.86', 'docker exec -i mg-gateway node -', `
const mysql = require('mysql2/promise');
(async () => {
  const e = process.env;
  const db = await mysql.createConnection({host:e.DB_HOST,port:Number(e.DB_PORT||3306),user:e.DB_USERNAME,password:e.DB_PASSWORD,database:e.DB_DATABASE});
  try {
    await db.query('START TRANSACTION READ ONLY');
    const [config] = await db.query('SELECT corpid FROM wecom_config WHERE id = 1');
    const [users] = await db.query('SELECT id, username, displayName, role, status, syncSource, wecomUserId FROM users');
    console.log(JSON.stringify({corpId:config[0]?.corpid || e.WECOM_CORPID || 'unknown',users}));
  } finally { await db.rollback(); await db.end(); }
})().catch(() => { console.error('只读查询失败');process.exitCode=1; });
`);
  stage = '读取指标库生产账号';
  const expert = remote('43.139.78.226', 'cd /opt/mg-expert-database/current/apps/api && /opt/mg-expert-database/runtimes/node-v24.20.0-linux-x64/bin/node --env-file=/etc/mg-expert-database/api.env -', `
const {PrismaClient}=require('@prisma/client');
const db=new PrismaClient({log:[]});
(async()=>{
 try {
  const result=await db.$transaction(async tx=>{
   await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
   const users=await tx.user.findMany({select:{id:true,username:true,displayName:true,role:true,status:true,authSource:true,wecomIdentities:{select:{corpId:true,externalUserId:true}}}});
   const revocations=await tx.weComIdentityRevocation.findMany({select:{corpId:true,externalUserId:true}});
   return {users,revocations,webAppUrl:process.env.WEB_APP_URL};
  });
  console.log(JSON.stringify(result));
 } finally {await db.$disconnect();}
})().catch(()=>{console.error('只读查询失败');process.exitCode=1;});
`);
  stage = '从可信 IP 读取企微目录';
  const settings = { corpId: config.WECOM_CORP_ID, secret: config.WECOM_APP_SECRET };
  const directory = remote('1.12.253.86', 'python3 -', `import json, urllib.request, urllib.parse
config = json.loads(${JSON.stringify(JSON.stringify(settings))})
def api(endpoint, params):
    url = 'https://qyapi.weixin.qq.com/cgi-bin/' + endpoint + '?' + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=15) as response:
        result = json.load(response)
    if result.get('errcode') != 0: raise RuntimeError('企业接口失败')
    return result
try:
    token = api('gettoken', {'corpid':config['corpId'], 'corpsecret':config['secret']})['access_token']
    members = api('user/list', {'access_token':token,'department_id':1,'fetch_child':1})['userlist']
    departments = api('department/list', {'access_token':token,'id':1})['department']
    print(json.dumps({'members':[{'userId':m['userid'],'name':m.get('name',''),'active':m.get('status')==1,'departments':m.get('department',[])} for m in members], 'departments':[{'id':d['id'],'name':d.get('name','')} for d in departments]}))
except Exception:
    raise SystemExit('企业目录读取失败')
`);
  const data = {
    corpId: config.WECOM_CORP_ID,
    scope: { gateway: '生产 1.12.253.86 / mg-gateway / mg_gateway', expert: `生产 43.139.78.226 / mg-expert-database-api / ${expert.webAppUrl || '未设置 WEB_APP_URL'}`, directory: '应用 1000007 当前可见范围；不保证覆盖全企业' },
    tokenUsers: token.users.map(u => ({id:u.id,username:u.username,name:u.displayName,role:u.role,active:u.status===1,source:u.syncSource,identities:u.wecomUserId?[{corpId:token.corpId,userId:u.wecomUserId}]:[]})),
    expertUsers: expert.users.map(u=>({id:u.id,username:u.username,name:u.displayName,role:u.role,active:u.status==='active',source:u.authSource,identities:u.wecomIdentities.map(i=>({corpId:i.corpId,userId:i.externalUserId}))})),
    revocations: expert.revocations.map(i=>({corpId:i.corpId,userId:i.externalUserId})),
    members: directory.members,
    departments: directory.departments,
  };
  const report = preview(data);
  for (const [name, value] of [['account-source.json',data],['account-preview.json',report]]) {
    await fs.writeFile(path.join(output,name), JSON.stringify(value,null,2), {mode:0o600});
  }
  console.log(JSON.stringify({status:'complete',counts:{token:data.tokenUsers.length,expert:data.expertUsers.length,members:data.members.length},totals:report.totals,scope:data.scope,output:'identity/private/production/account-preview.json'}));
} catch {
  console.error(JSON.stringify({status:'blocked',stage,notice:'未修改任何生产账号；未输出机密和远端错误正文。'}));
  process.exitCode=1;
}
