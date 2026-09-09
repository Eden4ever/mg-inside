import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../../mg-desktop-one/package.json',import.meta.url));
const {chromium,expect}=require('@playwright/test');
const output=resolve('.runtime/avatar-verification');await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const checks=[];
try{
 const context=await browser.newContext({viewport:{width:1280,height:900}});const page=await context.newPage();
 let avatarUrl='https://avatar.example/portrait.svg',broken=false,avatarRequests=0;
 await context.route(url=>url.pathname.startsWith('/api/'),route=>route.fulfill({headers:{'Access-Control-Allow-Origin':'http://127.0.0.1:14331','Access-Control-Allow-Credentials':'true'},json:{user:{userId:'avatar-check',name:'头像验证',username:'avatar-check',departmentName:'演示',role:'member',authSource:'wecom',avatarUrl}}}));
 await context.route('https://avatar.example/**',route=>{avatarRequests++;assert.equal(route.request().headers().referer,undefined);return broken?route.fulfill({status:404,body:''}):route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#d7e7fb"/><circle cx="40" cy="30" r="15" fill="#4376ae"/><path d="M10 80v-8a30 30 0 0 1 60 0v8" fill="#4376ae"/></svg>'});});
 await page.goto('http://127.0.0.1:14331/profile');const avatars=page.locator('.el-avatar img');try{await expect(avatars).toHaveCount(2);}catch(e){console.log(await page.locator('body').innerText());await page.screenshot({path:resolve(output,'failure.png')});throw e;}await expect.poll(()=>avatars.evaluateAll(nodes=>nodes.every(n=>n.complete&&n.naturalWidth>0))).toBe(true);
 await page.screenshot({path:resolve(output,'profile-avatar.png')});checks.push('页头和个人资料使用同一头像，图片请求不附带来源地址');
 broken=true;await page.reload();await expect(page.locator('.profile-summary .el-avatar')).toHaveText('头');checks.push('头像加载失败回退姓名首字');
 avatarUrl=null;await page.reload();await expect(page.locator('.profile-summary .el-avatar')).toHaveText('头');assert.equal(await avatars.count(),0);checks.push('旧资料无头像仍显示姓名首字');
 await writeFile(resolve(output,'results.json'),JSON.stringify({checks,avatarRequests},null,2));console.log(JSON.stringify({checks}));
}finally{await browser.close();}
