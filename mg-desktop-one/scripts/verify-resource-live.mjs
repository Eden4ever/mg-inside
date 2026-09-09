import {readFile,mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {parseEnv} from 'node:util';
import {createRequire} from 'node:module';
import {chromium} from '@playwright/test';
const origin='http://127.0.0.1:4301',account=JSON.parse(await readFile('.runtime/local/account.json','utf8'));
const env=parseEnv(await readFile('.runtime/local/identity.env','utf8')),dburl=new URL(env.DATABASE_URL);
assert.equal(dburl.searchParams.get('schema'),'mg_desktop_local_identity');assert(['127.0.0.1','localhost'].includes(dburl.hostname));
const Prisma=createRequire(new URL('../../mg-auth-one-identity/package.json',import.meta.url))('@prisma/client').PrismaClient;
const db=new Prisma({datasources:{db:{url:env.DATABASE_URL}}});
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
await mkdir('.runtime/resource-live',{recursive:true});
let membership;
try{
 await page.goto('http://127.0.0.1:14371/pools');
 await page.getByRole('textbox',{name:'登录账号',exact:true}).fill(account.username);
 await page.getByRole('textbox',{name:'登录密码',exact:true}).fill(account.password);
 await page.getByRole('button',{name:'登 录',exact:true}).click();
 await page.waitForURL('http://127.0.0.1:14371/pools');
 await page.getByRole('heading',{name:'平台生产资源池',exact:true}).waitFor();
 const cookies=await page.context().cookies();assert.equal(cookies.find(c=>c.name==='mg_desktop_token').value,cookies.find(c=>c.name==='mg_identity_session').value);
 const session=await (await page.request.get(origin+'/api/session')).json();assert(session.apps.some(a=>a.id==='resource-manager'));
 let data=await (await page.request.get(origin+'/api/apps/resource-manager/overview')).json();assert.equal(data.resources.length,2);
 for(const resource of data.resources){const r=await page.request.post(`${origin}/api/apps/resource-manager/resources/${resource.id}/refresh`,{headers:{Origin:origin,'X-CSRF-Token':session.csrfToken},data:{}});assert.equal(r.status(),200);const result=await r.json(),updated=result.resources.find(x=>x.id===resource.id);assert.equal(updated.observation.error,null);assert.equal(updated.stale,false);assert(updated.observation.snapshot.cpuCount>0);}
 await page.getByRole('button',{name:'刷新视图',exact:true}).click();await page.screenshot({path:'.runtime/resource-live/standalone.png'});
 await page.goto(origin);await page.getByRole('button',{name:'所有应用',exact:true}).click();await page.getByRole('button',{name:'启动资源管理',exact:true}).click();
 const frame=page.frameLocator('iframe[title="资源管理"]');await frame.getByRole('heading',{name:'平台生产资源池',exact:true}).waitFor();
 assert.equal(await frame.locator('.app-header').isVisible(),false);await page.screenshot({path:'.runtime/resource-live/desktop.png'});
 const user=await db.user.findUniqueOrThrow({where:{username:account.username}});const key={clientId_userId:{clientId:'resource-manager',userId:user.id}};
 membership=await db.applicationUser.findUniqueOrThrow({where:key});await db.applicationUser.update({where:key,data:{enabled:false}});
 const denied=(await page.request.get(origin+'/api/apps/resource-manager/overview')).status();assert([401,403].includes(denied));
 assert([401,403].includes((await page.request.post(origin+'/api/apps/resource-manager/resources/'+data.resources[0].id+'/refresh',{headers:{Origin:origin},data:{}})).status()));
 assert.deepEqual(errors,[]);await writeFile('.runtime/resource-live/result.json',JSON.stringify({realSso:true,sameToken:true,realSshHosts:2,standalone:true,desktop:true,revocation:denied,errors},null,2));
 console.log('真实 SSO、同一令牌、两台 SSH 实时采集、浏览器直访、桌面嵌入和撤权拒绝均通过。');
}catch(e){await page.screenshot({path:'.runtime/resource-live/failure.png'});throw e}finally{if(membership)await db.applicationUser.update({where:{clientId_userId:{clientId:membership.clientId,userId:membership.userId}},data:{enabled:membership.enabled}});await db.$disconnect();await browser.close()}
