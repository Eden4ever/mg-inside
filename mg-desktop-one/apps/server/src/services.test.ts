import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,expect,it} from 'vitest';
import {createServiceRegistry,validateManifest} from './services';
import {operationMatches} from '../../../../mg-platform/packages/frontend/services/contracts';
import {compareServiceVersions} from '../../../../mg-platform/packages/frontend/services/versions';
const apps=new Set(['resource-manager','files','office-one','expert-database','token-one','identity']);
const dirs:string[]=[];
async function setup(){const dir=await mkdtemp(join(tmpdir(),'mg-services-'));dirs.push(dir);const store=createServiceRegistry(dir,apps);await store.initialize();return {dir,store}}
afterEach(async()=>{for(const dir of dirs.splice(0))await rm(dir,{recursive:true,force:true})});
it('拒绝越界应用、任意地址、路径穿越和伪装只读写操作',async()=>{const {store}=await setup();const m=store.list(apps)[0]!.manifest;for(const changed of [{...m,appId:'evil'},{...m,upstream:'http://127.0.0.1:22'},{...m,operations:[{...m.operations[0],path:'/../secret'}]},{...m,operations:[{...m.operations[0],method:'POST',effect:'read'}]}])expect(()=>validateManifest(changed,apps)).toThrow();});
it('登记重试幂等、不可覆盖版本、显式启用与重启后保持停用',async()=>{const {dir,store}=await setup();const m={...store.list(apps)[0]!.manifest,version:'2.0.0'};await store.publish(m,'owner');expect((await store.publish(m,'owner')).digest).toBeTruthy();expect(store.list(apps).filter(p=>p.manifest.version==='2.0.0')[0]?.active).toBe(false);await expect(store.publish({...m,name:'篡改'},'owner')).rejects.toThrow('内容不同');await store.activate(m.serviceId,'2.0.0','owner',{allowContractChange:true,expectedRevision:store.revision(m.serviceId)});expect(store.resolve('resource-manager','GET','/overview').manifest.version).toBe('2.0.0');await store.activate(m.serviceId,null,'owner',{allowContractChange:true,expectedRevision:store.revision(m.serviceId)});expect(()=>store.resolve('resource-manager','GET','/overview')).toThrow('未启用');const restored=createServiceRegistry(dir,apps);await restored.initialize();expect(()=>restored.resolve('resource-manager','GET','/overview')).toThrow();});
it('方法、路径与命名调用严格匹配，编码斜杠不能扩大路径',async()=>{const {store}=await setup();expect(store.invoke('files.api','get','GET',{id:'test-id'}).path).toBe('/entries/test-id');expect(()=>store.invoke('files.api','get','POST',{id:'x'})).toThrow('方法');expect(()=>store.invoke('files.api','get','GET',{id:'../secret'})).toThrow();expect(()=>store.resolve('files','GET','/entries/a%2fb')).toThrow();expect(()=>store.resolve('files','POST','/entries/test/content')).toThrow();expect(operationMatches({operationId:'x',method:'GET',path:'/entries/{id}',summary:'x',effect:'read'},'GET','/entries/a/b')).toBe(false);});
it('并发记录保持一致，只返回授权应用目录',async()=>{const {store}=await setup();await Promise.all(Array.from({length:12},(_,i)=>store.record({serviceId:'files.api',operationId:'get',actor:'u',status:200,durationMs:i})));expect(store.activity(new Set(['files']))).toHaveLength(12);expect(store.activity(new Set(['identity']))).toHaveLength(0);expect(store.list(new Set(['files'])).every(p=>p.manifest.appId==='files')).toBe(true);});
it('版本差异区分新增、移除与方法变化，不把版本号当作兼容证明',async()=>{
 const {store}=await setup();const before=store.list(apps).find(p=>p.manifest.appId==='resource-manager')!.manifest;
 const after={...before,version:'1.0.1',operations:[{...before.operations.find(op=>op.operationId==='overview')!,path:'/overview-new'}]};
 const changes=compareServiceVersions(before,after);expect(changes.filter(change=>change.breaking)).toHaveLength(3);
 await store.publish(after,'owner');await expect(store.activate(after.serviceId,after.version,'owner',{allowContractChange:true,expectedRevision:0})).rejects.toThrow('明确确认');
 expect(store.resolve('resource-manager','GET','/overview').manifest.version).toBe(before.version);
 await store.activate(after.serviceId,after.version,'owner',{allowContractChange:true,expectedRevision:0,allowBreaking:true});
 expect(store.resolve('resource-manager','GET','/overview-new').manifest.version).toBe('1.0.1');
});
it('并发切换只能有一个成功，旧页面和重启后仍不能覆盖新选择',async()=>{
 const {dir,store}=await setup();const before=store.list(apps)[0]!.manifest;
 await store.publish({...before,version:'1.0.1'},'owner');await store.publish({...before,version:'1.0.2'},'owner');
 const changes=await Promise.allSettled(['1.0.1','1.0.2'].map(version=>store.activate(before.serviceId,version,'owner',{allowContractChange:true,expectedRevision:0})));
 expect(changes.filter(change=>change.status==='fulfilled')).toHaveLength(1);expect(store.revision(before.serviceId)).toBe(1);
 const restored=createServiceRegistry(dir,apps);await restored.initialize();expect(restored.revision(before.serviceId)).toBe(1);
 await expect(restored.activate(before.serviceId,null,'stale-page',{allowContractChange:true,expectedRevision:0})).rejects.toThrow('状态已更新');
});
it('启用时拒绝静态与参数路由重叠，注册后其他服务启用也不会绕过检查',async()=>{
 const {store}=await setup();const base=store.list(apps)[0]!.manifest;
 const one={...base,serviceId:'resource-manager.one',operations:[{operationId:'one',path:'/inventory/{id}',method:'GET',effect:'read' as const,summary:'查询'}]};
 const two={...base,serviceId:'resource-manager.two',operations:[{operationId:'two',path:'/inventory/current',method:'GET',effect:'read' as const,summary:'当前'}]};
 expect(()=>validateManifest({...one,operations:[...one.operations,...two.operations]},apps)).toThrow('重叠');
 await store.publish(one,'owner');await store.publish(two,'owner');await store.activate(one.serviceId,one.version,'owner',{allowContractChange:true,expectedRevision:0});
 await expect(store.activate(two.serviceId,two.version,'owner',{allowContractChange:true,expectedRevision:0})).rejects.toThrow('路由冲突');
 expect(store.resolve('resource-manager','GET','/inventory/current').manifest.serviceId).toBe(one.serviceId);
});
