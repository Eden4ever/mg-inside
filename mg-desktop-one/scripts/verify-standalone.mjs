import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
const account=JSON.parse(await readFile('.runtime/local/account.json','utf8'));
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  for (const [url,app] of [['http://127.0.0.1:14321/systems','指标知识库'],['http://127.0.0.1:14311/my-usage','Token One']]) {
    const context=await browser.newContext(); const page=await context.newPage();
    await page.goto(url);
    await page.getByRole('textbox',{name:'登录账号',exact:true}).fill(account.username);
    assert.ok(page.url().startsWith('http://127.0.0.1:14200/login'));
    await page.getByRole('textbox',{name:'登录密码',exact:true}).fill(account.password);
    await page.getByRole('button',{name:'登 录',exact:true}).click();
    await page.waitForURL(url,{timeout:15000});
    await page.locator(app==='Token One'?'.workspace-topbar':'.app-header').waitFor();
    assert.equal(await page.locator('html.desktop-embedded').count(),0);
    const cookies=await context.cookies(); const center=cookies.find(c=>c.name==='mg_identity_session'),desktop=cookies.find(c=>c.name==='mg_desktop_token');
    assert.ok(center?.value);assert.equal(center.value,desktop?.value);assert.ok(desktop.httpOnly);
    assert.equal(await page.evaluate(()=>localStorage.getItem('mg_token')),null);
    await page.goto('http://127.0.0.1:4301');await page.getByRole('navigation',{name:'桌面应用'}).getByRole('button',{name:app,exact:true}).click();
    await page.frameLocator(`iframe[title="${app}"]`).locator('html.desktop-embedded').waitFor();
    const after=await context.cookies();assert.equal(after.find(c=>c.name==='mg_desktop_token')?.value,center.value);
    await context.close();
  }
  await mkdir('.runtime/standalone',{recursive:true});
  await writeFile('.runtime/standalone/verification.json',JSON.stringify({passed:true,checks:['知识库独立访问返回原路由','Token One 独立访问返回原路由','统一认证页面登录','独立样式保留完整顶部','桌面样式按嵌入启用','中心与桌面 Cookie 内同一枚令牌','转到桌面无需再次登录','无 localStorage 登录令牌']},null,2));
  console.log('知识库与 Token One：独立浏览器/桌面两种样式、原页面登录返回、同令牌验证通过。');
} finally {await browser.close()}
