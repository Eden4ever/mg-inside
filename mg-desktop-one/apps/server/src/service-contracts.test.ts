import {readFile,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {type Server} from 'node:http';
import {it,expect} from 'vitest';
import {validateContract,responseValidator} from './service-contracts';
import {createServiceRegistry,validateManifest} from './services';
import {compareContractVersions} from '../../../../mg-platform/packages/frontend/services/openapi';
import {FilesStore} from '../../../../mg-files-one/server/store';
import {createFilesServer} from '../../../../mg-files-one/server/http';
import {ResourceStore} from '../../../../mg-resource-one/server/store';
import {createResourceServer} from '../../../../mg-resource-one/server/http';
const load=async(app:string)=>JSON.parse(await readFile(`../${app}/services/registration.json`,'utf8'));
const apps=new Set(['resource-manager','files','office-one','expert-database','token-one','identity']);
async function listen(server:Server){await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));return `http://127.0.0.1:${(server.address() as any).port}`;}
async function close(server:Server){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
it('六份实际契约结构及 Schema 通过，拒绝文档、归属、操作、路径参数和远程引用错误',async()=>{
 for(const app of ['mg-resource-one','mg-files-one','mg-office-one','mg-expert-database','mg-token-one/mg-gateway','mg-auth-one-identity']){const {manifest,contract}=await load(app);expect(validateContract(contract,manifest).info.version).toBe(manifest.version);}
 const {manifest,contract}=await load('mg-resource-one');
 for(const mutate of [
  (d:any)=>d.info.version='7.0.0', (d:any)=>d['x-app-id']='files',
  (d:any)=>d.paths['/overview'].get.responses={'200':{}},
  (d:any)=>d.paths['/overview'].get.operationId='unknown',
  (d:any)=>delete d.paths['/resources/{id}/refresh'].post.parameters,
  (d:any)=>d.components.schemas.Bad={type:'invalid-type'},
  (d:any)=>d.components.schemas.Bad={$ref:'https://example.com/remote.json'},
  (d:any)=>d.components.schemas.Bad={$ref:'file:///etc/passwd'},
  (d:any)=>d.components.schemas.Bad={$ref:'#/components/schemas/Absent'},
  (d:any)=>d.servers=[{url:'http://127.0.0.1:22'}],
  (d:any)=>d.info.description='x'.repeat(513*1024)
 ]){const changed=structuredClone(contract);mutate(changed);expect(()=>validateContract(changed,manifest)).toThrow();}
});
it('契约与版本不可分割、键序不影响重试，修改同版本契约及磁盘篡改均拒绝',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mg-contract-'));try{
  const {manifest,contract}=await load('mg-resource-one');const store=createServiceRegistry(dir,apps);await store.initialize();
  const result=await store.publish(manifest,'admin',contract);expect(result.contractDigest).toMatch(/^[a-f0-9]{64}$/);
  expect((await store.publish(manifest,'admin',Object.fromEntries(Object.entries(contract).reverse()))).digest).toBe(result.digest);
  await expect(store.publish(manifest,'admin')).rejects.toThrow('内容不同');
  const changed=structuredClone(contract);changed.info.description='不同文档';await expect(store.publish(manifest,'admin',changed)).rejects.toThrow('内容不同');
  const restored=createServiceRegistry(dir,apps);await restored.initialize();expect(restored.list(new Set(['files'])).some(p=>p.manifest.appId==='resource-manager')).toBe(false);
  const path=join(dir,'registry.json'),saved=JSON.parse(await readFile(path,'utf8'));saved.publications.find((p:any)=>p.contract).contract.info.description='已篡改';await writeFile(path,JSON.stringify(saved));
  await expect(createServiceRegistry(dir,apps).initialize()).rejects.toThrow('摘要');
 }finally{await rm(dir,{recursive:true,force:true});}
});
it('新安装包含六份契约，升级保留既有版本与停用决定',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mg-contract-bootstrap-'));try{
  const fresh=createServiceRegistry(dir,apps);await fresh.initialize();expect(fresh.list(apps).filter(p=>p.contract)).toHaveLength(6);
  const {manifest}=await load('mg-resource-one');const legacy=validateManifest({...manifest,version:'1.0.0'},apps);
  const saved={schemaVersion:1,publications:[{manifest:legacy,digest:createHash('sha256').update(JSON.stringify(legacy)).digest('hex'),at:new Date().toISOString(),actor:'legacy'}],active:{[legacy.serviceId]:null},audit:[],activity:[]};
  await writeFile(join(dir,'registry.json'),JSON.stringify(saved));const upgraded=createServiceRegistry(dir,apps);await upgraded.initialize();
  const resources=upgraded.list(new Set(['resource-manager']));expect(resources).toHaveLength(1);expect(resources[0]?.manifest.version).toBe('1.0.0');expect(resources[0]?.active).toBe(false);expect(resources[0]?.contract).toBeUndefined();
 }finally{await rm(dir,{recursive:true,force:true});}
});
it('发现引用的数据结构变化、忽略说明更新；启用结构变化和移除契约必须明确确认',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mg-contract-diff-'));try{
  const {manifest,contract}=await load('mg-resource-one');const after=structuredClone(contract);after.components.schemas.MetadataInput.required.push('newRequired');after.components.schemas.MetadataInput.properties.newRequired={type:'string'};
  expect(compareContractVersions(contract,after,manifest).find(c=>c.operationId==='metadata'&&c.description.includes('请求正文'))?.requiresReview).toBe(true);
  const descriptions=structuredClone(contract);descriptions.components.schemas.MetadataInput.description='新说明';expect(compareContractVersions(contract,descriptions,manifest)).toHaveLength(0);
  const fieldBefore=structuredClone(contract),fieldAfter=structuredClone(contract);fieldBefore.components.schemas.MetadataInput.properties.title={type:'string'};fieldAfter.components.schemas.MetadataInput.properties.title={type:'number'};
  expect(compareContractVersions(fieldBefore,fieldAfter,manifest).some(c=>c.operationId==='metadata'&&c.requiresReview)).toBe(true);
  const auth=structuredClone(contract);auth.components.securitySchemes.unifiedSession={type:'apiKey',in:'header',name:'X-API-Key'};
  expect(compareContractVersions(contract,auth,manifest).some(c=>c.description.includes('认证要求')&&c.requiresReview)).toBe(true);
  const store=createServiceRegistry(dir,apps);await store.initialize();await store.publish(manifest,'admin',contract);await store.activate(manifest.serviceId,manifest.version,'admin',{expectedRevision:0});
  after.info.version='1.2.0';const next={...manifest,version:'1.2.0'};await store.publish(next,'admin',after);
  await expect(store.activate(next.serviceId,next.version,'admin',{expectedRevision:store.revision(manifest.serviceId)})).rejects.toThrow('契约差异');
  await store.activate(next.serviceId,next.version,'admin',{expectedRevision:store.revision(manifest.serviceId),allowContractChange:true});
  await store.publish({...manifest,version:'1.0.0'},'admin');
  await expect(store.activate(next.serviceId,'1.0.0','admin',{expectedRevision:store.revision(manifest.serviceId)})).rejects.toThrow('契约差异');
 }finally{await rm(dir,{recursive:true,force:true});}
});
it('结构兼容可发布，收紧请求仍拦截，拒绝时版本与修订保持不变',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mg-contract-direction-'));try{
  const {manifest,contract}=await load('mg-resource-one');const store=createServiceRegistry(dir,apps);await store.initialize();
  const wide=structuredClone(contract);wide.info.version='1.2.0';wide.components.schemas.MetadataInput.properties.owner.maxLength=200;
  await store.publish({...manifest,version:'1.2.0'},'test',wide);
  await store.activate(manifest.serviceId,'1.2.0','test',{expectedRevision:store.revision(manifest.serviceId)});
  const revision=store.revision(manifest.serviceId);
  await expect(store.activate(manifest.serviceId,'1.1.0','test',{expectedRevision:revision})).rejects.toThrow('契约差异');
  expect(store.revision(manifest.serviceId)).toBe(revision);expect(store.resolve('resource-manager','GET','/overview').manifest.version).toBe('1.2.0');
  await store.activate(manifest.serviceId,'1.1.0','test',{expectedRevision:revision,allowContractChange:true});
  expect(store.resolve('resource-manager','GET','/overview').manifest.version).toBe('1.1.0');
 }finally{await rm(dir,{recursive:true,force:true});}
});
it('资源真实 HTTP 查询、备注修改、采集结果和错误响应匹配契约',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mg-resource-contract-'));let server:Server|undefined;
 try{
  const {manifest,contract}=await load('mg-resource-one');const doc=validateContract(contract,manifest);
  const id='11111111-1111-4111-8111-111111111111';const path=join(dir,'config.json');
  await writeFile(path,JSON.stringify({pools:[{id:'prod',name:'生产',environment:'production',description:'契约测试'}],resources:[{id,name:'测试主机',host:'127.0.0.1',poolId:'prod',credential:'do-not-expose',provider:'test',cloudProduct:null,region:null,instanceId:null,deployments:[]}]}));
  const store=new ResourceStore(dir,dir,async()=>({schemaVersion:1,collectedAt:new Date().toISOString(),hostname:'test',system:'test',cpuCount:1,loadAverage:[0,0,0],memoryTotal:1024,memoryAvailable:512,diskTotal:2048,diskFree:1024,dockerAvailable:false,containers:[],services:[],desktopRelease:null,expertRelease:null}));await store.initialize(path);
  server=createResourceServer(store,{introspect:async()=>({sub:'admin',csrfToken:'csrf'}) as any});const origin=await listen(server);
  async function call(opid:string,path:string,method='GET',body?:unknown,status=200){const response=await fetch(origin+'/api'+path,{method,headers:{authorization:'Bearer '+ 't'.repeat(43),'x-csrf-token':'csrf','content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});expect(response.status).toBe(status);const data=await response.json();const validate=responseValidator(doc,opid,status);expect(validate(data),JSON.stringify(validate.errors)).toBe(true);return data;}
  const overview=await call('overview','/overview');expect(overview.resources[0]).not.toHaveProperty('credential');
  await call('metadata',`/resources/${id}/metadata`,'POST',{owner:'运维',notes:'测试',tags:['a'],poolId:'prod'});
  await call('refresh',`/resources/${id}/refresh`,'POST');await call('metadata',`/resources/${id}/metadata`,'POST',{owner:12},400);
  expect(responseValidator(doc,'overview')({...overview,resources:[{...overview.resources[0],credential:'leak'}]})).toBe(false);
 }finally{if(server)await close(server);await rm(dir,{recursive:true,force:true});}
});
it('文件真实 HTTP 全部 14 个操作匹配契约，验证两账户、回收站和下载字节',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mg-files-contract-'));let server:Server|undefined;
 try{
  const {manifest,contract}=await load('mg-files-one');const doc=validateContract(contract,manifest);const store=new FilesStore(dir);await store.initialize();
  server=createFilesServer(store,{introspect:async(token:string)=>({sub:token[0],name:'测试',username:'test',csrfToken:'csrf'})} as any);const origin=await listen(server);
  async function call(opid:string,path:string,method='GET',body?:unknown,status=200,owner='a'){const response=await fetch(origin+'/api'+path,{method,headers:{authorization:'Bearer '+owner.repeat(43),'x-csrf-token':'csrf','content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});expect(response.status).toBe(status);const data=await response.json();const validate=responseValidator(doc,opid,status);expect(validate(data),JSON.stringify(validate.errors)).toBe(true);return data;}
  await call('me','/auth/me');await call('desktop','/desktop');const list=await call('list','/entries');await call('folders','/folders');
  const folder=await call('createFolder','/folders','POST',{parentId:list.rootId,name:'契约测试'},201);
  const uploaded=await fetch(origin+`/api/uploads?parentId=${list.rootId}&name=test.txt`,{method:'POST',headers:{authorization:'Bearer '+ 'a'.repeat(43),'x-csrf-token':'csrf'},body:'contract-test'});expect(uploaded.status).toBe(201);const file=await uploaded.json();expect(responseValidator(doc,'upload',201)(file)).toBe(true);
  await call('get',`/entries/${file.id}`);await call('get',`/entries/${file.id}`,'GET',undefined,404,'b');
  const download=await fetch(origin+`/api/entries/${file.id}/content`,{headers:{authorization:'Bearer '+ 'a'.repeat(43)}});expect(download.status).toBe(200);expect(download.headers.get('content-type')).toBe('application/octet-stream');expect(await download.text()).toBe('contract-test');
  await call('patch',`/entries/${file.id}`,'PATCH',{favorite:true,version:file.version});await call('move',`/entries/${file.id}/move`,'POST',{parentId:folder.id});await call('access',`/entries/${file.id}/access`,'POST',{});
  await call('remove',`/entries/${file.id}`,'DELETE',{});await call('list','/entries?view=trash');await call('restore',`/entries/${file.id}/restore`,'POST',{});await call('remove',`/entries/${file.id}`,'DELETE',{});await call('permanent',`/entries/${file.id}/permanent`,'DELETE',{});
  expect(responseValidator(doc,'get')({...file,ownerId:'leak'})).toBe(false);
 }finally{if(server)await close(server);await rm(dir,{recursive:true,force:true});}
});
