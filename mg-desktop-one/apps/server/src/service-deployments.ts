import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {canonicalJson} from '../../../../mg-platform/packages/frontend/services/openapi';
import type {Publication} from './service-storage';

export interface ServiceDeployment {
 endpointRef:string;name:string;appId:string;providerAppId:string;environment:string;
 baseUrl:string;deploymentId:string;artifactDigest:string;resourceRef:string;deployedAt:string;
 services:Array<{serviceId:string;version:string;manifestDigest:string;contractDigest:string}>;
}
export interface DeploymentCatalog {schemaVersion:1;environments:Array<{id:string;name:string;deployments:ServiceDeployment[]}>}
export interface ServiceBinding {environment:string;endpointRef:string;deploymentId:string;deploymentDigest:string;manifestDigest:string;contractDigest:string}
export class ServiceBindingError extends Error {constructor(message:string,public status=409){super(message);}}
export const deploymentDigest=(deployment:ServiceDeployment)=>createHash('sha256').update(canonicalJson(deployment)).digest('hex');
const identifier=/^[a-z][a-z0-9-]{1,63}$/;
const digest=/^[a-f0-9]{64}$/;
function fields(input:any,allowed:string[]){if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!allowed.includes(key)))throw new ServiceBindingError('部署登记包含无效字段');}
export function validateDeploymentCatalog(value:any,appIds:Set<string>):DeploymentCatalog {
 fields(value,['schemaVersion','environments']);if(value.schemaVersion!==1||!Array.isArray(value.environments)||!value.environments.length||value.environments.length>16)throw new ServiceBindingError('部署环境配置无效');
 const environments=new Set<string>();
 for(const environment of value.environments){
  fields(environment,['id','name','deployments']);if(typeof environment.id!=='string'||!identifier.test(environment.id)||environment.id.length>32||environments.has(environment.id)||typeof environment.name!=='string'||!environment.name.trim()||environment.name.length>40||!Array.isArray(environment.deployments)||environment.deployments.length>256)throw new ServiceBindingError('部署环境定义无效');environments.add(environment.id);
  const refs=new Set<string>();
  for(const item of environment.deployments){
   fields(item,['endpointRef','name','appId','providerAppId','environment','baseUrl','deploymentId','artifactDigest','resourceRef','deployedAt','services']);
   if(typeof item.endpointRef!=='string'||!identifier.test(item.endpointRef)||refs.has(item.endpointRef)||item.environment!==environment.id||!appIds.has(item.appId)||!appIds.has(item.providerAppId)||typeof item.name!=='string'||!item.name.trim()||item.name.length>100||typeof item.deploymentId!=='string'||!/^[A-Za-z0-9@._:-]{1,180}$/.test(item.deploymentId)||!digest.test(item.artifactDigest)||typeof item.resourceRef!=='string'||!item.resourceRef.trim()||item.resourceRef.length>200||typeof item.deployedAt!=='string'||!Number.isFinite(Date.parse(item.deployedAt)))throw new ServiceBindingError('部署实例定义无效');
   refs.add(item.endpointRef);let url:URL;try{url=new URL(item.baseUrl);}catch{throw new ServiceBindingError('受控服务地址无效');}
   if(url.username||url.password||url.search||url.hash||!['https:','http:'].includes(url.protocol)||url.protocol==='http:'&&!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.pathname.includes('%')||/\/\//.test(url.pathname))throw new ServiceBindingError('受控服务地址必须为 HTTPS 或本机地址，不能带凭据或查询参数');
   if(item.baseUrl!==url.href.replace(/\/$/,''))throw new ServiceBindingError('受控地址必须规范化且不带末尾斜线');
   if(!Array.isArray(item.services)||!item.services.length||item.services.length>200)throw new ServiceBindingError('缺少已部署的服务契约');
   const services=new Set<string>();for(const service of item.services){
    fields(service,['serviceId','version','manifestDigest','contractDigest']);const key=service.serviceId+'@'+service.version;
    if(typeof service.serviceId!=='string'||!service.serviceId.startsWith(item.appId+'.')||typeof service.version!=='string'||!/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(service.version)||!digest.test(service.manifestDigest)||!digest.test(service.contractDigest)||services.has(key))throw new ServiceBindingError('已部署服务的归属、版本或摘要无效');services.add(key);
   }
  }
 }
 return structuredClone(value);
}
export function createDeploymentSource(filename:string,appIds:Set<string>){
 let catalog:DeploymentCatalog;
 return {async refresh(){const text=await readFile(filename,'utf8');if(Buffer.byteLength(text)>1024*1024)throw new ServiceBindingError('部署登记超过大小限制');catalog=validateDeploymentCatalog(JSON.parse(text),appIds);return catalog;},get(){if(!catalog)throw new ServiceBindingError('部署配置尚未加载',503);return catalog;}};
}
export function bindingFor(publication:Publication,environment:string,endpointRef:string,expectedDigest:string,catalog:DeploymentCatalog):ServiceBinding {
 const deployment=catalog.environments.find(e=>e.id===environment)?.deployments.find(d=>d.endpointRef===endpointRef);
 if(!deployment||deployment.appId!==publication.manifest.appId)throw new ServiceBindingError('目标环境没有此应用的受控部署');
 const actual=deploymentDigest(deployment);if(actual!==expectedDigest)throw new ServiceBindingError('部署记录已更新，请刷新后重新选择');
 if(!publication.contractDigest||!deployment.services.some(s=>s.serviceId===publication.manifest.serviceId&&s.version===publication.manifest.version&&s.manifestDigest===publication.digest&&s.contractDigest===publication.contractDigest))throw new ServiceBindingError('目标部署未声明支持此版本及契约，不能切换');
 return {environment,endpointRef:deployment.endpointRef,deploymentId:deployment.deploymentId,deploymentDigest:actual,manifestDigest:publication.digest,contractDigest:publication.contractDigest};
}
export function resolveServiceBinding(publication:Publication,binding:ServiceBinding|undefined,environment:string,catalog:DeploymentCatalog){
 if(!binding||binding.environment!==environment)throw new ServiceBindingError('当前环境尚未绑定服务部署',503);
 let expected:ServiceBinding;try{expected=bindingFor(publication,environment,binding.endpointRef,binding.deploymentDigest,catalog);}catch(error){throw new ServiceBindingError(error instanceof Error?error.message:'部署记录无效',503);}
 if(canonicalJson(binding)!==canonicalJson(expected))throw new ServiceBindingError('服务绑定与版本或部署不一致，请重新发布',503);
 return catalog.environments.find(e=>e.id===environment)!.deployments.find(d=>d.endpointRef===binding.endpointRef)!;
}
