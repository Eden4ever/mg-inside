/** 构建后桌面 HTTP 回归：身份为隔离替身，目录为临时 JSON，不替代 PostgreSQL 与真实身份验收。 */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';

const root=resolve(import.meta.dirname,'..'),runtime=await mkdtemp(join(tmpdir(),'mg-contract-http-'));
const admin='a'.repeat(43),reader='r'.repeat(43),denied='d'.repeat(43),csrf='contract-http-csrf';
let child,identityOrigin,output='';
const identity=createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json');
  if(req.url==='/token'){res.end(JSON.stringify({access_token:'isolated-machine-token',expires_in:60}));return;}
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const body=JSON.parse(Buffer.concat(chunks).toString()||'{}');
  if(req.url==='/api/unified/introspect'){
    const active=[admin,reader].includes(body.token)&&['desktop-one','service-manager','resource-manager','files','personal-center'].includes(body.app_id);
    res.end(JSON.stringify(active?{active:true,iss:identityOrigin,aud:body.app_id,sub:body.token===admin?'test-admin':'test-reader',sid:'isolated-session',name:'隔离测试',username:null,department:null,localUserId:null,role:body.token===admin?'system_admin':'user',securityVersion:1,authTime:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+600,amr:['test'],csrfToken:csrf}:{active:false}));return;
  }
  if(req.url==='/api/unified/applications'){res.end(JSON.stringify({applications:[{id:'service-manager',name:'服务管理'},{id:'resource-manager',name:'资源管理'}]}));return;}
  res.statusCode=404;res.end('{}');
});
async function listen(server){server.listen(0,'127.0.0.1');await once(server,'listening');return `http://127.0.0.1:${server.address().port}`;}
try{
  identityOrigin=await listen(identity);
  const reserved=createServer(),origin=await listen(reserved);await new Promise(resolve=>reserved.close(resolve));
  // 白名单环境：不继承本机数据库、受控部署、业务上游或生产身份凭据。
  const env={};for(const key of ['PATH','Path','SystemRoot','SYSTEMROOT','TEMP','TMP'])if(process.env[key])env[key]=process.env[key];
  Object.assign(env,{NODE_ENV:'test',HOST:'127.0.0.1',PORT:new URL(origin).port,DESKTOP_ORIGIN:origin,DESKTOP_RUNTIME_DIR:runtime,IDENTITY_ISSUER:identityOrigin,IDENTITY_CLIENT_ID:'desktop-one',IDENTITY_CLIENT_SECRET:'isolated-test-client-secret-00000000',SERVICE_ENVIRONMENT:'local'});
  child=spawn(process.execPath,['dist/server/main.mjs'],{cwd:root,env,stdio:['ignore','pipe','pipe'],windowsHide:true});
  child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>output+=data);
  child.on('error',error=>output+=error.message);
  let ready=false;
  for(let i=0;i<100;i++){
    if(child.exitCode!==null)throw Error('桌面测试进程提前退出：'+output);
    try{ready=(await fetch(origin+'/api/health',{signal:AbortSignal.timeout(500)})).ok;}catch{}
    if(ready)break;await delay(100);
  }
  assert.ok(ready,'桌面测试进程未就绪：'+output);
  async function request(path,{body,token=admin,csrfToken=csrf,status=200}={}){
    const response=await fetch(origin+'/api/service-registry'+path,{method:body===undefined?'GET':'POST',signal:AbortSignal.timeout(10000),headers:{origin,'content-type':'application/json',...(token?{cookie:'mg_desktop_token='+token}:{}),'x-csrf-token':csrfToken},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));return data;
  }
  const serviceId='resource-manager.api';
  const current=async()=>{const catalog=await request('');return {catalog,active:catalog.items.find(item=>item.manifest.serviceId===serviceId&&item.active)};};
  const initial=await current();assert.equal(initial.catalog.storage.backend,'json');assert.equal(initial.active.manifest.version,'1.1.0');
  const registration=JSON.parse(await readFile(resolve(root,'../mg-resource-one/services/registration.json'),'utf8'));
  registration.manifest.version='1.2.0';registration.contract.info.version='1.2.0';registration.contract.components.schemas.MetadataInput.properties.owner.maxLength=200;
  await request('/publications',{body:registration,status:201});
  await request('/activation',{body:{serviceId,version:'1.2.0',expectedRevision:initial.active.activeRevision}});
  const wide=await current();assert.equal(wide.active.manifest.version,'1.2.0');assert.equal(wide.active.activeRevision,initial.active.activeRevision+1);
  const rollback={serviceId,version:'1.1.0',expectedRevision:wide.active.activeRevision};
  const rejected=await request('/activation',{body:rollback,status:409});assert.match(rejected.message,/契约差异/);
  const unchanged=await current();assert.equal(unchanged.active.activeRevision,wide.active.activeRevision);assert.equal(unchanged.active.manifest.version,'1.2.0');assert.deepEqual(unchanged.catalog.audit,wide.catalog.audit);
  await request('/activation',{body:{...rollback,allowContractChange:true},token:reader,status:403});
  await request('/activation',{body:{...rollback,allowContractChange:true},csrfToken:'incorrect',status:401});
  await request('',{token:denied,status:401});await request('',{token:'',status:401});
  await request('/activation',{body:{...rollback,expectedRevision:initial.active.activeRevision,allowContractChange:true},status:409});
  await request('/activation',{body:{...rollback,allowContractChange:true}});
  const restored=await current();assert.equal(restored.active.manifest.version,'1.1.0');assert.equal(restored.active.activeRevision,wide.active.activeRevision+1);
  assert.equal(restored.catalog.audit.length,wide.catalog.audit.length+1);
  console.log('HTTP 发布回归通过：兼容切换、收紧拦截、拒绝不写入、明确审阅、管理员权限、CSRF、失效会话和并发修订。身份为替身，存储为临时 JSON。');
}finally{
  if(child&&child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}
  identity.closeAllConnections();await new Promise(resolve=>identity.close(resolve));
  const suffix=relative(resolve(tmpdir()),runtime);assert.ok(suffix&&!suffix.startsWith('..')&&!isAbsolute(suffix)&&suffix.startsWith('mg-contract-http-'));
  await rm(runtime,{recursive:true,force:true});
}
