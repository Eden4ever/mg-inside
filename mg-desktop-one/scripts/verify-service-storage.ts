import test from 'node:test';
import assert from 'node:assert/strict';
import {parseEnv} from 'node:util';
import {randomBytes,createHash} from 'node:crypto';
import {readFile,mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {createServer as createHttpServer} from 'node:http';
import {servicePool,serviceSchemaSql,importServiceState,createPostgresServiceStorage} from '../apps/server/src/service-postgres';
import {withServiceSnapshot} from '../apps/server/src/service-snapshot';
import {createServiceRegistry,validateRegistrySnapshot} from '../apps/server/src/services';
import {canonicalJson} from '../../mg-platform/packages/frontend/services/openapi';
import catalog from '../../mg-platform/packages/frontend/services/catalog.json';
const hash=(value:unknown)=>createHash('sha256').update(canonicalJson(value)).digest('hex');

test('独立 PostgreSQL：迁移、受限账号、多实例并发、环境隔离、快照降级与恢复',async t=>{
 const settings=parseEnv(await readFile('.runtime/local/identity.env','utf8')),url=new URL(settings.DATABASE_URL);
 assert(['127.0.0.1','localhost'].includes(url.hostname));assert.equal(url.port,'15439');assert.equal(url.pathname,'/identity_test');
 url.searchParams.delete('schema');
 const name=`services_verify_${process.pid}_${Date.now()}`,role=name+'_app',password=randomBytes(24).toString('hex');
 assert.match(name,/^services_verify_\d+_\d+$/);assert.match(role,/^services_verify_\d+_\d+_app$/);
 const system=servicePool(url.href);await system.query(`CREATE DATABASE "${name}"`);
 const dbUrl=new URL(url);dbUrl.pathname='/'+name;const admin=servicePool(dbUrl.href);
 const dir=await mkdtemp(join(tmpdir(),'mg-service-storage-'));assert.equal(resolve(dir,'..'),resolve(tmpdir()));
 const closers:Array<()=>Promise<void>>=[];
 t.after(async()=>{
  try{for(const close of closers)await close();await admin.end();await system.query(`DROP DATABASE "${name}" WITH (FORCE)`);await system.query(`DROP ROLE IF EXISTS "${role}"`);}
  finally{await system.end();await rm(dir,{recursive:true,force:true});}
 });
 await system.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE`);
 await admin.query(serviceSchemaSql);
 await admin.query(`REVOKE ALL ON DATABASE "${name}" FROM PUBLIC; GRANT CONNECT ON DATABASE "${name}" TO "${role}";
  REVOKE CREATE ON SCHEMA public FROM PUBLIC; GRANT USAGE ON SCHEMA public TO "${role}";
  GRANT SELECT ON ALL TABLES IN SCHEMA public TO "${role}";
  GRANT INSERT ON service_publications,service_bindings,service_audit,service_activity TO "${role}";
  GRANT INSERT,UPDATE ON service_version_lifecycles TO "${role}";
  GRANT UPDATE ON service_bindings,service_environments TO "${role}";
  GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO "${role}";`);
 const apps=new Set(catalog.map(m=>m.appId));
 await admin.query('CREATE TABLE desktop_applications(id text PRIMARY KEY,runtime_ready boolean NOT NULL)');
 await admin.query('INSERT INTO desktop_applications(id,runtime_ready) SELECT unnest($1::text[]),true',[[...apps]]);
 await admin.query(`GRANT SELECT ON desktop_applications TO "${role}"`);
 const legacy=createServiceRegistry(join(dir,'legacy'),apps);await legacy.initialize();
 const publication=legacy.list(apps).find(p=>p.manifest.appId==='resource-manager')!;
 const contract=structuredClone(publication.contract!);contract.info.version='1.2.0';(contract.info as any)['x-null']=null;
 await legacy.publish({...publication.manifest,version:'1.2.0'},'migration-test',contract);
 await legacy.activate('identity.api',null,'migration-test',{expectedRevision:0});
 await legacy.record({serviceId:'files.api',operationId:'list',actor:'migration-test',status:200,durationMs:2});
 const initial=validateRegistrySnapshot(JSON.parse(await readFile(join(dir,'legacy/registry.json'),'utf8')),apps);
 const digest=hash(initial);
 assert.equal((await importServiceState(admin,'production',initial,digest)).duplicate,false);
 assert.equal((await importServiceState(admin,'production',initial,digest)).duplicate,true);
 await assert.rejects(importServiceState(admin,'production',initial,'0'.repeat(64)),/拒绝覆盖/);
 await importServiceState(admin,'testing',initial,digest);
 const runtimeUrl=new URL(dbUrl);runtimeUrl.username=role;runtimeUrl.password=password;
 function make(environment:string,cache:string){
  const pool=servicePool(runtimeUrl.href),database=createPostgresServiceStorage(pool,environment),validated=new Set<string>(),snapshot=withServiceSnapshot(database,join(dir,cache),environment,state=>validateRegistrySnapshot(state,apps,validated));
  const store=createServiceRegistry(join(dir,cache),apps,snapshot.storage);closers.push(()=>store.close());return {pool,store,snapshot};
 }
 const one=make('production','one'),two=make('production','two'),testing=make('testing','testing');
 await one.store.initialize();await two.store.initialize();await testing.store.initialize();
 const migrated=await createPostgresServiceStorage(admin,'production').read();assert.equal(hash(migrated),digest);
 assert.equal(one.store.list(apps).find(p=>p.manifest.serviceId==='identity.api')?.active,false);
 await assert.rejects(one.pool.query('CREATE TABLE forbidden(id int)'),/permission denied/);
 await assert.rejects(one.pool.query('UPDATE service_publications SET actor=actor'),/permission denied/);
 await assert.rejects(one.pool.query('DELETE FROM service_bindings'),/permission denied/);
 const results=await Promise.allSettled([one,two].map(item=>item.store.activate(publication.manifest.serviceId,'1.2.0','concurrent',{expectedRevision:0})));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
 await one.store.refresh();await two.store.refresh();
 assert.equal(one.store.revision(publication.manifest.serviceId),1);assert.equal(two.store.revision(publication.manifest.serviceId),1);
 assert.equal(testing.store.invoke(publication.manifest.serviceId,'overview','GET',{}).manifest.version,'1.1.0');
 const concurrent={...publication.manifest,version:'1.3.0'},nextContract=structuredClone(contract);nextContract.info.version='1.3.0';
 const duplicates=await Promise.all([one.store.publish(concurrent,'one',nextContract),two.store.publish(concurrent,'two',nextContract)]);
 assert.equal(duplicates.filter((r:any)=>r.duplicate).length,1);
 await assert.rejects(two.store.publish({...concurrent,name:'不得覆盖'},'two',nextContract),/内容不同/);
 await Promise.all(Array.from({length:12},(_,i)=>(i%2?one:two).store.record({serviceId:'files.api',operationId:'list',actor:'concurrent',status:200,durationMs:i})));
 await one.store.refresh();assert.equal(one.store.activity(apps).length,13);
 await testing.store.refresh();assert.equal(testing.store.activity(apps).length,1);
 // 使用已构建的真实桌面 HTTP 入口与本地身份/文件服务，验证降级不绕过授权。
 const portProbe=createServer();portProbe.listen(0,'127.0.0.1');await once(portProbe,'listening');const port=(portProbe.address() as any).port;await new Promise<void>(r=>portProbe.close(()=>r()));
 const local=parseEnv(await readFile('.runtime/local/desktop.env','utf8')),origin=`http://127.0.0.1:${port}`;
 const processServer=spawn(process.execPath,['dist/server/main.mjs'],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,...local,NODE_ENV:'test',PORT:String(port),HOST:'127.0.0.1',DESKTOP_ORIGIN:origin,DESKTOP_RUNTIME_DIR:join(dir,'http'),SERVICE_DATABASE_URL:runtimeUrl.href,SERVICE_ENVIRONMENT:'production'}});
 let processOutput='';for(const stream of [processServer.stdout,processServer.stderr])stream.on('data',chunk=>{processOutput=(processOutput+chunk).slice(-4000);});
 const serverExited=once(processServer,'exit');closers.unshift(async()=>{if(processServer.exitCode===null&&processServer.signalCode===null)processServer.kill();await serverExited;});
 let healthy=false;for(let i=0;i<80;i++){try{healthy=(await fetch(origin+'/api/health')).ok;if(healthy)break;}catch{}await new Promise(r=>setTimeout(r,250));}assert(healthy,`隔离桌面进程须启动成功：${processOutput}`);
 const account=JSON.parse(await readFile('.runtime/local/account.json','utf8')),issuer='http://127.0.0.1:14200';
 const login=await fetch(issuer+'/api/auth/login',{method:'POST',headers:{origin:issuer,'content-type':'application/json'},body:JSON.stringify(account)});assert.equal(login.status,200);
 const cookie=login.headers.getSetCookie().find(c=>c.startsWith('mg_identity_session='))?.split(';')[0];assert(cookie);
 const profile=await login.json(),headers={cookie:'mg_desktop_token='+cookie.slice(cookie.indexOf('=')+1)};
 closers.unshift(async()=>{await fetch(issuer+'/api/auth/logout',{method:'POST',headers:{cookie,origin:issuer,'x-csrf-token':profile.csrfToken,'content-type':'application/json'},body:'{}'});});
 assert.equal((await fetch(origin+'/api/service-registry')).status,401);
 const httpCatalog=await fetch(origin+'/api/service-registry',{headers});assert.equal(httpCatalog.status,200);assert.equal((await httpCatalog.json()).storage.environment,'production');
 const httpFiles=await fetch(origin+'/api/services/invoke/files.api/list',{headers});assert.equal(httpFiles.status,200);assert.equal(httpFiles.headers.get('x-service-catalog'),'current');await httpFiles.arrayBuffer();
 // 等待响应后的异步调用记录落盘。
 for(let i=0;i<30;i++){await one.store.refresh();if(one.store.activity(apps).length===14)break;await new Promise(r=>setTimeout(r,100));}assert.equal(one.store.activity(apps).length,14);
 // 实际撤销受限账号连接并终止它在本独立测试库中的连接；不影响本地身份库。
 await admin.query(`REVOKE CONNECT ON DATABASE "${name}" FROM "${role}"`);
 await system.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND usename=$2',[name,role]);
 await assert.rejects(one.store.refresh(),/暂不可用/);
 await one.store.refresh({allowCache:true});assert.equal(one.snapshot.status().stale,true);
 assert.equal(one.store.invoke(publication.manifest.serviceId,'overview','GET',{}).manifest.version,'1.2.0');
 await assert.rejects(one.store.activate(publication.manifest.serviceId,null,'offline',{expectedRevision:1}),/暂不可用/);
 assert.equal((await fetch(origin+'/api/service-registry',{headers})).status,503);
 const cachedFiles=await fetch(origin+'/api/services/invoke/files.api/list',{headers});assert.equal(cachedFiles.status,200);assert.equal(cachedFiles.headers.get('x-service-catalog'),'cached');await cachedFiles.arrayBuffer();
 assert.equal((await fetch(origin+'/api/services/invoke/files.api/list')).status,401);
 assert.equal((await fetch(origin+'/api/services/invoke/files.api/list',{method:'POST',headers})).status,405);
 const restart=make('production','one');await restart.store.initialize();assert.equal(restart.snapshot.status().stale,true);
 assert.equal(restart.store.invoke('files.api','list','GET',{}).path,'/entries');
 const empty=make('production','empty');await assert.rejects(empty.store.initialize(),/暂不可用/);
 const tampered=make('production','tampered');await mkdir(join(dir,'tampered'));await writeFile(join(dir,'tampered/postgres-snapshot-production.json'),JSON.stringify({schemaVersion:1,environment:'testing',state:initial,digest}));await assert.rejects(tampered.store.initialize(),/暂不可用/);
 await admin.query(`GRANT CONNECT ON DATABASE "${name}" TO "${role}"`);await one.store.refresh();assert.equal(one.snapshot.status().stale,false);
 await one.store.activate(publication.manifest.serviceId,'1.1.0','recover',{expectedRevision:1,allowContractChange:true});await two.store.refresh();
 assert.equal(two.store.invoke(publication.manifest.serviceId,'overview','GET',{}).manifest.version,'1.1.0');
 // 数据库导出后，原 JSON 引擎仍可恢复迁移后的新版本/修订/活动，不丢迁移后写入。
 const exported=await createPostgresServiceStorage(admin,'production').read();
 await mkdir(join(dir,'rollback'));await writeFile(join(dir,'rollback/registry.json'),JSON.stringify(exported));
 const rollback=createServiceRegistry(join(dir,'rollback'),apps);await rollback.initialize();assert.equal(rollback.revision(publication.manifest.serviceId),2);assert.equal(rollback.activity(apps).length,14);assert.equal(rollback.list(apps).length,8);

 // 环境绑定使用两个受控 HTTP 替身证明实际路由去向；上方已覆盖真实 Files/身份链路。
 async function endpoint(label:string){const server=createHttpServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({source:label,path:req.url,authenticated:typeof req.headers.authorization==='string'}));});server.listen(0,'127.0.0.1');await once(server,'listening');closers.push(async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));});return `http://127.0.0.1:${(server.address() as any).port}/api`;}
 const blue=await endpoint('production-blue'),green=await endpoint('production-green'),testUrl=await endpoint('testing');
 const files=one.store.list(apps).find(p=>p.manifest.serviceId==='files.api')!;
 const deployed=(environment:string,endpointRef:string,baseUrl:string)=>({environment,endpointRef,name:endpointRef,appId:'files',providerAppId:'files',baseUrl,deploymentId:endpointRef+'-release',artifactDigest:'d'.repeat(64),resourceRef:'isolated-http-test',deployedAt:'2026-09-09T00:00:00Z',services:[{serviceId:'files.api',version:files.manifest.version,manifestDigest:files.digest,contractDigest:files.contractDigest}]});
 const deploymentCatalog={schemaVersion:1,environments:[{id:'production',name:'生产',deployments:[deployed('production','files-blue',blue),deployed('production','files-green',green)]},{id:'testing',name:'测试',deployments:[deployed('testing','files-test',testUrl)]}]};
 const deploymentFile=join(dir,'deployments.json');await writeFile(deploymentFile,JSON.stringify(deploymentCatalog));
 async function boundServer(environment:string){
  const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=(probe.address() as any).port;await new Promise<void>(r=>probe.close(()=>r()));const address=`http://127.0.0.1:${port}`;
  const child=spawn(process.execPath,['dist/server/main.mjs'],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,...local,NODE_ENV:'test',PORT:String(port),HOST:'127.0.0.1',DESKTOP_ORIGIN:address,DESKTOP_RUNTIME_DIR:join(dir,'http-'+environment),SERVICE_DATABASE_URL:runtimeUrl.href,SERVICE_ENVIRONMENT:environment,SERVICE_DEPLOYMENTS_FILE:deploymentFile}}),exited=once(child,'exit');let output='';for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{output=(output+chunk).slice(-4000);});
  closers.unshift(async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill();await exited;});
  let started=false;for(let i=0;i<80;i++){try{started=(await fetch(address+'/api/health')).ok;if(started)break;}catch{}await new Promise(r=>setTimeout(r,250));}assert(started,`环境出口须启动成功：${output}`);return address;
 }
 const productionOrigin=await boundServer('production'),testingOrigin=await boundServer('testing');
 const controlHeaders={...headers,origin:productionOrigin,'content-type':'application/json','x-csrf-token':profile.csrfToken};
 async function catalogFor(environment:string){const response=await fetch(productionOrigin+'/api/service-registry?environment='+environment,{headers});assert.equal(response.status,200);return response.json();}
 async function activateFor(environment:string,endpointRef:string,extra:any={},expected=200){
  const state=await catalogFor(environment),row=state.items.find((p:any)=>p.manifest.serviceId==='files.api'&&p.active),deployment=state.deployments.find((d:any)=>d.endpointRef===endpointRef);
  const response=await fetch(productionOrigin+'/api/service-registry/activation?environment='+environment,{method:'POST',headers:controlHeaders,body:JSON.stringify({serviceId:'files.api',version:files.manifest.version,expectedRevision:row.activeRevision,endpointRef,expectedDeploymentDigest:deployment?.digest,...extra})});assert.equal(response.status,expected);return response.json();
 }
 assert.equal((await fetch(productionOrigin+'/api/services/invoke/files.api/list',{headers})).status,503);
 assert.equal((await fetch(productionOrigin+'/api/service-registry/activation',{method:'POST',headers:controlHeaders,body:'{}'})).status,409);
 assert.equal((await fetch(productionOrigin+'/api/service-registry?environment=unknown',{headers})).status,404);
 await activateFor('production','files-test',{},409);await activateFor('production','files-blue',{upstream:testUrl},409);
 await activateFor('production','files-blue');assert.equal((await activateFor('production','files-blue')).duplicate,true);
 const firstRoute=await fetch(productionOrigin+'/api/services/invoke/files.api/list?environment=testing',{headers});assert.equal(firstRoute.headers.get('x-service-environment'),'production');assert.equal((await firstRoute.json()).source,'production-blue');
 await activateFor('testing','files-test');assert.equal((await (await fetch(testingOrigin+'/api/services/invoke/files.api/list',{headers})).json()).source,'testing');
 assert.equal((await (await fetch(productionOrigin+'/api/services/invoke/files.api/list',{headers})).json()).source,'production-blue');
 const beforeRebind=await catalogFor('production'),oldRevision=beforeRebind.items.find((p:any)=>p.manifest.serviceId==='files.api'&&p.active).activeRevision;
 await activateFor('production','files-green');await activateFor('production','files-blue',{expectedRevision:oldRevision},409);
 assert.equal((await (await fetch(productionOrigin+'/api/services/invoke/files.api/list',{headers})).json()).source,'production-green');
 const beforeDrift=await catalogFor('production'),oldDeployment=beforeDrift.deployments.find((d:any)=>d.endpointRef==='files-green');
 deploymentCatalog.environments[0].deployments[1].artifactDigest='e'.repeat(64);await writeFile(deploymentFile,JSON.stringify(deploymentCatalog));
 assert.equal((await fetch(productionOrigin+'/api/services/invoke/files.api/list',{headers})).status,503);
 await activateFor('production','files-green',{expectedDeploymentDigest:oldDeployment.digest},409);await activateFor('production','files-green');
 assert.equal((await (await fetch(productionOrigin+'/api/services/invoke/files.api/list',{headers})).json()).source,'production-green');
 const finalBindings=await createPostgresServiceStorage(admin,'production').read();assert.equal(finalBindings.bindings?.['files.api'].endpointRef,'files-green');
 assert.equal((await createPostgresServiceStorage(admin,'testing').read()).bindings?.['files.api'].endpointRef,'files-test');
 const incoming=join(dir,'deployment-incoming.json'),registeredBefore=await readFile(deploymentFile,'utf8'),fileDigest=createHash('sha256').update(registeredBefore).digest('hex');
 const invalidCatalog=structuredClone(deploymentCatalog);invalidCatalog.environments[0].deployments=invalidCatalog.environments[0].deployments.filter(d=>d.endpointRef!=='files-green');await writeFile(incoming,JSON.stringify(invalidCatalog));
 const adminArgs=['dist/server/service-storage-admin.mjs','publish-deployments',incoming,deploymentFile,fileDigest],adminOptions={env:{...process.env,SERVICE_DATABASE_URL:dbUrl.href,SERVICE_ENVIRONMENT:'production'},stdio:'pipe' as const};
 assert.throws(()=>execFileSync(process.execPath,adminArgs,adminOptions),'不得撤销正在使用的部署记录');assert.equal(await readFile(deploymentFile,'utf8'),registeredBefore);
 const cleaned=structuredClone(deploymentCatalog);cleaned.environments[0].deployments=cleaned.environments[0].deployments.filter(d=>d.endpointRef!=='files-blue');await writeFile(incoming,JSON.stringify(cleaned));
 const registered=JSON.parse(execFileSync(process.execPath,adminArgs,adminOptions).toString());assert.equal(registered.published,true);
 assert.throws(()=>execFileSync(process.execPath,adminArgs,adminOptions),'旧配置摘要不能覆盖新登记');
 assert.equal((await (await fetch(productionOrigin+'/api/services/invoke/files.api/list',{headers})).json()).source,'production-green');

 // 生命周期全局共享，退役检查和发布切换使用同一个跨环境事务锁。
 await one.store.setLifecycle('files.api','1.1.0','headers-test',{status:'deprecated',reason:'响应头传达迁移计划',retireAfter:'2099-01-01',expectedRevision:0});
 // 管理读取强制更新该实例的快照，随后调用验证真实代理响应头。
 await catalogFor('production');
 const deprecatedCall=await fetch(productionOrigin+'/api/services/invoke/files.api/list',{headers:{...headers,origin:productionOrigin}});assert.equal(deprecatedCall.status,200);assert.equal(deprecatedCall.headers.get('x-service-lifecycle'),'deprecated');assert.equal(deprecatedCall.headers.get('x-service-retire-after'),'2099-01-01');assert.match(deprecatedCall.headers.get('access-control-expose-headers')||'',/X-Service-Lifecycle/);await deprecatedCall.arrayBuffer();
 await one.store.setLifecycle('files.api','1.1.0','headers-test',{status:'published',reason:'恢复测试前维护状态',expectedRevision:1});
 const lifeHeaders={...headers,origin,'content-type':'application/json','x-csrf-token':profile.csrfToken};
 const lifePath=origin+'/api/service-registry/lifecycle?environment=production';
 const payload={serviceId:publication.manifest.serviceId,version:'1.1.0',status:'deprecated',reason:'调用方迁移测试',expectedRevision:0};
 assert.equal((await fetch(lifePath,{method:'POST',headers:{...headers,origin},body:JSON.stringify(payload)})).status,401);
 assert.equal((await fetch(lifePath,{method:'POST',headers:lifeHeaders,body:JSON.stringify(payload)})).status,200);
 await one.store.refresh();await testing.store.refresh();
 assert.equal(testing.store.list(apps).find(p=>p.manifest.serviceId===payload.serviceId&&p.manifest.version==='1.1.0')?.lifecycle.status,'deprecated');
 assert(testing.store.audit().some(e=>e.action==='lifecycle'&&e.version==='1.1.0'),'其他环境能查看全局生命周期变更');
 await one.store.activate(payload.serviceId,null,'retire-test',{expectedRevision:one.store.revision(payload.serviceId)});
 const retire={...payload,status:'retired',reason:'所有环境迁移后退役',expectedRevision:1};
 const blocked=await fetch(lifePath,{method:'POST',headers:lifeHeaders,body:JSON.stringify(retire)});assert.equal(blocked.status,409);assert.match((await blocked.json()).message,/testing/);
 await testing.store.activate(payload.serviceId,null,'retire-test',{expectedRevision:testing.store.revision(payload.serviceId)});
 assert.equal((await fetch(lifePath,{method:'POST',headers:lifeHeaders,body:JSON.stringify(retire)})).status,200);
 const {lifecycles:ignoredLifecycles,...legacySnapshot}=initial;
 await assert.rejects(importServiceState(admin,'recovery-stale',legacySnapshot,hash(legacySnapshot)),/拒绝旧快照恢复/);
 await two.store.refresh();assert.equal(two.store.list(apps).find(p=>p.manifest.serviceId===payload.serviceId&&p.manifest.version==='1.1.0')?.lifecycle.status,'retired');
 await assert.rejects(two.store.activate(payload.serviceId,'1.1.0','old-client',{expectedRevision:two.store.revision(payload.serviceId)}),/已退役/);
 const race=await Promise.allSettled([
  one.store.activate(payload.serviceId,'1.3.0','activate-race',{expectedRevision:two.store.revision(payload.serviceId),allowContractChange:true}),
  two.store.setLifecycle(payload.serviceId,'1.3.0','retire-race',{status:'retired',reason:'取消未发布版本',expectedRevision:0}),
 ]);
 assert.equal(race.filter(r=>r.status==='fulfilled').length,1);await one.store.refresh();
 const raced=one.store.list(apps).find(p=>p.manifest.serviceId===payload.serviceId&&p.manifest.version==='1.3.0')!;
 assert(raced.active&&raced.lifecycle.status==='published'||!raced.active&&raced.lifecycle.status==='retired');
});
