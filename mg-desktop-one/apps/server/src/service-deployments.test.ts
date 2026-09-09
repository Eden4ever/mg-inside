import {it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServiceRegistry} from './services';
import {validateDeploymentCatalog,deploymentDigest,bindingFor,type DeploymentCatalog} from './service-deployments';
const apps=new Set(['files','office-one','identity','resource-manager','expert-database','token-one']);
async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),'mg-binding-'));const seed=createServiceRegistry(dir,apps);await seed.initialize();const publication=seed.list(apps).find(p=>p.manifest.appId==='files')!;
 const entry={endpointRef:'files-blue',name:'文件部署',appId:'files',providerAppId:'files',environment:'production',baseUrl:'http://127.0.0.1:14350/api',deploymentId:'files-release-1',artifactDigest:'a'.repeat(64),resourceRef:'test-server',deployedAt:'2026-09-09T00:00:00Z',services:[{serviceId:publication.manifest.serviceId,version:publication.manifest.version,manifestDigest:publication.digest,contractDigest:publication.contractDigest!}]};
 const catalog:DeploymentCatalog={schemaVersion:1,environments:[{id:'production',name:'生产',deployments:[entry]},{id:'testing',name:'测试',deployments:[{...entry,environment:'testing',endpointRef:'files-test',baseUrl:'http://127.0.0.1:15350/api'}]}]};
 return {dir,publication,entry,catalog};
}
it('受控部署拒绝重复环境、越界应用、任意 HTTP、凭据和契约摘要错误',async()=>{
 const {dir,catalog}=await fixture();try{
  expect(validateDeploymentCatalog(catalog,apps)).toEqual(catalog);
  for(const mutate of [(c:any)=>c.environments.push(c.environments[0]),(c:any)=>c.environments[0].deployments.push(c.environments[0].deployments[0]),(c:any)=>c.environments[0].deployments[0].appId='unknown',(c:any)=>c.environments[0].deployments[0].baseUrl='http://169.254.169.254/latest',(c:any)=>c.environments[0].deployments[0].baseUrl='https://user:secret@example.com/api',(c:any)=>c.environments[0].deployments[0].services[0].contractDigest='bad']){const next=structuredClone(catalog);mutate(next);expect(()=>validateDeploymentCatalog(next,apps)).toThrow();}
 }finally{await rm(dir,{recursive:true,force:true});}
});
it('未绑定不能路由，选择错误环境、过期部署或未部署契约不能发布',async()=>{
 const {dir,catalog,publication,entry}=await fixture();try{
  const store=createServiceRegistry(dir,apps,undefined,{environment:'production',deployments:()=>catalog});await store.initialize();expect(()=>store.deployment('files.api')).toThrow('尚未绑定');
  expect(()=>bindingFor(publication,'production','files-test',deploymentDigest(entry),catalog)).toThrow('没有');
  expect(()=>bindingFor(publication,'production','files-blue','0'.repeat(64),catalog)).toThrow('记录已更新');
  expect(()=>bindingFor({...publication,contractDigest:'b'.repeat(64)},'production','files-blue',deploymentDigest(entry),catalog)).toThrow('未声明支持');
  await store.activate('files.api',publication.manifest.version,'admin',{expectedRevision:0,endpointRef:'files-blue',expectedDeploymentDigest:deploymentDigest(entry)});
  expect(store.deployment('files.api')?.baseUrl).toBe(entry.baseUrl);expect(store.revision('files.api')).toBe(1);
  expect((await store.activate('files.api',publication.manifest.version,'admin',{expectedRevision:1,endpointRef:'files-blue',expectedDeploymentDigest:deploymentDigest(entry)})).duplicate).toBe(true);
 }finally{await rm(dir,{recursive:true,force:true});}
});
it('同版本更换部署也递增修订，旧页面失败，部署漂移阻断路由且能明确恢复',async()=>{
 const {dir,catalog,publication,entry}=await fixture();try{
  const store=createServiceRegistry(dir,apps,undefined,{environment:'production',deployments:()=>catalog});await store.initialize();
  await store.activate('files.api',publication.manifest.version,'admin',{expectedRevision:0,endpointRef:'files-blue',expectedDeploymentDigest:deploymentDigest(entry)});
  const green={...entry,endpointRef:'files-green',baseUrl:'http://127.0.0.1:14352/api',deploymentId:'files-release-2',artifactDigest:'b'.repeat(64)};catalog.environments[0].deployments.push(green);
  await store.activate('files.api',publication.manifest.version,'admin',{expectedRevision:1,endpointRef:'files-green',expectedDeploymentDigest:deploymentDigest(green)});
  expect(store.revision('files.api')).toBe(2);expect(store.audit()[0].previousBinding?.endpointRef).toBe('files-blue');
  await expect(store.activate('files.api',null,'stale',{expectedRevision:1})).rejects.toThrow('状态已更新');
  green.artifactDigest='c'.repeat(64);expect(()=>store.deployment('files.api')).toThrow('记录已更新');
  await store.activate('files.api',publication.manifest.version,'admin',{expectedRevision:2,endpointRef:'files-green',expectedDeploymentDigest:deploymentDigest(green)});
  const restored=createServiceRegistry(dir,apps,undefined,{environment:'production',deployments:()=>catalog});await restored.initialize();expect(restored.deployment('files.api')?.artifactDigest).toBe('c'.repeat(64));
  await restored.activate('files.api',null,'admin',{expectedRevision:3});expect(()=>restored.deployment('files.api')).toThrow('未启用');
 }finally{await rm(dir,{recursive:true,force:true});}
});
