import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),workspace=resolve(root,'..');
const inventory=JSON.parse(await readFile(join(root,'registrations/api-inventory.json'),'utf8'));
const catalog=JSON.parse(await readFile(join(workspace,'mg-platform/packages/frontend/services/catalog.json'),'utf8'));
const contracts=JSON.parse(await readFile(join(workspace,'mg-platform/packages/frontend/services/openapi-catalog.json'),'utf8'));
const shape=p=>p.replace(/\{[^}]+\}/g,'{}');
const known=new Set(catalog.flatMap(m=>m.operations.map(o=>m.appId+' '+o.method+' '+shape(contracts[m.serviceId].servers[0].url.replace(/\/$/,'')+o.path))));
const names={'identity':'统一身份','personal-center':'个人中心','token-one':'Token 门户','token-one-console':'Token 控制台','token-one-docs':'Token 文档','expert-database':'指标知识库','files':'文件','office-one':'Office','resource-manager':'资源管理','service-manager':'服务中心','app-manager':'应用管理'};
const groups=new Map(),metadata=[];
function overlap(a,b){const x=a.path.split('/'),y=b.path.split('/');return a.method===b.method&&x.length===y.length&&x.every((s,i)=>s===y[i]||s.startsWith('{')||y[i].startsWith('{'));}
for(const entry of inventory.entries){
  for(const appId of entry.appIds.filter(id=>id!=='desktop-one')){
    assert(names[appId],'未知应用 '+appId);
    if(known.has(appId+' '+entry.method+' '+shape(entry.path)))continue;
    const exposure=['business','management','self'].includes(entry.boundary)?'gateway':'catalog';
    const operation={operationId:entry.id,method:entry.method,path:exposure==='gateway'?entry.path.replace(/^\/api\//,'/'):entry.path,summary:entry.summary,effect:['GET','HEAD','OPTIONS'].includes(entry.method)?'read':'write'};
    const key=[appId,entry.provider,entry.domain,entry.boundary,exposure].join('|');
    let buckets=groups.get(key);if(!buckets){buckets=[];groups.set(key,buckets);}
    // 相交模板分成独立登记包，沿用内核严格的启用冲突检查。
    let bucket=buckets.find(b=>b.manifest.operations.length<200&&(exposure==='catalog'||!b.manifest.operations.some(o=>overlap(o,operation))));
    if(!bucket){
      const suffix=createHash('sha256').update(key).digest('hex').slice(0,8)+(buckets.length?'-'+(buckets.length+1):'');
      const serviceId=appId+'.'+entry.boundary+'-'+suffix;
      bucket={manifest:{schemaVersion:1,serviceId,appId,name:names[appId]+' · '+entry.domain+(buckets.length?' · '+(buckets.length+1):''),version:'1.0.0',description:entry.auth+'。'+(exposure==='catalog'?'协议或平台目录登记，保持提供方协议，不通过业务代理启用。':'源码接口正式登记，完整 OpenAPI 待补，尚未启用。'),operations:[],...(exposure==='catalog'?{exposure}:{})}};
      buckets.push(bucket);metadata.push({serviceId,category:entry.category,owner:'',boundary:entry.boundary});
    }
    bucket.manifest.operations.push(operation);
  }
}
const publications=[...catalog.map(manifest=>({manifest,contract:contracts[manifest.serviceId]})),...[...groups.values()].flat()];
for(const m of catalog){const entry=inventory.entries.find(e=>e.appIds.includes(m.appId));metadata.push({serviceId:m.serviceId,category:entry?.category||'application',owner:'',boundary:'business'});}
const bundle={schemaVersion:1,publications,metadata};
const output=join(root,'registrations/api-publications.json'),serialized=JSON.stringify(bundle,null,2)+'\n';
if(process.argv.includes('--check'))assert.equal(await readFile(output,'utf8'),serialized,'正式登记包已发生源码漂移');else await writeFile(output,serialized);
console.log(JSON.stringify({services:publications.length,operations:publications.reduce((n,p)=>n+p.manifest.operations.length,0),existingServices:catalog.length,existingOperations:catalog.reduce((n,m)=>n+m.operations.length,0),catalogOnlyServices:publications.filter(p=>p.manifest.exposure==='catalog').length},null,2));
