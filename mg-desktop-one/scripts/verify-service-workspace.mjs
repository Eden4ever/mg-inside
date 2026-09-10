import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,readdir} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {once} from 'node:events';
import pg from 'pg';

const root=resolve(import.meta.dirname,'..'),kernel=resolve(root,'../mg-platform-kernel');
const work=await mkdtemp(join(root,'.runtime/service-workspace-'));
const jar=process.env.TEST_KERNEL_JAR||join(kernel,'.runtime/service-workspace-target/mg-platform-kernel-0.1.0-SNAPSHOT.jar');
const jdk=(await readdir(join(kernel,'.runtime/java-tools'))).find(n=>n.startsWith('jdk-25'));
const java=join(kernel,'.runtime/java-tools',jdk,'bin/java.exe');
const local=parseEnv(await readFile(join(root,'.runtime/local/identity.env'),'utf8'));
const connection=new URL(local.DATABASE_URL);assert.equal(connection.hostname,'127.0.0.1');assert.equal(connection.port,'15439');connection.search='';connection.pathname='/postgres';
const admin=new pg.Client({connectionString:connection.href});await admin.connect();
const database='service_verify_'+Date.now();await admin.query('CREATE DATABASE '+database);connection.pathname='/'+database;
let db=new pg.Client({connectionString:connection.href});await db.connect();
let running;const granted=new Set(['desktop-one','service-manager','files']),csrf='service-fixture-csrf';
const mock=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname;
 if(path==='/provider/files/entries/stream') {res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: first\n\n');const timer=setInterval(()=>res.write('data: next\n\n'),100);res.on('close',()=>clearInterval(timer));return;}
 if(path==='/provider/files/entries/error'){res.writeHead(503,{'content-type':'application/json'});res.end('{"error":true}');return;}
 if(path==='/provider/files/entries/blob'){const content=Buffer.alloc(8192,7);if(req.headers.range){res.writeHead(206,{'content-type':'application/octet-stream','content-range':'bytes 0-99/8192'});res.end(content.subarray(0,100));}else{res.writeHead(200,{'content-type':'application/octet-stream'});res.end(content);}return;}
 const chunks=[];for await(const chunk of req)chunks.push(chunk);const raw=Buffer.concat(chunks).toString(),input=raw&&req.headers['content-type']?.includes('json')?JSON.parse(raw):{};
 const send=value=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value));};
 if(path==='/token')return send({access_token:'fixture-machine',expires_in:60});
 if(path==='/api/unified/introspect')return send(granted.has(input.app_id)?{active:true,iss:mockOrigin,aud:input.app_id,sub:'fixture-user',sid:'fixture-session',role:'system_admin',name:'接口验收',username:'fixture',department:null,localUserId:null,authTime:1700000000,amr:['pwd'],exp:2000000000,csrfToken:csrf,securityVersion:1}:{active:false});
 if(path==='/api/unified/applications')return send({applications:[]});
 if(path.endsWith('/auth/me'))return send({user:{role:'system_admin'}});
 return send({ok:true});
});
mock.listen(0,'127.0.0.1');await once(mock,'listening');const mockOrigin='http://127.0.0.1:'+mock.address().port;
const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));const origin='http://127.0.0.1:'+port;
const env={...process.env,NODE_ENV:'test',PORT:String(port),DESKTOP_ORIGIN:origin,DESKTOP_RUNTIME_DIR:join(work,'runtime'),SERVICE_DATABASE_URL:connection.href,SERVICE_ENVIRONMENT:'local',SERVICE_DEPLOYMENTS_FILE:'',IDENTITY_ISSUER:mockOrigin,IDENTITY_CLIENT_ID:'desktop-one',IDENTITY_CLIENT_SECRET:'fixture-secret'.repeat(4),DESKTOP_FLOW_KEY:'34'.repeat(32)};
function child(args){const p=spawn(java,args,{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});p.output='';p.stdout.on('data',d=>p.output=(p.output+d).slice(-8000));p.stderr.on('data',d=>p.output=(p.output+d).slice(-8000));p.done=new Promise((resolve,reject)=>{p.on('error',reject);p.on('close',resolve);});return p;}
async function run(args){const p=child(args);assert.equal(await p.done,0,p.output);}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function request(path,status=200,options={}){const response=await fetch(origin+path,{...options,headers:{origin,cookie:'mg_desktop_token='+'A'.repeat(43),'content-type':'application/json','x-csrf-token':csrf,...options.headers},signal:options.signal||AbortSignal.timeout(15000)});assert.equal(response.status,status,await response.clone().text());return response;}
const post=(path,value,status=200,headers)=>request(path,status,{method:'POST',body:JSON.stringify(value),headers});
try{
 const rows=JSON.parse(await readFile(join(kernel,'src/test/resources/application-fixture.json'),'utf8'));for(const row of rows){row.entryUrl=mockOrigin+'/apps/'+row.id;row.upstream=mockOrigin+'/provider/'+row.id;if(row.id==='files')row.kind='internal';}
 const apps=join(work,'applications.json');await writeFile(apps,JSON.stringify({schemaVersion:1,applications:rows}));await run(['-jar',jar,'desktop-applications','migrate',apps]);
 await db.query(await readFile(join(kernel,'src/main/resources/db/migration/V1__service_registry.sql'),'utf8'));await db.query(await readFile(join(kernel,'src/main/resources/db/migration/V4__service_workspace.sql'),'utf8'));await db.query("INSERT INTO service_environments(name,imported_digest) VALUES('local','fixture')");
 running=child(['-jar',jar]);let ready=false;for(let i=0;i<200;i++){if(running.exitCode!==null)throw Error(running.output);try{ready=(await fetch(origin+'/api/health')).ok;}catch{}if(ready)break;await pause(100);}assert(ready,running.output);
 const manifest={schemaVersion:1,serviceId:'files.observation',appId:'files',name:'接口验收',version:'1.0.0',description:'隔离验收',operations:[{operationId:'list',path:'/entries',method:'GET',summary:'读取',effect:'read'},...['blob','error','stream'].map(name=>({operationId:name,path:'/entries/'+name,method:'GET',summary:name,effect:'read'}))]};
 await post('/api/service-registry/publications',manifest,201);await post('/api/service-registry/publications',{...manifest,name:'覆盖'},409);
 await post('/api/service-registry/activation',{serviceId:manifest.serviceId,version:'1.0.0',expectedRevision:0});
 let ws=await (await request('/api/service-registry/workspace')).json();assert.equal(ws.revision,0);
 const metadata={kind:'service',serviceId:manifest.serviceId,category:'data',owner:'验收维护人',expectedRevision:0};
 await post('/api/service-registry/workspace',metadata,401,{'x-csrf-token':'wrong'});await post('/api/service-registry/workspace',metadata);await post('/api/service-registry/workspace',metadata,409);
 await post('/api/service-registry/workspace',{kind:'tag',id:'',name:'读取接口',color:'success',enabled:true,references:[{serviceId:manifest.serviceId,operationId:'list'}],expectedRevision:1});
 ws=await (await request('/api/service-registry/workspace')).json();assert.equal(ws.revision,2);assert.equal(ws.tags[0].references[0].operationId,'list');assert.equal(ws.events.length,2);
 const before=new Date(Date.now()-3600000).toISOString();await request('/api/services/invoke/files.observation/list');assert.equal((await (await request('/api/services/invoke/files.observation/blob')).arrayBuffer()).byteLength,8192);assert.equal((await (await request('/api/services/invoke/files.observation/blob',206,{headers:{range:'bytes=0-99'}})).arrayBuffer()).byteLength,100);await request('/api/services/invoke/files.observation/error',503);
 const cancel=new AbortController();const stream=await fetch(origin+'/api/services/invoke/files.observation/stream',{headers:{cookie:'mg_desktop_token='+'A'.repeat(43)},signal:cancel.signal});assert.equal(stream.status,200);const first=await stream.body.getReader().read();assert.match(new TextDecoder().decode(first.value),/data: first/);cancel.abort();
 let metrics;for(let i=0;i<60;i++){metrics=await (await request('/api/service-registry/insights?from='+encodeURIComponent(before))).json();if(metrics.total>=5)break;await pause(100);}await writeFile(join(work,'metrics.json'),JSON.stringify(metrics,null,2));assert.equal(metrics.total,5,'五次调用已落盘');assert.equal(metrics.summary.failed,1,'提供方失败次数');assert.equal(metrics.summary.cancelled,1,'SSE取消次数');assert.equal(metrics.groups.find(g=>g.operationId==='blob').responseBytes,8292,'真实响应字节');assert.equal(metrics.logs.find(l=>l.operationId==='error').status,503);
 await db.query("INSERT INTO service_activity(environment,id,event) SELECT 'local','history-'||n,jsonb_build_object('id','history-'||n,'serviceId','files.observation','operationId','list','at',$1::text,'durationMs',1,'status',200) FROM generate_series(1,350) n",[new Date().toISOString()]);
 metrics=await (await request('/api/service-registry/insights?from='+encodeURIComponent(before)+'&page=7')).json();assert.equal(metrics.total,355);assert.equal(metrics.logs.length,50);assert.equal(metrics.summary.unknown,350);assert.equal(metrics.coverage,'persisted');assert.equal(metrics.summary.successRate,60);
 granted.delete('files');assert.equal((await (await request('/api/service-registry/insights')).json()).total,0);assert.equal((await (await request('/api/service-registry/workspace')).json()).tags[0].references.length,0);
 const result={passed:true,checks:['持久化分类标签与修订冲突','CSRF及提供应用授权','不可变版本','二进制8192字节与Range100字节','503错误状态','SSE首帧与取消','355条历史统计与分页','旧日志未知结果'],identityAndProvider:'隔离HTTP替身',productionChanged:false};await writeFile(join(work,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,evidence:join(work,'result.json')},null,2));
}finally{if(running&&running.exitCode===null){running.kill();await running.done;}mock.closeAllConnections();await new Promise(r=>mock.close(r));await db.end();await admin.query('DROP DATABASE '+database);await admin.end();}
