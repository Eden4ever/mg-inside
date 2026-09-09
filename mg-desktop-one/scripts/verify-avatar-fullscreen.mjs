import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage();
 let avatar='https://avatar.example.test/avatar.png';
 await page.route('**/api/session',r=>r.fulfill({json:{user:{id:'avatar-qa',name:'头像测试',username:'avatar-qa',role:'member',department:null,avatarUrl:avatar},csrfToken:'qa',expiresAt:Math.floor(Date.now()/1000)+7200,apps:[],desktop:{name:'验证桌面'}}}));
 await page.route('**/api/preferences',r=>r.fulfill({json:{theme:'system',wallpaper:'dawn',restore:false,pinned:[],applicationOrder:[]}}));
 await page.route('**/api/notifications',r=>r.fulfill({json:{items:[]}}));
 await page.route('https://avatar.example.test/avatar.png',r=>r.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHTkAAAAASUVORK5CYII=','base64')}));
 await page.goto(process.env.QA_DESKTOP_ORIGIN || 'http://127.0.0.1:4301/');
 await page.locator('.user-menu img').waitFor();
 assert.equal(await page.locator('.user-menu img').getAttribute('referrerpolicy'),'no-referrer');
 await page.getByRole('button',{name:'进入全屏',exact:true}).click();
 await page.getByRole('button',{name:'退出全屏',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>!!document.fullscreenElement),true);
 await page.getByRole('button',{name:'退出全屏',exact:true}).click();
 await page.getByRole('button',{name:'进入全屏',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>!!document.fullscreenElement),false);
 avatar='http://invalid.example.test/avatar.png';await page.reload();await page.locator('.user-menu span').waitFor();assert.equal(await page.locator('.user-menu img').count(),0);
 console.log('桌面头像显示/安全回退、原生全屏进入和退出验证通过。');
} finally { await browser.close(); }
