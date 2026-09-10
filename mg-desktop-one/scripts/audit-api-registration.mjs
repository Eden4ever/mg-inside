import {readFile,writeFile,readdir} from 'node:fs/promises';
import {resolve,relative,join} from 'node:path';
import ts from 'typescript';

const root=resolve(import.meta.dirname,'..'), workspace=resolve(root,'..');
const catalog=JSON.parse(await readFile(join(workspace,'mg-platform/packages/frontend/services/catalog.json'),'utf8'));
const targets=[
  {appId:'identity',path:'mg-auth-one-identity/src',prefix:'/api'},
  {appId:'expert-database',path:'mg-expert-database/apps/api/src',prefix:'/api'},
  {appId:'token-one',path:'mg-token-one/mg-gateway/apps/gateway/src',prefix:''},
];
const routes=[],unresolved=[];
const normalize=path=>('/'+path.split('/').filter(Boolean).join('/')).replace(/:([A-Za-z0-9_]+)/g,'{$1}');
const shape=path=>path.replace(/\{[^}]+\}/g,'{}');
const decorators=node=>(ts.canHaveDecorators(node)?ts.getDecorators(node):[])||[];
function strings(node){
  if(!node)return [''];
  if(ts.isStringLiteralLike(node))return [node.text];
  if(ts.isArrayLiteralExpression(node)){const values=node.elements.map(strings);return values.every(Boolean)?values.flat():null;}
  return null;
}
function decoration(node,name){return decorators(node).map(d=>d.expression).find(e=>ts.isCallExpression(e)&&ts.isIdentifier(e.expression)&&e.expression.text===name);}
async function files(dir){const result=[];for(const entry of await readdir(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory())result.push(...await files(path));else if(/\.(ts|mjs)$/.test(entry.name)&&!/(\.spec|\.test|\.d)\.ts$/.test(entry.name))result.push(path);}return result;}
function add(target,source,node,method,path){
  const fullPath=normalize(path),apiPath=fullPath.startsWith('/api/')?fullPath.slice(4):fullPath;
  const registrations=catalog.filter(s=>s.appId===target.appId).flatMap(s=>s.operations.filter(o=>o.method===method&&shape(o.path)===shape(apiPath)).map(o=>({serviceId:s.serviceId,version:s.version,operationId:o.operationId})));
  let boundary='business';
  if(/^\/(?:api\/)?health(?:\/|$)/.test(fullPath))boundary='probe';
  else if(fullPath.startsWith('/v1/'))boundary='external-protocol';
  else if(fullPath.startsWith('/assets/'))boundary='asset';
  else if(/^\/(?:api\/)?(?:unified|directory|interaction)(?:\/|$)/.test(fullPath)||apiPath.startsWith('/auth/')&&!/^\/auth\/(?:me(?:\/|$)|change-password$)/.test(apiPath))boundary='identity-protocol';
  const appId=target.appId==='token-one'&&apiPath.startsWith('/admin/')?'token-one-console':target.appId;
  routes.push({provider:target.appId,appId,method,path:fullPath,boundary,registrations,
    disposition:registrations.length?'registered':boundary==='business'?'register-operation':boundary==='asset'?'exclude-asset':'register-protocol-metadata',
    source:relative(workspace,source.fileName).replaceAll('\\','/'),line:source.getLineAndCharacterOfPosition(node.getStart(source)).line+1});
}
for(const target of targets){
  for(const filename of await files(join(workspace,target.path))){
    const source=ts.createSourceFile(filename,await readFile(filename,'utf8'),ts.ScriptTarget.Latest,true,filename.endsWith('.mjs')?ts.ScriptKind.JS:ts.ScriptKind.TS);
    function visit(node){
      if(ts.isClassDeclaration(node)){
        const controller=decoration(node,'Controller');
        if(controller){
          const bases=strings(controller.arguments[0]);
          if(!bases)unresolved.push({source:relative(workspace,filename),kind:'controller'});
          for(const member of node.members){
            for(const decorator of decorators(member)){
              const call=decorator.expression;
              if(!ts.isCallExpression(call)||!ts.isIdentifier(call.expression)||!['Get','Post','Put','Patch','Delete','Head','Options','All'].includes(call.expression.text))continue;
              const paths=strings(call.arguments[0]);
              if(!bases||!paths){unresolved.push({source:relative(workspace,filename),kind:'method'});continue;}
              for(const base of bases)for(const path of paths)add(target,source,decorator,call.expression.text.toUpperCase(),[target.prefix,base,path].join('/'));
            }
          }
        }
      }
      if(filename.endsWith('.mjs')&&ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.expression.getText(source)==='server'&&['get','post','put','patch','delete'].includes(node.expression.name.text)){
        const paths=strings(node.arguments[0]);
        if(paths)for(const path of paths)add(target,source,node,node.expression.name.text.toUpperCase(),path);
        else unresolved.push({source:relative(workspace,filename),kind:'dynamic-server-route'});
      }
      ts.forEachChild(node,visit);
    }
    visit(source);
  }
}
routes.sort((a,b)=>a.provider.localeCompare(b.provider)||a.path.localeCompare(b.path)||a.method.localeCompare(b.method));
const summary=targets.map(t=>{const found=routes.filter(r=>r.provider===t.appId);return {appId:t.appId,routes:found.length,registered:found.filter(r=>r.registrations.length).length,missingBusiness:found.filter(r=>r.disposition==='register-operation').length,protocolOrProbe:found.filter(r=>r.disposition==='register-protocol-metadata').length};});
const evidence={schemaVersion:1,scope:'源码路由声明与发布初始清单的静态核对；不代表运行库或生产覆盖率',summary,unresolved,routes};
await writeFile(join(root,'docs/api-registration-inventory.json'),JSON.stringify(evidence,null,2)+'\n');
const labels={'registered':'已有登记包','register-operation':'待补服务操作','register-protocol-metadata':'待补协议或探针目录','exclude-asset':'静态资源'};
const lines=['# API 登记逐项清单','','由 `node scripts/audit-api-registration.mjs` 生成。扫描 Nest 控制器及身份服务显式 Fastify 路由；动态库路由、文件/Office/资源的原生 HTTP 分支、平台内核和低空驾驶舱见主审计报告。这里的“已有登记包”不是运行数据库已发布证明。','','| 提供方 | 源码路由 | 已有登记包 | 待补业务操作 | 协议与探针 |','| --- | ---: | ---: | ---: | ---: |',...summary.map(s=>`| ${s.appId} | ${s.routes} | ${s.registered} | ${s.missingBusiness} | ${s.protocolOrProbe} |`),'','| 提供方 | 方法与路径 | 结论 | 登记操作 | 源码 |','| --- | --- | --- | --- | --- |',...routes.map(r=>`| ${r.provider} | \`${r.method} ${r.path}\` | ${labels[r.disposition]} | ${r.registrations.map(s=>s.serviceId+' / '+s.operationId).join(', ')||'-'} | [${r.source}:${r.line}](${join(workspace,r.source).replaceAll('\\','/')}:${r.line}) |`),'','## 扫描边界','',...unresolved.map(r=>`- ${r.source.replaceAll('\\','/')}：${r.kind}，需要人工核对。`),'','本清单不会自动生成空泛响应 Schema、发布服务、改变授权或修改业务数据库。补登记必须提供真实请求/响应契约，并验证当前调用方 audience。',''];
await writeFile(join(root,'docs/api-registration-inventory.md'),lines.join('\n'));
console.log(JSON.stringify({summary,unresolved:unresolved.length,evidence:'docs/api-registration-inventory.json'},null,2));
