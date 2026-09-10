import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from '../web/node_modules/playwright-core/index.mjs';

const origin='http://127.0.0.1:4301',api='http://127.0.0.1:'+(process.env.SCOPED_DESKTOP_PORT||'4300');
const account=JSON.parse(await readFile(new URL('../../mg-desktop-one/.runtime/local/account.json',import.meta.url),'utf8'));
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage();
 await page.route(origin+'/api/**',async route=>{
  const response=await route.fetch({url:route.request().url().replace(origin,api)});
  await route.fulfill({response});
 });
 await page.goto(origin);
 await page.getByPlaceholder('请输入账号').fill(account.username);
 await page.getByPlaceholder('请输入密码').fill(account.password);
 await page.getByRole('button',{name:/^登\s*录$/}).click();
 await page.getByRole('button',{name:/打开统一身份/}).first().waitFor();
 const session=await (await page.request.get(api+'/api/session')).json();
 const response=await page.request.get(api+'/api/service-registry');
 assert.equal(response.status(),200);
 const registry=await response.json();
 const services=registry.items.filter(item=>/^(identity\.(management|self)-|personal-center\.self-)/.test(item.manifest.serviceId));
 if(process.argv.includes('--activate')) {
  assert(registry.canManage);
  for(const service of services) {
   if(service.activeVersion)continue;
   const result=await page.request.post(api+'/api/service-registry/activation',{
    headers:{Origin:origin,'X-CSRF-Token':session.user?.csrfToken||session.profile?.csrfToken||session.csrfToken},
    data:{serviceId:service.manifest.serviceId,version:service.manifest.version,expectedRevision:service.activeRevision}
   });
   assert.equal(result.status(),200,service.manifest.serviceId+': '+await result.text());
   console.log('已启用 '+service.manifest.serviceId);
  }
 }
 for(const path of ['/users','/roles','/applications','/divisions','/organizations','/scopes','/mail-settings','/login-attempts','/applications/mine','/account-security']) {
  const result=await page.request.get(api+'/api/apps/identity'+path);
  assert.equal(result.status(),200,path+': '+await result.text());
  console.log('接口通过 '+path);
 }
 for(const app of session.apps) {
  const old=await page.request.get('http://127.0.0.1:4300/api/apps/'+app.id+'/auth/me');
  const current=await page.request.get(api+'/api/apps/'+app.id+'/auth/me');
  console.log(JSON.stringify({app:app.id,previous:old.status(),current:current.status()}));
  if(old.status()===200)assert.equal(current.status(),200,app.id+' 会话入口回退');
 }
} finally {await browser.close();}
