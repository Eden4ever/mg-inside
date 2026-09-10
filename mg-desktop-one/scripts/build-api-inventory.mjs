import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

const root=resolve(import.meta.dirname,'..'),workspace=resolve(root,'..');
execFileSync(process.execPath,[join(root,'scripts/audit-api-registration.mjs')],{cwd:root,stdio:'pipe'});
const scan=JSON.parse(await readFile(join(root,'docs/api-registration-inventory.json'),'utf8'));
const catalog=JSON.parse(await readFile(join(workspace,'mg-platform/packages/frontend/services/catalog.json'),'utf8'));
const contracts=JSON.parse(await readFile(join(workspace,'mg-platform/packages/frontend/services/openapi-catalog.json'),'utf8'));
const entries=[],gaps=[];
const categories=[['system','系统服务'],['application','应用服务'],['data','数据服务'],['component','组件服务'],['engine','引擎服务']].map(([id,name])=>({id,name}));
const boundaries=[['business','业务接口'],['management','管理接口'],['self','本人账号'],['identity','身份协议'],['machine','机器集成'],['external','外部开放协议'],['platform','平台控制面'],['probe','健康探针'],['asset','页面与静态资源']].map(([id,name])=>({id,name}));
const domains={auth:'认证与会话','account-security':'账号安全',applications:'应用授权',users:'用户目录',roles:'角色权限',organizations:'组织机构',divisions:'行政区划','login-attempts':'登录审计','mail-settings':'邮件配置',systems:'指标体系','indicator-versions':'指标版本','semantic-libraries':'语义库','model-management':'模型配置',models:'模型目录',channels:'渠道管理',groups:'分组路由',tokens:'令牌管理',logs:'调用日志',stats:'用量统计','supplier-accounts':'供应商账号','routing-metadata':'路由元数据','availability-alerts':'可用性告警','cctq-account':'供应商同步',wecom:'企业微信',entries:'文件条目',folders:'文件夹',uploads:'文件上传',desktop:'桌面文件',overview:'资源总览',resources:'资源管理',office:'Office 文档'};
domains.scopes='数据范围';
const sourceCache=new Map();
async function source(file,needle){
  const absolute=join(workspace,file);
  if(!sourceCache.has(file))sourceCache.set(file,await readFile(absolute,'utf8'));
  const text=sourceCache.get(file),offset=text.indexOf(needle);assert(offset>=0,`来源定位失败：${file} ${needle}`);
  return {file,line:text.slice(0,offset).split('\n').length};
}
function add(entry){
  const key=entry.provider+' '+entry.method+' '+entry.path.replace(/\{[^}]+\}/g,'{}');
  const id='api-'+createHash('sha256').update(key).digest('hex').slice(0,24);
  assert(!entries.some(e=>e.id===id),'重复接口：'+key);
  entries.push({id,...entry});
}
function classify(route){
  const p=route.path.replace(/^\/api\//,'/'),segments=p.split('/').filter(Boolean);
  let appIds=[route.provider],category=route.provider==='identity'?'system':route.provider==='expert-database'?'data':'engine';
  let boundary='business',auth='应用用户会话及资源权限',domain=domains[segments[0]]||segments[0],note='源码声明；部署启用状态须结合运行配置核验。缺少契约时仅登记台账。';
  if(route.provider==='token-one'){
    if(/^\/(admin|wecom)(\/|$)/.test(p)){appIds=['token-one-console'];boundary='management';auth='控制台 audience 与管理员权限';domain=domains[segments[0]==='admin'?segments[1]:segments[0]]||segments[1];}
    if(p.startsWith('/portal/')){domain=domains[segments[1]]||'门户';auth='门户 audience 及本人资源权限';}
    const endpoint=/^\/auth\/(?:me|logout)\/(token-one|token-one-console|token-one-docs)$/.exec(p);if(endpoint)appIds=[endpoint[1]];
    if(p==='/public/models'){appIds=['token-one','token-one-docs'];auth='公开模型目录';domain='模型目录';}
  }
  if(/^\/(api\/)?health(?:\/|$)/.test(route.path)){boundary='probe';auth='健康探针';domain='运行健康';}
  else if(route.path.startsWith('/assets/')){boundary='asset';auth='静态资源路径白名单';domain='页面资源';}
  else if(route.path.startsWith('/v1/')){boundary='external';auth='API Key、配额及协议鉴权';domain='模型推理协议';note='保持提供方协议、流式传输及用量计量；不得改为桌面 Cookie 代理。';}
  else if(/^\/(unified|directory)(\/|$)/.test(p)){
    boundary='identity';domain=p.startsWith('/unified/')?'统一身份协议':'机器目录同步';
    auth=p==='/unified/authorize'?'中心会话、应用白名单与 PKCE':'机器凭据与应用授权/作用域';note='身份基础接口；不依赖已登录桌面网关，避免认证循环。';
  }else if(route.path.startsWith('/interaction/')){boundary='identity';domain='OIDC 交互';auth='中心会话与 OIDC 交互状态';}
  else if(p.startsWith('/auth/')&&!/^\/auth\/(me|change-password|logout)(\/|$)/.test(p)){
    boundary='identity';domain='登录与 MFA';auth='提供方登录流程、挑战 Cookie、PKCE 或回调状态';note='登录前接口保留提供方认证流程；具体挑战与 CSRF 由对应处理器校验。';
  }else if(p.startsWith('/account-security')||/^\/auth\/(me|logout|change-password)(\/|$)/.test(p)||p==='/applications/mine'){
    boundary='self';domain=p.startsWith('/account-security')?'账号安全':'本人会话';auth='本人会话；写入须 CSRF，敏感操作须二次验证';
    if(route.provider==='identity'){appIds=['identity','personal-center'];note='中心 FoundationIdentity 接口；本人访问不要求身份管理应用管理员权限。';}
  }else if(route.provider==='identity'||/^(users|mail-settings|model-management)$/.test(segments[0])){boundary='management';auth='提供方会话与管理权限';}
  if(route.provider==='expert-database'&&(p.startsWith('/account-security')||p.startsWith('/auth/')||p.startsWith('/users')||p.startsWith('/mail-settings')))note+=' 独立认证与统一身份模式的可用性由提供方配置决定。';
  return {provider:route.provider,appIds,category,domain,boundary,auth,summary:domain+' · '+route.method+' '+p,method:route.method,path:route.path,source:{file:route.source,line:route.line},note};
}
for(const route of scan.routes)add(classify(route));
// 原生 HTTP 路由以逐项来源锚点补充，构建时确认处理器仍然存在。
for(const [appId,file] of [['files','mg-files-one/server/http.ts'],['office-one','mg-files-one/server/http.ts'],['resource-manager','mg-resource-one/server/http.ts']]){
  const manifest=catalog.find(m=>m.appId===appId),base=contracts[manifest.serviceId].servers[0].url.replace(/\/$/,'');
  for(const op of manifest.operations){
    const path=base+op.path;
    let needle=path.includes('{')?appId==='files'?"const match =":path.includes('/documents/')?'const documentMatch':path.endsWith('/save')?'const saveMatch':path.includes('/sessions/')?'const sessionMatch':path.endsWith('/metadata')?'const metadata':'const refresh':path;
    add({provider:appId==='office-one'?'files':appId,appIds:[appId],category:appId==='resource-manager'?'system':appId==='office-one'?'component':'application',domain:appId==='office-one'?'Office 文档':appId==='resource-manager'?'资源管理':'文件管理',boundary:path.endsWith('/auth/me')?'self':'business',auth:'统一身份应用令牌；写入须 CSRF；本人资源权限',summary:op.summary,method:op.method,path,source:await source(file,needle),note:'已有提供方契约；实际登记版本及启用状态以所选环境服务库为准。'});
  }
}
async function manual(provider,appIds,category,domain,boundary,auth,file,rows,note='保留提供方处理器与认证边界；台账登记不自动启用代理。'){
  for(const [method,path,needle,summary] of rows)add({provider,appIds,category,domain,boundary,auth,summary:summary||domain+' · '+method+' '+path,method,path,source:await source(file,needle),note});
}
await manual('files',['files'],'application','运行健康','probe','公开','mg-files-one/server/http.ts',[['GET','/health',"path === '/health'"]]);
await manual('resource-manager',['resource-manager'],'system','运行健康','probe','公开','mg-resource-one/server/http.ts',[['GET','/health',"path==='/health'"]]);
await manual('files',['office-one'],'component','Office 集成','machine','会话签名令牌；回调校验 ONLYOFFICE 签名','mg-files-one/server/office.ts',[
  ['GET','/integrations/office/{id}/document',"match[2] === 'document'"],['POST','/integrations/office/{id}/callback',"match[2] !== 'callback'"]]);
await manual('onlyoffice',['office-one'],'engine','Office 命令','machine','ONLYOFFICE JWT','mg-files-one/server/office.ts',[
  ['POST','/coauthoring/CommandService.ashx','/coauthoring/CommandService.ashx']], '外部依赖调用；地址来自 Office 配置，保持签名机器协议。');
const platform='mg-platform-kernel/src/main/java/com/metagravity/desktop/PlatformController.java';
await manual('platform-kernel',[],'system','运行健康','probe','公开',platform,[['ANY','/api/health','if(path.equals("/api/health"))']]);
await manual('platform-kernel',[],'system','桌面登录','identity','PKCE、状态 Cookie 与统一身份',platform,[['GET','/auth/start','if(path.equals("/auth/start")'],['GET','/auth/callback','if(path.equals("/auth/callback")']]);
await manual('platform-kernel',['personal-center'],'system','本人桌面状态','platform','桌面用户会话；写入须 CSRF',platform,[
  ['GET','/api/session','if(path.equals("/api/session")'],['POST','/auth/logout','if(path.equals("/auth/logout")'],['POST','/auth/renew','if(path.equals("/auth/renew")'],
  ...['GET','PUT'].map(m=>[m,'/api/preferences','if(path.equals("/api/preferences"))']),...['GET','PUT','DELETE'].map(m=>[m,'/api/preferences/wallpaper','if(path.equals("/api/preferences/wallpaper")) {']),...['GET','POST','PATCH','DELETE'].map(m=>[m,'/api/notifications','if(path.equals("/api/notifications"))'])]);
await manual('platform-kernel',['app-manager'],'system','应用管理','platform','应用管理授权；系统应用只读，外部应用归本人',platform,[
  ...['GET','POST'].map(m=>[m,'/api/applications','if(path.equals("/api/applications") ||']),...['PUT','DELETE'].map(m=>[m,'/api/applications/{id}','if(path.equals("/api/applications") ||'])]);
const registry='mg-platform-kernel/src/main/java/com/metagravity/desktop/ServiceRegistryController.java';
await manual('platform-kernel',['service-manager'],'system','服务中心','platform','服务管理应用授权；管理写操作须管理员角色与 CSRF',registry,[
  ['GET','/api/service-registry','path.equals("/api/service-registry")'],['GET','/api/service-registry/insights','path.equals("/api/service-registry/insights")'],
  ...['GET','POST'].map(m=>[m,'/api/service-registry/workspace','path.equals("/api/service-registry/workspace")']),
  ...['publications','activation','lifecycle'].map(p=>['POST','/api/service-registry/'+p,'path.equals("/api/service-registry/'+p+'")'])]);
await manual('platform-kernel',['service-manager'],'system','API 台账','platform','服务管理授权及管理员角色；写入须 CSRF',registry,['GET','POST'].map(m=>[m,'/api/service-registry/api-inventory','path.equals("/api/service-registry/api-inventory")']));
await manual('platform-kernel',['service-manager'],'system','应用网关','platform','目标应用 audience、路径白名单与服务状态','mg-platform-kernel/src/main/java/com/metagravity/desktop/ApplicationGateway.java',[
  ['ANY','/api/apps/{appId}/{path*}','^/api/apps/'],['ANY','/api/services/apps/{appId}/{path*}','^/api/services/apps/'],['ANY','/api/services/invoke/{serviceId}/{operationId}','^/api/services/invoke/']], '网关路由模板；实际方法由目标应用策略与服务操作限制，禁止递归自代理。');
// 从真实 OIDC Provider 的路由栈提取已启用协议（包括库添加的 OPTIONS）。
const {default:Provider}=await import(pathToFileURL(join(workspace,'mg-auth-one-identity/node_modules/oidc-provider/lib/index.js')).href);
const {default:Router}=await import(pathToFileURL(join(workspace,'mg-auth-one-identity/node_modules/oidc-provider/lib/helpers/router.js')).href);
const protocolRoutes=[],originals=new Map();
for(const method of ['get','post','put','delete','options']){
  originals.set(method,Router.prototype[method]);Router.prototype[method]=function(name,path,...middleware){protocolRoutes.push({method:method.toUpperCase(),path});return originals.get(method).call(this,name,path,...middleware);};
}
try{new Provider('http://127.0.0.1',{clients:[],features:{devInteractions:{enabled:false},clientCredentials:{enabled:true},revocation:{enabled:true}}});}
finally{for(const [method,original] of originals)Router.prototype[method]=original;}
const oidcFile='mg-auth-one-identity/src/oidc.mjs';
for(const layer of protocolRoutes){
  const methods=[layer.method];
  const path=layer.path.replace(/:([A-Za-z0-9_]+)/g,'{$1}');
  for(const method of methods)await manual('identity',['identity'],'system','OIDC 标准协议','identity','OIDC 协议；公开发现与 JWKS，其余按端点校验会话或客户端凭据',oidcFile,[[method,path,'new Provider(']],'来自当前安装 oidc-provider 的启用路由栈；HEAD 为 GET 的框架隐式行为。');
}
const oidcText=await readFile(join(workspace,oidcFile),'utf8');
const pages=oidcText.match(/const pages = (\[[^;]+\]);/);assert(pages,'OIDC 页面声明缺失');
const ts=(await import('typescript')).default;
const pageAst=ts.createSourceFile('pages.ts','const pages='+pages[1],ts.ScriptTarget.Latest,true);
const pageList=pageAst.statements[0].declarationList.declarations[0].initializer;
for(const item of pageList.elements){assert(ts.isStringLiteral(item));await manual('identity',['identity'],'system','页面资源','asset','公开页面壳；数据接口独立鉴权',oidcFile,[['GET',item.text,'const pages =']]);}
assert(scan.unresolved.every(r=>r.kind==='dynamic-server-route'&&r.source.replaceAll('\\','/')===oidcFile),'存在未处理动态路由');
gaps.push({provider:'security-one',description:'规划项目，没有实现后端或 API，不伪造登记条目。'},
  {provider:'all',description:'台账覆盖当前源码显式路由及 OIDC 已启用路由栈；框架隐式 HEAD/CORS、静态资源文件枚举不逐条计数。台账不是完整 OpenAPI，缺契约的业务接口尚不能切换为仅允许已登记操作的代理策略。'});
entries.sort((a,b)=>a.provider.localeCompare(b.provider)||a.path.localeCompare(b.path)||a.method.localeCompare(b.method));
const document={schemaVersion:1,categories,boundaries,entries,gaps};
const output=join(root,'registrations/api-inventory.json'),serialized=JSON.stringify(document,null,2)+'\n';
if(process.argv.includes('--check'))assert.equal(await readFile(output,'utf8'),serialized,'登记包与源码不一致，请重新生成');
else {await mkdir(join(root,'registrations'),{recursive:true});await writeFile(output,serialized);}
const summary={entries:entries.length,providers:new Set(entries.map(e=>e.provider)).size,categories:Object.fromEntries(categories.map(c=>[c.name,entries.filter(e=>e.category===c.id).length])),boundaries:Object.fromEntries(boundaries.map(c=>[c.name,entries.filter(e=>e.boundary===c.id).length]))};
if(!process.argv.includes('--check'))await writeFile(join(root,'docs/api-inventory-registration.md'),[
  '# API 全量登记与分类','','登记包由 `node scripts/build-api-inventory.mjs` 生成，使用 `--check` 校验源码漂移。运行时只读取服务库，不从此文件或源码扫描回退。',
  '',`共 ${summary.entries} 条入口，${summary.providers} 个提供方。类别与认证边界分别保存；页面/资源单独统计，避免将页面数算作业务 API 数。`,'',
  '| 类别 | 数量 |','| --- | ---: |',...Object.entries(summary.categories).map(([k,v])=>`| ${k} | ${v} |`),'',
  '| 边界 | 数量 |','| --- | ---: |',...Object.entries(summary.boundaries).map(([k,v])=>`| ${k} | ${v} |`),'',
  '| 提供方 | 类别 | 领域 | 认证边界 | 方法与路径 |','| --- | --- | --- | --- | --- |',...entries.map(e=>`| ${e.provider} | ${categories.find(c=>c.id===e.category).name} | ${e.domain} | ${boundaries.find(c=>c.id===e.boundary).name} | ${e.method} ${e.path} |`),'',
  '## 范围与状态','',...gaps.map(g=>'- '+g.provider+'：'+g.description),'',
  '登记是元数据持久化；服务版本、契约、启用状态在读取时关联服务库。禁止把台账条目直接当作网关白名单或自动发布依据。现有版本保持不变。',
  '','## 入库','',
  '先执行 `service-storage api-inventory-schema`，再执行 `service-storage api-inventory-import <登记包>`；连接和环境只从私密环境变量读取。',
  '全量台账跨环境共享；所选环境只影响关联服务版本的启用状态。导入使用事务锁、内容摘要与历史修订保存；HTTP 导入另需 expectedRevision、服务管理权限、管理员角色与 CSRF。',''].join('\n'));
console.log(JSON.stringify(summary,null,2));
