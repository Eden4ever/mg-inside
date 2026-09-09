import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import defaults from '../../../../mg-platform/packages/frontend/services/catalog.json';
import defaultContracts from '../../../../mg-platform/packages/frontend/services/openapi-catalog.json';
import { operationMatches, operationPath, type ServiceManifest } from '../../../../mg-platform/packages/frontend/services/contracts';
import {compareServiceVersions,operationRoutesOverlap} from '../../../../mg-platform/packages/frontend/services/versions';
import {canonicalJson,compareContractVersions,type ServiceContract} from '../../../../mg-platform/packages/frontend/services/openapi';
import {validateContract} from './service-contracts';
import type {RegistryState as State,Activity,RegistryPersistence,RegistryTransactionContext,VersionLifecycle} from './service-storage';
import {bindingFor,resolveServiceBinding,type DeploymentCatalog,type ServiceBinding} from './service-deployments';
import {lifecycleKey,historicalLifecycle,validateLifecycle,validRetirementDate} from './service-lifecycle';

export class ServiceError extends Error { constructor(message: string, public status = 400) { super(message); } }
const id = /^[a-z][a-z0-9-]{1,63}$/;
function fields(value: any, names: string[]) { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !names.includes(k))) throw new ServiceError('清单包含无效字段'); }
export function validateManifest(input: unknown, appIds: Set<string>): ServiceManifest {
  const v = input as ServiceManifest;
  fields(v, ['schemaVersion', 'serviceId', 'appId', 'name', 'version', 'description', 'operations']);
  if (v.schemaVersion !== 1 || typeof v.appId !== 'string' || !id.test(v.appId) || !appIds.has(v.appId)
    || typeof v.serviceId !== 'string' || !v.serviceId.startsWith(v.appId + '.') || !/^[a-z0-9.-]{3,100}$/.test(v.serviceId)
    || typeof v.version !== 'string' || !/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(v.version)
    || typeof v.name !== 'string' || !v.name.trim() || v.name.length > 100 || typeof v.description !== 'string' || v.description.length > 2000
    || !Array.isArray(v.operations) || !v.operations.length || v.operations.length > 200) throw new ServiceError('服务清单格式无效');
  const keys = new Set<string>(), routes = new Set<string>();
  for (const op of v.operations) {
    fields(op, ['operationId', 'method', 'path', 'summary', 'effect']);
    if (typeof op.operationId !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(op.operationId) || keys.has(op.operationId)
      || !['GET','POST','PUT','PATCH','DELETE'].includes(op.method) || typeof op.path !== 'string' || op.path.length > 300
      || !/^\/(?:[A-Za-z0-9_-]+|\{[a-zA-Z][a-zA-Z0-9]*\})(?:\/(?:[A-Za-z0-9_-]+|\{[a-zA-Z][a-zA-Z0-9]*\}))*$/.test(op.path)
      || typeof op.summary !== 'string' || !op.summary.trim() || op.summary.length > 200
      || op.effect !== (op.method === 'GET' ? 'read' : 'write')) throw new ServiceError('接口定义无效或操作 ID 重复');
    const route = op.method + ' ' + op.path.replace(/\{[^}]+\}/g, '{}');
    if (routes.has(route)) throw new ServiceError('接口路径重复');
    keys.add(op.operationId); routes.add(route);
  }
  if(v.operations.some((op,index)=>v.operations.slice(index+1).some(other=>operationRoutesOverlap(op,other))))throw new ServiceError('接口路径存在重叠，会导致调用匹配冲突');
  // 规范化字段顺序，使重试与不同 JSON 键顺序获得相同摘要。
  return {schemaVersion:1,serviceId:v.serviceId,appId:v.appId,name:v.name.trim(),version:v.version,description:v.description,
    operations:v.operations.map(o=>({operationId:o.operationId,method:o.method,path:o.path,summary:o.summary,effect:o.effect})).sort((a,b)=>a.operationId.localeCompare(b.operationId))};
}
const hash = (m: ServiceManifest) => createHash('sha256').update(JSON.stringify(m)).digest('hex');
const contractHash=(doc:ServiceContract)=>createHash('sha256').update(canonicalJson(doc)).digest('hex');
export function validateRegistrySnapshot(saved:State, appIds:Set<string>,validatedContracts?:Set<string>) {
    if(saved.schemaVersion!==1 || !Array.isArray(saved.publications) || !saved.active || !Array.isArray(saved.audit) || !Array.isArray(saved.activity))throw new Error('服务目录存储格式无效');
    const keys=new Set<string>();
    for(const p of saved.publications){const m=validateManifest(p.manifest,appIds),key=m.serviceId+'@'+m.version;if(keys.has(key))throw new Error('服务版本重复');keys.add(key);if(hash(m)!==p.digest)throw new Error('服务清单校验失败');if(p.contract){
      if(contractHash(p.contract)!==p.contractDigest)throw new Error('OpenAPI 契约摘要校验失败');
      const validationKey=p.digest+':'+p.contractDigest;
      if(!validatedContracts?.has(validationKey)){validateContract(p.contract,m);if(validatedContracts&&validatedContracts.size>=512)validatedContracts.clear();validatedContracts?.add(validationKey);}
    }else if(p.contractDigest)throw new Error('OpenAPI 契约缺失');}
    for(const [serviceId,version] of Object.entries(saved.active)){if(!saved.publications.some(p=>p.manifest.serviceId===serviceId&&(version===null||p.manifest.version===version)))throw new Error('服务启用版本不存在');}
    for(const revision of Object.values(saved.revisions||{}))if(!Number.isSafeInteger(revision)||revision<0)throw new Error('服务修订号无效');
    for(const [key,value] of Object.entries(saved.lifecycles||{})){if(!keys.has(key))throw Error('生命周期对应的版本不存在');validateLifecycle(value);}
    for(const [serviceId,version] of Object.entries(saved.active))if(version&&['draft','retired'].includes(saved.lifecycles?.[lifecycleKey(serviceId,version)]?.status||''))throw Error('启用版本的生命周期无效');
    for(const binding of Object.values(saved.bindings||{})){
      fields(binding,['environment','endpointRef','deploymentId','deploymentDigest','manifestDigest','contractDigest']);
      if(typeof binding.environment!=='string'||typeof binding.endpointRef!=='string'||typeof binding.deploymentId!=='string'||![binding.deploymentDigest,binding.manifestDigest,binding.contractDigest].every(value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)))throw new Error('服务部署绑定无效');
    }
    return saved;
  }
