import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import pg from 'pg';
import { randomUUID } from 'node:crypto';

// 单独执行时由注册验证入口提供隔离数据库和新构建的 JAR。
if (!process.env.JAVA_TEST_APPLICATION_DATABASE_URL) {
  const helper = spawn(process.execPath, [resolve(import.meta.dirname, 'verify-application-registration.mjs')], { stdio: 'inherit', windowsHide: true });
  helper.on('error', error => { throw error; });
  process.exit((await once(helper, 'exit'))[0] ?? 1);
}
const databaseUrl = new URL(process.env.JAVA_TEST_APPLICATION_DATABASE_URL);
assert(['127.0.0.1', 'localhost'].includes(databaseUrl.hostname), '兼容验证只接受本地测试数据库');
const database = new pg.Client({ connectionString: databaseUrl.href });
const schema = 'compat_' + randomUUID().replaceAll('-', '');

// 两个真实后端进程使用同一 HTTP 身份/业务替身；所有写入均在独立临时目录。
const root=resolve(import.meta.dirname,'..');
const kernel=resolve(root,'../mg-platform-kernel');
const workspace=await mkdtemp(join(root,'.runtime/java-platform-verify-'));
const children=[];
const tokenA='A'.repeat(43),tokenB='B'.repeat(43),origin='http://127.0.0.1:4301';
const sha=value=>createHash('sha256').update(value).digest('hex');
let machineRequests=0,renewRequests=0;
const apps=['service-manager','resource-manager','low-alt-cockpit','office-one','files','personal-center','app-manager','expert-database','token-one','token-one-console','token-one-docs','identity'];
const mock=createServer(async(req,res)=>{
  let bytes=Buffer.alloc(0);for await(const chunk of req) bytes=Buffer.concat([bytes,chunk]);
  const url=new URL(req.url,'http://localhost');
  const json=(status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
  if(url.pathname==='/token') {machineRequests++;return json(200,{access_token:'machine-fixture',expires_in:60});}
  if(url.pathname.startsWith('/api/unified/')) {
    assert.equal(req.headers.authorization,'Bearer machine-fixture');
    const body=JSON.parse(bytes.toString()),operation=url.pathname.split('/').at(-1);
    const profile=(token,app='desktop-one')=>({active:true,iss:mockOrigin,aud:app,sub:token===tokenB?'user-b':'user-a',sid:'session-fixture',username:'fixture',name:'体验用户',department:null,avatarUrl:null,role:token===tokenB?'member':'system_admin',localUserId:null,securityVersion:1,authTime:1700000000,amr:['pwd'],exp:2000000000,csrfToken:'csrf-fixture'});
    if(operation==='introspect') {
      if(![tokenA,tokenB].includes(body.token) || body.token===tokenB && body.app_id==='app-manager') return json(200,{active:false});
      return json(200,profile(body.token,body.app_id));
    }
    if(operation==='applications') return json(200,{applications:apps.filter(id=>body.token!==tokenB||id!=='app-manager').map(id=>({id,name:id}))});
    if(operation==='exchange') return json(200,{access_token:tokenA,profile:profile(tokenA)});
    if(operation==='renew') {renewRequests++;await new Promise(r=>setTimeout(r,100));return json(200,{access_token:body.token,profile:profile(body.token)});}
    if(operation==='revoke') return json(200,{revoked:true});
    return json(404,{});
  }
  if(url.pathname.endsWith('/auth/me')) return json(200,{user:{role:'system_admin'}});
  if(url.pathname.endsWith('/download')) {
    res.writeHead(206,{'content-type':'application/octet-stream','content-range':'bytes 1-3/5','content-length':'3','accept-ranges':'bytes','content-disposition':'attachment; filename="fixture.bin"','etag':'"fixture"','set-cookie':'upstream-secret=forbidden','x-untrusted':'discard'});return res.end(Buffer.from([0,128,255]));
  }
  if(url.pathname.endsWith('/stream')) {
    res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: first\n\n');setTimeout(()=>res.end('data: second\n\n'),300);return;
  }
  if(url.pathname.endsWith('/version.json')) return json(200,{schemaVersion:1,appId:'files',version:'20260909T000000Z'});
  return json(200,{path:url.pathname,query:url.search,method:req.method,headers:req.headers,body:bytes.toString()});
});
mock.listen(0,'127.0.0.1');await once(mock,'listening');
const mockOrigin=`http://127.0.0.1:${mock.address().port}`;
async function freePort(){const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;await new Promise(r=>server.close(r));return port;}
async function run(command,args,env) {
  const process = spawn(command,args,{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  children.push(process);let output='';process.stdout.on('data',data=>output+=data);process.stderr.on('data',data=>output+=data);
  assert.equal((await once(process,'exit'))[0],0,output);return output;
}
async function start(kind){
  const runtime=join(workspace,kind);await mkdir(runtime,{recursive:true});
  for(const area of ['preferences','applications','notifications'])await mkdir(join(runtime,area));
  await writeFile(join(runtime,'preferences',sha('user-a')+'.json'),JSON.stringify({theme:'dark',wallpaper:'dusk',restore:false,pinned:['files'],applicationOrder:['files','personal-center']}));
  await writeFile(join(runtime,'notifications',sha('user-a')+'.json'),JSON.stringify([{id:'legacy-notification',text:'旧通知',appId:'files',appName:'文件',createdAt:'2026-01-01T00:00:00.000Z',read:false}]));
  const port=await freePort(),env={...process.env,NODE_ENV:'test',PORT:String(port),HOST:'127.0.0.1',DESKTOP_ORIGIN:origin,DESKTOP_RUNTIME_DIR:runtime,DESKTOP_CONFIG_FILE:resolve(root,'../mg-platform/packages/frontend/config/application-catalog.json'),DESKTOP_WEB_DIR:join(root,'dist/web'),DESKTOP_FLOW_KEY:'12'.repeat(32),IDENTITY_ISSUER:mockOrigin,IDENTITY_CLIENT_ID:'desktop-one',IDENTITY_CLIENT_SECRET:'fixture-'.repeat(8),SERVICE_DATABASE_URL:'',SERVICE_DEPLOYMENTS_FILE:'',SERVICE_ENVIRONMENT:'local',FILES_API_URL:mockOrigin+'/provider/files',RESOURCE_API_URL:mockOrigin+'/provider/resources',TOKEN_API_URL:mockOrigin+'/provider/token',EXPERT_API_URL:mockOrigin+'/provider/expert'};
  for(const key of ['SERVICE_WEB_URL','RESOURCE_WEB_URL','OFFICE_WEB_URL','FILES_WEB_URL','PERSONAL_WEB_URL','APP_MANAGER_WEB_URL','EXPERT_WEB_URL','TOKEN_WEB_URL','IDENTITY_WEB_URL'])env[key]=mockOrigin;
  let command=process.execPath,args=[join(root,'node_modules/tsx/dist/cli.mjs'),join(root,'apps/server/src/main.ts')];
  if(kind==='java'){
    const jdk=(await readdir(join(kernel,'.runtime/java-tools'))).find(name=>name.startsWith('jdk-25'));
    command=join(kernel,'.runtime/java-tools',jdk,'bin/java.exe');args=['-jar',process.env.TEST_KERNEL_JAR || join(kernel,'target/mg-platform-kernel-0.1.0-SNAPSHOT.jar')];
    const exported = await run(process.execPath,[join(root,'node_modules/tsx/dist/cli.mjs'),'--eval',"import {registry} from './apps/server/src/config.ts'; console.log(JSON.stringify(registry));"],env);
    const applications=JSON.parse(exported).map(app=>({...app,allowedApiPaths:app.allowedApiPaths??null,
      authorizationAppId:app.authorizationAppId??null,requiredRole:app.requiredRole??null,defaultMaximized:app.defaultMaximized??false}));
    const input=join(runtime,'application-registration.json');await writeFile(input,JSON.stringify({schemaVersion:1,applications}));
    const target=new URL(databaseUrl);target.searchParams.set('currentSchema',schema);env.SERVICE_DATABASE_URL=target.href;
    await run(command,[...args,'desktop-applications','migrate',input],env);
    await run(command,[...args,'service-storage','migrate',join(workspace,'node/services/registry.json')],env);
  }
  const child=spawn(command,args,{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});children.push(child);
  let output='';child.stdout.on('data',chunk=>output=(output+chunk).slice(-15000));child.stderr.on('data',chunk=>output=(output+chunk).slice(-15000));
  const address=`http://127.0.0.1:${port}`;
  for(let i=0;i<300;i++){
    if(child.exitCode!==null)throw Error(`${kind} 启动失败：${output}`);
    try{const response=await fetch(address+'/api/health');if(response.ok)return {kind,address,runtime};}catch{}
    await new Promise(r=>setTimeout(r,100));
  }
  throw Error(`${kind} 启动超时：${output}`);
}
async function request(server,path,{method='GET',body,token=tokenA,extra={}}={}){
  return fetch(server.address+path,{method,redirect:'manual',headers:{origin,...(token?{cookie:`mg_desktop_token=${token}`}:{ }),'x-csrf-token':'csrf-fixture',...(body!==undefined?{'content-type':'application/json'}:{}),...extra},...(body!==undefined?{body:JSON.stringify(body)}:{})});
}
async function read(response,status=200){assert.equal(response.status,status,await response.clone().text());return response.json();}
try{
  await database.connect();await database.query('CREATE SCHEMA '+schema);
  const node=await start('node'),java=await start('java');
  for(const server of [node,java]){
    assert.equal((await request(server,'/api/session',{token:null})).status,401);
    assert.equal((await request(server,'/api/session',{extra:{origin:'https://untrusted.invalid'}})).status,403);
    assert.equal((await request(server,'/api/session',{extra:{cookie:`mg_desktop_token=${tokenA}; mg_desktop_token=${tokenA}`}})).status,401);
    assert.equal((await request(server,'/api/preferences',{method:'PUT',body:{theme:'light'},extra:{'x-csrf-token':'wrong'}})).status,401);
    assert.equal((await request(server,'/api/preferences',{extra:{'x-desktop-account':'another-user'}})).status,409);
    assert.equal((await request(server,'/api/applications',{token:tokenB})).status,401);
    assert.deepEqual(await read(await request(server,'/api/preferences',{token:tokenB})),{});
    const before=await read(await request(server,'/api/preferences'));assert.equal(before.theme,'dark');assert.equal(before.restore,false);
    const preferences=await read(await request(server,'/api/preferences',{method:'PUT',body:{theme:'light',pinned:['files','files','missing'],applicationOrder:['personal-center','files']}}));
    assert.deepEqual(preferences.pinned,['files']);assert.deepEqual(preferences.applicationOrder,['personal-center','files']);
    const notifications=await read(await request(server,'/api/notifications'));assert.equal(notifications.items[0].id,'legacy-notification');
    await read(await request(server,'/api/notifications',{method:'PATCH',body:{id:'legacy-notification',read:true}}));
    assert.equal((await read(await request(server,'/api/notifications'))).items[0].read,true);
    await read(await request(server,'/api/notifications',{method:'POST',body:{text:'新通知',appId:'files'}}),201);
    const added=await read(await request(server,'/api/applications',{method:'POST',body:{name:'参考资料',url:'https://example.org',description:'外链'}}),201);
    assert.equal(added.entryUrl,'https://example.org/');assert.equal(added.editable,true);
    await read(await request(server,'/api/applications/'+added.id,{method:'DELETE'}));
    assert.equal((await request(server,'/api/applications/files',{method:'PUT',body:{name:'修改',url:'https://example.org'}})).status,403);
    assert.equal((await request(server,'/api/applications',{method:'POST',body:{name:'冒充平台',url:origin}})).status,400);
    const proxy=await read(await request(server,'/api/apps/files/echo?tab=test',{method:'POST',body:{hello:'世界'},extra:{'x-untrusted':'discard'}}));
    assert.equal(proxy.path,'/provider/files/echo');assert.equal(proxy.query,'?tab=test');assert.equal(proxy.headers.authorization,`Bearer ${tokenA}`);assert.equal(proxy.headers.cookie,undefined);assert.equal(proxy.headers['x-untrusted'],undefined);assert.equal(JSON.parse(proxy.body).hello,'世界');
    const serviceCatalog=await read(await request(server,'/api/service-registry'));assert.equal(serviceCatalog.items.length,6);assert.equal(serviceCatalog.canManage,true);assert.equal(serviceCatalog.storage.backend,server.kind==='java'?'postgresql':'json');
    assert.equal((await request(server,'/api/services/apps/files/entries',{token:null})).status,401);
    assert.equal((await request(server,'/api/services/apps/files/not-declared')).status,404);
    const serviceResponse=await request(server,'/api/services/apps/files/entries?page=2');
    assert.equal(serviceResponse.headers.get('x-service-id'),'files.api');assert.equal(serviceResponse.headers.get('x-service-lifecycle'),'published');assert.ok(serviceResponse.headers.get('x-request-id'));
    const service=await read(serviceResponse);assert.equal(service.path,'/provider/files/entries');assert.equal(service.query,'?page=2');assert.equal(service.headers.authorization,`Bearer ${tokenA}`);assert.equal(service.headers.cookie,undefined);
    const namedResponse=await request(server,'/api/services/invoke/files.api/content?path.id=doc_1&download=1');
    assert.equal(namedResponse.headers.get('x-service-id'),'files.api');const named=await read(namedResponse);assert.equal(named.path,'/provider/files/entries/doc_1/content');assert.equal(named.query,'?download=1');
    assert.equal((await request(server,'/api/apps/personal-center/admin/users')).status,403);
    assert.equal((await request(server,'/api/apps/token-one-docs/public/models',{method:'POST',body:{}})).status,403);
    const download=await request(server,'/api/apps/files/download',{extra:{range:'bytes=1-3'}});assert.equal(download.status,206);assert.equal(download.headers.get('content-range'),'bytes 1-3/5');assert.equal(download.headers.get('set-cookie'),null);assert.equal(download.headers.get('x-untrusted'),null);assert.deepEqual(new Uint8Array(await download.arrayBuffer()),new Uint8Array([0,128,255]));
    const stream=await request(server,'/api/apps/files/stream');const reader=stream.body.getReader();const first=await reader.read();assert.equal(new TextDecoder().decode(first.value),'data: first\n\n');let rest='';for(;;){const chunk=await reader.read();if(chunk.done)break;rest+=new TextDecoder().decode(chunk.value);}assert.equal(rest,'data: second\n\n');
    const count=renewRequests;await Promise.all(Array.from({length:8},async()=>assert.equal((await request(server,'/auth/renew',{method:'POST'})).status,200)));assert.equal(renewRequests-count,1);
    assert.equal((await request(server,'/auth/logout',{method:'POST'})).headers.getSetCookie().some(value=>value.startsWith('mg_desktop_token=;')&&value.includes('Max-Age=0')),true);
  }
  for(const [producer,consumer] of [[node,java],[java,node]]){
    const start=await request(producer,'/auth/start?app=files&path='+encodeURIComponent('/my-files?open=12345678-1234-1234-1234-123456789012&token=secret'));
    assert.equal(start.status,303);const state=new URL(start.headers.get('location')).searchParams.get('state');
    const flow=start.headers.getSetCookie().find(value=>value.startsWith('mg_desktop_flow=')).split(';')[0];
    const callback=await request(consumer,`/auth/callback?code=fixture&state=${state}`,{extra:{cookie:flow}});
    assert.equal(callback.status,303,await callback.clone().text());assert.equal(callback.headers.get('location'),'/open?app=files&path=%2Fmy-files%3Fopen%3D12345678-1234-1234-1234-123456789012');assert.ok(callback.headers.getSetCookie().some(value=>value.startsWith(`mg_desktop_token=${tokenA};`)));
  }
  const nodeSession=await read(await request(node,'/api/session')),javaSession=await read(await request(java,'/api/session'));assert.deepEqual(javaSession,nodeSession);
  for(const area of ['preferences','applications'])assert.deepEqual(JSON.parse(await readFile(join(java.runtime,area,sha('user-a')+'.json'))),JSON.parse(await readFile(join(node.runtime,area,sha('user-a')+'.json'))));
  const result={status:'passed',scenarios:['登录 Cookie 双向兼容','会话与完整应用目录一致','匿名／越权／CSRF 拒绝','跨账户数据隔离','已有 JSON 数据读取与写回','个人外链管理','通知创建与已读','代理请求头隔离','服务目录查询与权限','登记服务路径调用','命名操作调用与路径参数隔离','服务追踪与生命周期响应头','Range 下载与响应头隔离','SSE 首帧流式到达','并发续期合并','退出清除 Cookie'],machineRequests,workspace,scope:'平台会话、个人状态、应用代理；Java 应用和服务目录使用隔离 PostgreSQL schema，Node 保留历史 JSON；身份和业务使用 HTTP 替身，不代表真实生产或受控部署验收'};
  await writeFile(join(workspace,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{
  await Promise.all(children.map(async child=>{if(child.exitCode===null){child.kill();await once(child,'exit').catch(()=>{});}}));
  mock.closeAllConnections();await new Promise(r=>mock.close(r));
  try { await database.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE'); } finally { await database.end(); }
}
