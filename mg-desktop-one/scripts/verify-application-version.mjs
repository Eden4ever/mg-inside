import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
const origin='http://127.0.0.1:4301',api='http://127.0.0.1:'+(process.env.DESKTOP_TEST_PORT||'4302');
const account=JSON.parse(await readFile(new URL('../.runtime/local/account.json',import.meta.url),'utf8'));
const browser=await chromium.launch({channel:'chrome',headless:true});
let page,original,headers;
const path=api+'/api/applications/app-manager';
const body=(item,version)=>Object.assign(Object.fromEntries(['name','description','developer','icon','minWidth','minHeight','defaultMaximized'].map(key=>[key,item[key]])),{registeredVersion:version,expectedRevision:item.revision});
try {
 page=await browser.newPage({viewport:{width:1440,height:960}});
 if(!api.endsWith(':4300'))await page.route(origin+'/api/**',async route=>{try{const response=await route.fetch({url:route.request().url().replace(origin,api)});await route.fulfill({response});}catch{await route.abort().catch(()=>{});}});
 await page.goto(origin);
 await page.getByPlaceholder('请输入账号').fill(account.username);await page.getByPlaceholder('请输入密码').fill(account.password);
 await page.getByRole('button',{name:/^登\s*录$/}).click();await page.getByRole('button',{name:'打开应用管理',exact:true}).first().waitFor();
 const session=await (await page.request.get(api+'/api/session')).json();headers={Origin:origin,'X-CSRF-Token':session.csrfToken};
 original=await (await page.request.get(path)).json();assert.equal(typeof original.registeredVersion,'string');
 await page.getByRole('button',{name:'打开应用管理',exact:true}).first().click();
 const frame=page.frameLocator('iframe').last();await frame.getByRole('button',{name:'编辑应用管理',exact:true}).click();
 const editor=page.frameLocator('iframe').last();
 await editor.getByRole('textbox',{name:'当前版本',exact:true}).fill('2.3.4-test');
 await editor.getByRole('button',{name:'保存修改',exact:true}).click();
 await expect.poll(async()=> (await (await page.request.get(path)).json()).version).toBe('2.3.4-test');
 const saved=await (await page.request.get(path)).json();assert.equal(saved.registeredVersion,'2.3.4-test');
 assert.equal((await page.request.patch(path,{headers,data:body(original,'stale')})).status(),409);
 assert.equal((await page.request.patch(path,{headers,data:body(saved,'x'.repeat(65))})).status(),400);
 assert.equal((await page.request.patch(path,{headers:{...headers,'X-CSRF-Token':'invalid'},data:body(saved,'denied')})).status(),401);
 await expect(page.locator('iframe')).toHaveCount(1,{timeout:30000});
 await page.frameLocator('iframe').first().getByRole('button',{name:'编辑应用管理',exact:true}).click();
 const reopened=page.frameLocator('iframe').last();await expect(reopened.getByRole('textbox',{name:'当前版本',exact:true})).toHaveValue('2.3.4-test',{timeout:30000});
 await mkdir('.runtime/application-version',{recursive:true});await page.screenshot({path:'.runtime/application-version/editor.png'});
 await reopened.getByRole('textbox',{name:'当前版本',exact:true}).fill('');await reopened.getByRole('button',{name:'保存修改',exact:true}).click();
 await expect.poll(async()=> (await (await page.request.get(path)).json()).registeredVersion).toBe('');
 const cleared=await (await page.request.get(path)).json();const published=await (await page.request.get(original.entryUrl+'/version.json')).json();assert.equal(cleared.version,published.version);
 console.log('页面填写、重新打开回显、清空后发布版本回退、修订冲突、长度和 CSRF 校验通过。');
} catch(error) {
 await mkdir('.runtime/application-version',{recursive:true});
 await page?.screenshot({path:'.runtime/application-version/failure.png'});
 for(const frame of page?.frames()||[])console.log(JSON.stringify({url:frame.url().split('?')[0],text:(await frame.locator('body').innerText().catch(()=>'' )).slice(0,1600)}));
 throw error;
} finally {
 if(original&&headers){const current=await (await page.request.get(path)).json();const restored=await page.request.patch(path,{headers,data:body(current,original.registeredVersion)});assert.equal(restored.status(),200);console.log('测试版本已恢复。');}
 await page?.unrouteAll({behavior:'ignoreErrors'});await browser.close();
}
