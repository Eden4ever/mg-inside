import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFile,mkdir} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {PrismaClient} from '@prisma/client';
import {hashPassword} from '../dist/password.js';
import {chromium} from '../web/node_modules/playwright-core/index.mjs';
test('本机桌面：两类范围管理员入口、应用授权与撤权即时校验',async()=>{
 const settings=parseEnv(await readFile(new URL('../../mg-desktop-one/.runtime/local/identity.env',import.meta.url),'utf8'));
 const url=new URL(settings.DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.searchParams.get('schema'),'mg_desktop_local_identity');
 const db=new PrismaClient({datasourceUrl:url.href}),password=randomBytes(24).toString('base64url'),suffix=randomBytes(6).toString('hex');
 const backend=process.env.SCOPED_DESKTOP_PORT||'4300',origin='http://127.0.0.1:4301';
 let user,division,organization,browser;
 try{
  user=await db.user.create({data:{username:'scope-verify-'+suffix,displayName:'范围验收'+suffix,passwordHash:await hashPassword(password)}});
  division=await db.division.create({data:{name:'范围验收区划',code:'TEST-'+suffix,standard:false}});
  organization=await db.organization.create({data:{name:'范围验收机构',creditCode:'TEST'+suffix,divisionId:division.id}});
  await db.userOrganization.create({data:{userId:user.id,organizationId:organization.id,isPrimary:true}});
  await db.applicationUser.create({data:{userId:user.id,clientId:'identity',enabled:true}});
  browser=await chromium.launch({channel:'chrome',headless:true});
  for(const kind of ['division','organization']){
   const role=await db.role.findUniqueOrThrow({where:{key:kind+'-admin'}});
   await db.userRole.create({data:{userId:user.id,roleId:role.id}});
   const scope=await db.managementScope.create({data:{[kind+'Id']:kind==='division'?division.id:organization.id,administrators:{create:{userId:user.id}},applications:{create:{clientId:'app-manager'}}}});
   const context=await browser.newContext({viewport:{width:1440,height:960}}),page=await context.newPage();
   if(backend!=='4300')await page.route(origin+'/api/**',async route=>{try{const response=await route.fetch({url:route.request().url().replace(':4301',':'+backend)});await route.fulfill({response});}catch{await route.abort().catch(()=>{});}});
   await page.goto(origin);await page.getByPlaceholder('请输入账号').fill(user.username);await page.getByPlaceholder('请输入密码').fill(password);await page.getByRole('button',{name:/^登\s*录$/}).click();
   await page.getByRole('button',{name:/打开统一身份/}).first().click();
   const frame=page.frameLocator('iframe').last();await frame.getByRole('heading',{name:'范围应用权限',exact:true}).waitFor();
   assert.equal(await frame.getByRole('button',{name:'保存范围配置',exact:true}).count(),0);
   await frame.getByRole('textbox',{name:'搜索范围成员',exact:true}).waitFor();
   const sw=frame.locator('.el-switch').first();
   await Promise.all([page.waitForResponse(r=>r.url().includes('/scopes/'+scope.id+'/applications/')&&r.request().method()==='PUT'),sw.click()]);
   const api='http://127.0.0.1:'+backend;
   const session=await (await page.request.get(api+'/api/session')).json();assert(session.apps.some(a=>a.id==='identity'));assert(session.apps.some(a=>a.id==='app-manager'));
   assert.equal((await page.request.get(api+'/api/apps/identity/users')).status(),403);
   assert.equal((await page.request.get(api+'/api/apps/app-manager/auth/me')).status(),200);
   await db.userRole.deleteMany({where:{userId:user.id}});
   assert.equal((await page.request.get(api+'/api/apps/identity/scopes')).status(),403);
   const revoked=await (await page.request.get(api+'/api/session')).json();assert(!revoked.apps.some(a=>a.id==='identity'));
   await mkdir('.runtime/geography-verification',{recursive:true});await page.screenshot({path:'.runtime/geography-verification/desktop-'+kind+'-admin.png'});
   await context.close();await db.managementScope.delete({where:{id:scope.id}});
  }
 }finally{
  await browser?.close();
  if(user){await db.applicationUser.deleteMany({where:{userId:user.id}});await db.user.delete({where:{id:user.id}});}
  if(organization)await db.organization.delete({where:{id:organization.id}});
  if(division)await db.division.delete({where:{id:division.id}});
  await db.$disconnect();
 }
});