export function createServiceRegistry(dir: string, appIds: Set<string>, persistence?:RegistryPersistence,bindingPolicy?:{environment:string;deployments:()=>DeploymentCatalog;refresh?:()=>Promise<DeploymentCatalog>}) {
  let state: State = { schemaVersion: 1, publications: [], active: {}, audit: [], activity: [] }, tail = Promise.resolve();
  const active = () => state.publications.filter(p => state.active[p.manifest.serviceId] === p.manifest.version);
  const revision=(serviceId:string)=>state.revisions?.[serviceId]||0;
  const lifecycle=(p:State['publications'][number])=>state.lifecycles?.[lifecycleKey(p.manifest.serviceId,p.manifest.version)]||historicalLifecycle(p);
  function recordLifecycle(p:State['publications'][number],value:VersionLifecycle,environment?:string){
    const previousLifecycle=lifecycle(p);state.lifecycles||={};state.lifecycles[lifecycleKey(p.manifest.serviceId,p.manifest.version)]=value;
    state.audit.push({id:randomUUID(),at:value.at,actor:value.actor,action:'lifecycle',serviceId:p.manifest.serviceId,version:p.manifest.version,lifecycle:structuredClone(value),previousLifecycle:structuredClone(previousLifecycle),environment:environment||bindingPolicy?.environment||'local'});state.audit=state.audit.slice(-500);
  }
  async function change<T>(fn: (context?:RegistryTransactionContext) => T|Promise<T>): Promise<T> {
    let output: T;
    const task = tail.then(async () => {
      const previous = structuredClone(state);
      try {
        if(persistence){const result=await persistence.transaction(async (saved,context)=>{state=checkState(saved);const value=await fn(context);return {state,value};});state=result.state;output=result.value;return;}
        output = await fn(); const temp = join(dir, `registry-${randomUUID()}.tmp`);
        await writeFile(temp, JSON.stringify(state), {mode:0o600,flag:'wx'}); await rename(temp, join(dir,'registry.json'));
      } catch(e) { state = previous; throw e; }
    });
    tail = task.catch(()=>{}); await task; return output!;
  }
  function validate(input: unknown) { return validateManifest(input, appIds); }
  const validatedContracts=new Set<string>();
  const checkState=(saved:State)=>validateRegistrySnapshot(saved,appIds,validatedContracts);
  return {
    async initialize() {
      if(persistence){state=checkState(await persistence.read({allowCache:true}));return;}
      await mkdir(dir,{recursive:true});
      try {
        const saved = JSON.parse(await readFile(join(dir,'registry.json'),'utf8'));
        state=checkState(saved);
      } catch(e:any) { if(e.code!=='ENOENT')throw e; }
      await change(()=>{for(const input of defaults) { const manifest=validate(input); if(!state.publications.some(p=>p.manifest.serviceId===manifest.serviceId)) {
        const inputContract=(defaultContracts as Record<string,unknown>)[manifest.serviceId];
        const contract=inputContract?validateContract(inputContract,manifest):undefined;
        state.publications.push({manifest,digest:hash(manifest),at:new Date().toISOString(),actor:'release',...(contract?{contract,contractDigest:contractHash(contract)}: {})}); state.active[manifest.serviceId]=manifest.version;
      } }});
    },
    async refresh(options?:{allowCache?:boolean}) {
      if(!persistence)return;
      const task=tail.then(async()=>{state=checkState(await persistence.read(options));});tail=task.catch(()=>{});await task;
    },
    async close(){await tail;await persistence?.close();},
    list(allowed: Set<string>) { return state.publications.filter(p=>allowed.has(p.manifest.appId)).map(p=>({...structuredClone(p),lifecycle:structuredClone(lifecycle(p)),active:state.active[p.manifest.serviceId]===p.manifest.version,activeRevision:revision(p.manifest.serviceId),activeVersion:state.active[p.manifest.serviceId]||null,binding:structuredClone(state.bindings?.[p.manifest.serviceId])})); },
    revision,
    activity(allowed: Set<string>) { const ids=new Set(state.publications.filter(p=>allowed.has(p.manifest.appId)).map(p=>p.manifest.serviceId));return state.activity.filter(a=>ids.has(a.serviceId)).slice().reverse(); },
    audit() { return structuredClone(state.audit).reverse(); },
    async publish(input: unknown, actor: string, contractInput?:unknown) {
      const manifest=validate(input),digest=hash(manifest);
      const contract=contractInput===undefined?undefined:validateContract(contractInput,manifest),contractDigest=contract?contractHash(contract):undefined;
      return change(()=>{
        const previous=state.publications.find(p=>p.manifest.serviceId===manifest.serviceId&&p.manifest.version===manifest.version);
        if(previous) {if(previous.digest!==digest||previous.contractDigest!==contractDigest)throw new ServiceError('此版本已存在且内容不同，请增加版本号',409);return {...structuredClone(previous),duplicate:true};}
        const collision=active().find(p=>p.manifest.appId===manifest.appId && p.manifest.serviceId!==manifest.serviceId && p.manifest.operations.some(a=>manifest.operations.some(b=>a.method===b.method&&a.path.replace(/\{[^}]+\}/g,'{}')===b.path.replace(/\{[^}]+\}/g,'{}'))));
        if(collision)throw new ServiceError('接口已由同一应用的其他服务登记',409);
        const p={manifest,digest,at:new Date().toISOString(),actor,...(contract?{contract,contractDigest}: {})};state.publications.push(p);
        state.lifecycles||={};state.lifecycles[lifecycleKey(manifest.serviceId,manifest.version)]={status:'draft',revision:0,reason:'等待首次环境发布',at:p.at,actor};
        // 新版本登记后显式启用，避免上传动作直接改变已运行出口。
        state.audit.push({id:randomUUID(),at:p.at,actor,action:'publish',serviceId:manifest.serviceId,version:manifest.version});state.audit=state.audit.slice(-500);
        return structuredClone(p);
      });
    },
    async activate(serviceId:string,version:string|null,actor:string,options:{expectedRevision:number;allowBreaking?:boolean;allowContractChange?:boolean;endpointRef?:string;expectedDeploymentDigest?:string}) {return change(async context=>{
      if(!state.publications.some(p=>p.manifest.serviceId===serviceId && (version===null||p.manifest.version===version)))throw new ServiceError('服务版本不存在',404);
      if(!Number.isSafeInteger(options?.expectedRevision)||options.expectedRevision!==revision(serviceId))throw new ServiceError('服务状态已更新，请刷新目录后重试',409);
      const candidate=state.publications.find(p=>p.manifest.serviceId===serviceId&&p.manifest.version===version);
      const current=active().find(p=>p.manifest.serviceId===serviceId);
      const previousBinding=state.bindings?.[serviceId];let binding:ServiceBinding|undefined;
      if(candidate){
        if(lifecycle(candidate).status==='retired')throw new ServiceError('此版本已退役，不能再次发布',409);
        if(bindingPolicy)binding=bindingFor(candidate,bindingPolicy.environment,options.endpointRef||'',options.expectedDeploymentDigest||'',await bindingPolicy.refresh?.()||bindingPolicy.deployments());
        if(compareServiceVersions(current?.manifest,candidate.manifest).some(change=>change.breaking)&&options.allowBreaking!==true)throw new ServiceError('此版本包含接口移除或调用方式变化，请审阅差异并明确确认',409);
        if(compareContractVersions(current?.contract,candidate.contract,candidate.manifest).some(change=>change.requiresReview)&&options.allowContractChange!==true)throw new ServiceError('参数或响应契约发生变化，请审阅契约差异并明确确认',409);
        if(active().some(p=>p.manifest.serviceId!==serviceId&&p.manifest.appId===candidate.manifest.appId&&p.manifest.operations.some(left=>candidate.manifest.operations.some(right=>operationRoutesOverlap(left,right)))))throw new ServiceError('此版本与同一应用的已启用服务存在路由冲突',409);
      }
      if((state.active[serviceId]||null)===version&&canonicalJson(previousBinding||null)===canonicalJson(binding||null))return {ok:true,revision:revision(serviceId),duplicate:true};
      if(candidate&&lifecycle(candidate).status==='deprecated')throw new ServiceError('此版本已弃用，不能新增或更换环境绑定；请先恢复维护状态',409);
      if(candidate&&lifecycle(candidate).status==='draft')recordLifecycle(candidate,{status:'published',revision:lifecycle(candidate).revision+1,reason:'首次环境发布',at:new Date().toISOString(),actor},context?.environment);
      state.revisions||={};state.revisions[serviceId]=revision(serviceId)+1;
      if(binding){state.bindings||={};state.bindings[serviceId]=binding;}else if(state.bindings)delete state.bindings[serviceId];
      state.active[serviceId]=version;state.audit.push({id:randomUUID(),at:new Date().toISOString(),actor,action:version===null?'disable':'activate',serviceId,version:version||'',...(binding?{binding}:{}),...(previousBinding?{previousBinding}:{})});state.audit=state.audit.slice(-500);return {ok:true};
    });},
    async setLifecycle(serviceId:string,version:string,actor:string,input:{status:string;reason:string;retireAfter?:string;expectedRevision:number}){return change(context=>{
      const p=state.publications.find(p=>p.manifest.serviceId===serviceId&&p.manifest.version===version);if(!p)throw new ServiceError('服务版本不存在',404);
      const before=lifecycle(p);
      if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision!==before.revision)throw new ServiceError('生命周期已更新，请刷新后重试',409);
      if(!['published','deprecated','retired'].includes(input.status)||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>2000||input.retireAfter!==undefined&&!validRetirementDate(input.retireAfter))throw new ServiceError('生命周期状态、说明或退役日期无效');
      if(input.retireAfter!==undefined&&input.status!=='deprecated')throw new ServiceError('仅弃用状态可设置计划退役日期');
      if(before.status===input.status&&before.reason===input.reason.trim()&&before.retireAfter===input.retireAfter)return {ok:true,duplicate:true,lifecycle:structuredClone(before)};
      if(before.status==='retired')throw new ServiceError('已退役版本不能修改或恢复，请登记新版本',409);
      if(input.status==='published'&&before.status!=='deprecated')throw new ServiceError('草稿必须通过环境发布转为已发布',409);
      if(input.status==='deprecated'&&!['published','deprecated'].includes(before.status))throw new ServiceError('只有已发布版本可以弃用',409);
      if(input.status==='retired'){
        if(!['draft','deprecated'].includes(before.status))throw new ServiceError('已发布版本必须先弃用再退役',409);
        if(before.retireAfter&&Date.now()<Date.parse(before.retireAfter+'T00:00:00Z'))throw new ServiceError('尚未到计划退役日期，请先调整弃用计划并通知调用方',409);
        // PostgreSQL 在同一全局锁内提供所有环境的绑定；持久化实现不支持时拒绝猜测。
        if(persistence&&!context)throw new ServiceError('存储未提供跨环境使用校验，不能退役',503);
        const users=context?.activeBindings.filter(b=>b.serviceId===serviceId&&b.version===version).map(b=>b.environment)||(state.active[serviceId]===version?['当前环境']:[]);
        if(users.length)throw new ServiceError('仍有环境使用此版本：'+[...new Set(users)].join('、')+'；请先切换或停用',409);
      }
      const value:VersionLifecycle={status:input.status as VersionLifecycle['status'],revision:before.revision+1,reason:input.reason.trim(),at:new Date().toISOString(),actor,...(input.retireAfter?{retireAfter:input.retireAfter}:{})};
      recordLifecycle(p,value,context?.environment);return {ok:true,lifecycle:structuredClone(value)};
    });},
    deployment(serviceId:string){
      if(!bindingPolicy)return undefined;
      const publication=active().find(p=>p.manifest.serviceId===serviceId);if(!publication)throw new ServiceError('服务未启用',404);
      return resolveServiceBinding(publication,state.bindings?.[serviceId],bindingPolicy.environment,bindingPolicy.deployments());
    },
    resolve(appId:string,method:string,path:string) {
      const matches=active().filter(p=>p.manifest.appId===appId).flatMap(p=>p.manifest.operations.filter(o=>operationMatches(o,method,path)).map(operation=>({manifest:p.manifest,lifecycle:structuredClone(lifecycle(p)),operation,path})));
      if(matches.length!==1)throw new ServiceError(matches.length?'接口匹配冲突':'接口未登记或服务未启用',matches.length?409:404);return matches[0]!;
    },
    invoke(serviceId:string,operationId:string,method:string,params:Record<string,string>) {
      const p=active().find(p=>p.manifest.serviceId===serviceId),op=p?.manifest.operations.find(o=>o.operationId===operationId);
      if(!p||!op)throw new ServiceError('服务或操作未启用',404);
      if(op.method!==method)throw new ServiceError('调用方法不匹配',405);
      let path:string;try{path=operationPath(op,params)}catch{throw new ServiceError('路径参数无效')};return {manifest:p.manifest,lifecycle:structuredClone(lifecycle(p)),operation:op,path};
    },
    async record(input:Omit<Activity,'id'|'at'>) { await change(()=>{state.activity.push({...input,id:randomUUID(),at:new Date().toISOString()});state.activity=state.activity.slice(-300);}); },
  };
}
