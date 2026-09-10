import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {chromium} from '@playwright/test';
const root=resolve(import.meta.dirname,'..'),work=join(root,'.runtime/api-inventory-ui');await mkdir(work,{recursive:true});
const account=JSON.parse(await readFile(join(root,'.runtime/local/account.json'),'utf8'));
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext(),page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));
try{
  const issuer='http://127.0.0.1:14200';
  const login=await context.request.post(issuer+'/api/auth/login',{data:account,headers:{origin:issuer}});assert.equal(login.status(),200,'本地登录失败');
  const sessionCookie=(await context.cookies(issuer)).find(c=>c.name==='mg_identity_session');assert(sessionCookie,'本地会话未建立');
  await context.addCookies([{name:'mg_desktop_token',value:sessionCookie.value,domain:'127.0.0.1',path:'/',httpOnly:true,sameSite:'Lax'}]);
  const response=await context.request.get('http://127.0.0.1:14380/api/service-registry/api-inventory');assert.equal(response.status(),200);const inventory=await response.json();
  const expected=JSON.parse(await readFile(join(root,'registrations/api-inventory.json'),'utf8'));assert.equal(inventory.document.entries.length,expected.entries.length);
  assert(inventory.document.entries.every(e=>e.category&&e.boundary&&e.auth));
  const linked=inventory.document.entries.filter(e=>e.registrations.length);assert(linked.length>=29,'已有 29 项服务契约必须全部关联');
  await writeFile(join(work,'inventory-response.json'),JSON.stringify(inventory,null,2));
  for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
    await page.setViewportSize(viewport);await page.goto('http://127.0.0.1:14381/services');
    await page.getByRole('tab',{name:'全量 API 台账',exact:true}).click();
    await page.getByText('全量台账 '+expected.entries.length+' 条',{exact:false}).waitFor();
    const search=page.getByRole('textbox',{name:'搜索全量 API'});await search.fill('不存在的验证路径');await page.getByText('暂无符合条件的登记 API',{exact:true}).waitFor();
    await search.fill('/api/admin/models');await page.getByRole('button',{name:/模型目录 · GET \/admin\/models$/,exact:false}).click();
    const drawer=page.getByRole('dialog',{name:'API 登记详情'});await drawer.getByText('token-one-console',{exact:true}).waitFor();await drawer.getByText('控制台 audience 与管理员权限',{exact:true}).waitFor();await page.keyboard.press('Escape');await drawer.waitFor({state:'hidden'});
    await search.fill('');
    await page.getByRole('combobox',{name:'API 类别',exact:true}).press('Enter');await page.getByRole('option',{name:'数据服务',exact:true}).click();
    await page.getByText('当前 80 条',{exact:false}).waitFor();
    await page.screenshot({path:join(work,viewport.width+'-filtered.png'),fullPage:true});
    await page.getByRole('combobox',{name:'API 类别',exact:true}).press('Enter');await page.getByRole('option',{name:'系统服务',exact:true}).click();
    await page.getByRole('button',{name:'刷新台账',exact:true}).click();await page.getByText('全量台账 '+expected.entries.length+' 条',{exact:false}).waitFor();
    await page.screenshot({path:join(work,viewport.width+'.png'),fullPage:true});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'页面横向溢出');
  }
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'导出台账',exact:true}).click();const download=await downloadPromise;assert(download.suggestedFilename().startsWith('api-inventory-r'));
  // 错误与空态只替换此页的读取请求，实际数据库保持不变。
  await page.route('**/api/service-registry/api-inventory?*',route=>route.fulfill({status:503,json:{message:'台账读取验证错误'}}));
  await page.getByRole('button',{name:'刷新台账',exact:true}).click();await page.getByRole('alert').filter({hasText:'台账读取验证错误'}).waitFor();
  await page.unroute('**/api/service-registry/api-inventory?*');
  await page.route('**/api/service-registry/api-inventory?*',route=>route.fulfill({json:{...inventory,document:{...inventory.document,entries:[]}}}));
  await page.getByRole('button',{name:'刷新台账',exact:true}).click();await page.getByText('暂无符合条件的登记 API',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  const result={passed:true,entries:expected.entries.length,linked:linked.length,revision:inventory.revision,url:'http://127.0.0.1:14381/services',checks:['实际本地身份登录与数据库台账读取','桌面和手机布局','分类及路径筛选','控制台授权归属详情','刷新','导出','空态与失败态'],errorStates:'仅错误与空态使用浏览器响应替身'};
  await writeFile(join(work,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,evidence:work},null,2));
}finally{await context.close();await browser.close();}
