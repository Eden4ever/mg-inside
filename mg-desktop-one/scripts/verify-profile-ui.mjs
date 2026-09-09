import { chromium } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const account=JSON.parse(await readFile('.runtime/local/account.json','utf8'));
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
let notificationId;
async function login(url) {
  await page.goto(url);
  await page.getByRole('textbox',{name:'登录账号',exact:true}).fill(account.username);
  await page.getByRole('textbox',{name:'登录密码',exact:true}).fill(account.password);
  await page.getByRole('button',{name:'登 录',exact:true}).click();
}
async function notifications(method,body) {
  return page.evaluate(async ({method,body})=>{
    const session=await (await fetch('http://127.0.0.1:4301/api/session',{credentials:'include'})).json();
    const response=await fetch('http://127.0.0.1:4301/api/notifications',{method,credentials:'include',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrfToken},...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,data:await response.json()};
  },{method,body});
}
try {
  await login('http://127.0.0.1:4301/');
  await page.getByRole('button',{name:'个人账号',exact:true}).click();
  const personal=page.frameLocator('iframe[title="个人中心"]');
  await personal.getByRole('heading',{name:'个人资料',exact:true}).waitFor();
  await personal.getByRole('button',{name:'退出登录',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'桌面设置',exact:true}).count(),0);
  assert.equal(await page.locator('.menu-bar .brand img').evaluate(img=>img.complete&&img.naturalWidth>0),true);
  const created=await notifications('POST',{text:'通知接口联调验证',appId:'personal-center'});
  assert.equal(created.status,201); notificationId=created.data.items[0].id;
  await page.getByRole('button',{name:'通知中心',exact:true}).click();
  await personal.getByRole('heading',{name:'通知中心',exact:true}).waitFor();
  await personal.getByRole('button',{name:'标记已读：通知接口联调验证',exact:true}).click();
  await personal.getByRole('button',{name:'标记已读：通知接口联调验证',exact:true}).waitFor({state:'detached'});
  const read=await notifications('GET'); assert.equal(read.data.items.find(item=>item.id===notificationId).read,true);
  await notifications('DELETE',{id:notificationId}); notificationId=undefined;
  await page.getByRole('button',{name:'个人账号',exact:true}).click();
  await personal.getByRole('heading',{name:'个人资料',exact:true}).waitFor();
  assert.equal(await page.locator('iframe[title="个人中心"]').count(),1);
  await mkdir('.runtime/profile-ui',{recursive:true}); await page.screenshot({path:'.runtime/profile-ui/profile.png'});
  page.once('dialog',dialog=>dialog.accept());
  await personal.getByRole('button',{name:'退出登录',exact:true}).click();
  await page.getByRole('textbox',{name:'登录账号',exact:true}).waitFor();
  assert.equal((await page.request.get('http://127.0.0.1:4301/api/session')).status(),401);
  await writeFile('.runtime/profile-ui/result.json',JSON.stringify({passed:true,checks:['头像直接打开及复用个人中心','设置按钮移除','企业Logo加载','铃铛打开通知页面','真实通知创建/已读/精确删除','个人中心退出统一会话']},null,2));
  console.log('个人中心入口、真实通知与统一退出验证通过。');
} catch(error) { console.error(await page.locator('body').innerText()); console.error(await page.frames().find(f=>f.url().includes(':14331'))?.locator('body').innerText()); throw error; } finally {
  if(notificationId) await notifications('DELETE',{id:notificationId}).catch(()=>{});
  await browser.close();
}
