import {it,expect} from 'vitest';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServiceRegistry,validateRegistrySnapshot} from './services';
import {lifecycleKey,validRetirementDate} from './service-lifecycle';
import catalog from '../../../../mg-platform/packages/frontend/services/catalog.json';

it('草稿首次发布、弃用与恢复、退役保护及重启历史完整',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'service-lifecycle-')),apps=new Set(catalog.map(p=>p.appId));
 try{
  const store=createServiceRegistry(dir,apps);await store.initialize();
  const initial=store.list(apps).find(p=>p.manifest.serviceId==='files.api')!;
  expect(initial.lifecycle.status).toBe('published');
  const manifest={...initial.manifest,version:'1.9.0'},contract=structuredClone(initial.contract!);contract.info.version=manifest.version;
  await store.publish(manifest,'test',contract);const row=()=>store.list(apps).find(p=>p.manifest.version==='1.9.0')!;const registeredDigest=row().contractDigest;
  expect(row().lifecycle.status).toBe('draft');
  await expect(store.setLifecycle(manifest.serviceId,manifest.version,'test',{status:'published',reason:'跳过部署',expectedRevision:0})).rejects.toThrow('环境发布');
  await store.activate(manifest.serviceId,manifest.version,'test',{expectedRevision:0,allowContractChange:true});expect(row().lifecycle.status).toBe('published');
  await store.setLifecycle(manifest.serviceId,manifest.version,'test',{status:'deprecated',reason:'迁移到新版本',retireAfter:'2099-01-01',expectedRevision:1});
  expect(store.invoke('files.api','list','GET',{}).manifest.version).toBe('1.9.0');
  expect((await store.setLifecycle(manifest.serviceId,manifest.version,'test',{status:'deprecated',reason:'迁移到新版本',retireAfter:'2099-01-01',expectedRevision:2})).duplicate).toBe(true);
  await expect(store.setLifecycle(manifest.serviceId,manifest.version,'test',{status:'published',reason:'旧页面',expectedRevision:1})).rejects.toThrow('已更新');
  await expect(store.setLifecycle(manifest.serviceId,manifest.version,'test',{status:'retired',reason:'提前退役',expectedRevision:2})).rejects.toThrow('尚未到');
  await store.setLifecycle(manifest.serviceId,manifest.version,'test',{status:'published',reason:'继续维护',expectedRevision:2});
  await store.setLifecycle(manifest.serviceId,manifest.version,'test',{status:'deprecated',reason:'调用方已迁移',expectedRevision:3});
  await expect(store.setLifecycle(manifest.serviceId,manifest.version,'test',{status:'retired',reason:'完成退役',expectedRevision:4})).rejects.toThrow('仍有环境');
  await store.activate(manifest.serviceId,null,'test',{expectedRevision:1});
  await expect(store.activate(manifest.serviceId,manifest.version,'test',{expectedRevision:2,allowContractChange:true})).rejects.toThrow('已弃用');
  await store.setLifecycle(manifest.serviceId,manifest.version,'test',{status:'retired',reason:'完成退役',expectedRevision:4});
  await expect(store.activate(manifest.serviceId,manifest.version,'test',{expectedRevision:2})).rejects.toThrow('已退役');
  await expect(store.setLifecycle(manifest.serviceId,manifest.version,'test',{status:'published',reason:'不可恢复',expectedRevision:5})).rejects.toThrow('已退役');
  await store.publish(manifest,'retry',contract);expect(row().lifecycle.status).toBe('retired');
  const reloaded=createServiceRegistry(dir,apps);await reloaded.initialize();expect(reloaded.list(apps).find(p=>p.manifest.version==='1.9.0')?.lifecycle.status).toBe('retired');
  expect(reloaded.audit().find(e=>e.lifecycle?.status==='retired')?.previousLifecycle?.status).toBe('deprecated');
  expect(row().contractDigest).toBe(registeredDigest);
  const saved=JSON.parse(await readFile(join(dir,'registry.json'),'utf8'));saved.active['files.api']='1.9.0';expect(()=>validateRegistrySnapshot(saved,apps)).toThrow('生命周期无效');
 }finally{await rm(dir,{recursive:true,force:true});}
});

it('生命周期必须有合法说明、真实日期与已登记版本',async()=>{
 expect(validRetirementDate('2026-02-30')).toBe(false);expect(validRetirementDate('2028-02-29')).toBe(true);
 const dir=await mkdtemp(join(tmpdir(),'service-lifecycle-')),apps=new Set(catalog.map(p=>p.appId));
 try{const store=createServiceRegistry(dir,apps);await store.initialize();
  await expect(store.setLifecycle('files.api','1.1.0','test',{status:'deprecated',reason:' ',expectedRevision:0})).rejects.toThrow('无效');
  await expect(store.setLifecycle('files.api','1.1.0','test',{status:'retired',reason:'跳过弃用',expectedRevision:0})).rejects.toThrow('先弃用');
  const state=JSON.parse(await readFile(join(dir,'registry.json'),'utf8'));state.lifecycles={[lifecycleKey('files.api','9.9.9')]:{status:'retired',revision:1,reason:'不存在',at:new Date().toISOString(),actor:'test'}};
  expect(()=>validateRegistrySnapshot(state,apps)).toThrow('版本不存在');
 }finally{await rm(dir,{recursive:true,force:true});}
});
