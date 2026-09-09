import {readFile,writeFile,rename} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {servicePool,serviceSchemaSql,importServiceState,createPostgresServiceStorage} from '../apps/server/src/service-postgres';
import {validateRegistrySnapshot,createServiceRegistry} from '../apps/server/src/services';
import {validateDeploymentCatalog,deploymentDigest,resolveServiceBinding} from '../apps/server/src/service-deployments';
import {canonicalJson} from '../../mg-platform/packages/frontend/services/openapi';
import catalog from '../../mg-platform/packages/frontend/services/catalog.json';

// 连接信息只从私密环境变量读取；命令参数和输出不含密码。
const [action,filename,target,expected]=process.argv.slice(2),environment=process.env.SERVICE_ENVIRONMENT;
if(!process.env.SERVICE_DATABASE_URL||!environment)throw Error('需要服务数据库连接与环境配置');
const pool=servicePool(process.env.SERVICE_DATABASE_URL),apps=new Set(catalog.map(m=>m.appId));
const hash=(data:unknown)=>createHash('sha256').update(canonicalJson(data)).digest('hex');
try{
 if(action==='install'){
  await pool.query(serviceSchemaSql);console.log('服务数据库结构已安装');
 }else if(action==='environment'){
  const empty={schemaVersion:1 as const,publications:[],active:{},audit:[],activity:[]};
  const result=await importServiceState(pool,environment,empty,hash(empty));console.log(JSON.stringify({environment,...result}));
 }else if((action==='validate-deployments'||action==='publish-deployments')&&filename){
  const lease=action==='publish-deployments'?await pool.connect():undefined;
  try{
  if(lease){await lease.query('BEGIN');await lease.query('SELECT pg_advisory_xact_lock(741029)');}
  const catalog=validateDeploymentCatalog(JSON.parse(await readFile(filename,'utf8')),apps);
  // 新登记不能令现有绑定失效；新产物应先部署到独立目标，再切换绑定。
  const environments=await pool.query('SELECT name FROM service_environments');
  for(const row of environments.rows){
   const state=validateRegistrySnapshot(await createPostgresServiceStorage(pool,row.name).read(),apps);
   for(const publication of state.publications.filter(p=>state.active[p.manifest.serviceId]===p.manifest.version)){
    const binding=state.bindings?.[publication.manifest.serviceId];if(binding)resolveServiceBinding(publication,binding,row.name,catalog);
   }
  }
  for(const target of catalog.environments){
   const state=validateRegistrySnapshot(await createPostgresServiceStorage(pool,target.id).read(),apps);
   for(const deployment of target.deployments)for(const service of deployment.services)if(!state.publications.some(p=>p.manifest.serviceId===service.serviceId&&p.manifest.version===service.version&&p.digest===service.manifestDigest&&p.contractDigest===service.contractDigest))throw Error('目标部署声明的服务契约尚未登记或摘要不符');
  }
  if(lease){
   if(!target||!expected||createHash('sha256').update(await readFile(target)).digest('hex')!==expected)throw Error('部署配置已变化');
   const temp=target+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(catalog,null,2)+'\n',{flag:'wx',mode:0o644});await rename(temp,target);await lease.query('COMMIT');
  }
  console.log(JSON.stringify({valid:true,published:!!lease,environments:catalog.environments.map(e=>e.id),digest:hash(catalog)}));
  }catch(error){await lease?.query('ROLLBACK').catch(()=>{});throw error;}finally{lease?.release();}
 }else if((action==='bind'||action==='verify-bindings')&&filename){
  const catalog=validateDeploymentCatalog(JSON.parse(await readFile(filename,'utf8')),apps);
  const store=createServiceRegistry('',apps,createPostgresServiceStorage(pool,environment),{environment,deployments:()=>catalog});await store.initialize();
  const active=store.list(apps).filter(p=>p.active);
  for(const publication of active){
   if(action==='bind'){
    const deployments=catalog.environments.find(e=>e.id===environment)?.deployments.filter(d=>d.services.some(s=>s.serviceId===publication.manifest.serviceId&&s.version===publication.manifest.version&&s.manifestDigest===publication.digest&&s.contractDigest===publication.contractDigest))||[];
    if(deployments.length!==1)throw Error('初始绑定必须有且只有一个已核验目标部署');
    await store.activate(publication.manifest.serviceId,publication.manifest.version,'release-binding',{expectedRevision:publication.activeRevision,endpointRef:deployments[0].endpointRef,expectedDeploymentDigest:deploymentDigest(deployments[0])});
   }
   const deployment=store.deployment(publication.manifest.serviceId)!;
   console.log(JSON.stringify({serviceId:publication.manifest.serviceId,version:publication.manifest.version,environment,endpointRef:deployment.endpointRef,deploymentId:deployment.deploymentId,verified:true}));
  }
 }else if(action==='import'&&filename){
  const data=validateRegistrySnapshot(JSON.parse(await readFile(filename,'utf8')),apps);
  const result=await importServiceState(pool,environment,data,hash(data));
  console.log(JSON.stringify({environment,duplicate:result.duplicate,publications:data.publications.length,active:data.active,digest:hash(data)}));
 }else if(action==='export'&&filename){
  const data=validateRegistrySnapshot(await createPostgresServiceStorage(pool,environment).read(),apps);
  await writeFile(filename,JSON.stringify(data),{flag:'wx',mode:0o600});console.log(JSON.stringify({environment,publications:data.publications.length,digest:hash(data)}));
 }else if(action==='verify'&&filename){
  const before=validateRegistrySnapshot(JSON.parse(await readFile(filename,'utf8')),apps);
  const after=validateRegistrySnapshot(await createPostgresServiceStorage(pool,environment).read(),apps);
  // 可选 revisions 缺失和空映射等价；JSONB 字段顺序不影响语义。
  if(hash({...before,revisions:before.revisions||{}})!==hash({...after,revisions:after.revisions||{}}))throw Error('迁移前后数据不一致');
  console.log(JSON.stringify({environment,publications:after.publications.length,verified:true,digest:hash(after)}));
 }else throw Error('使用 install、environment、bind/verify-bindings 部署文件、import 文件、export 新文件或 verify 文件');
}catch{console.error('服务数据库操作失败；请核对数据库状态、私密配置及迁移输入，未输出连接信息。');process.exitCode=1;}
finally{await pool.end();}
