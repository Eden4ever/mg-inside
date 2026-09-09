import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
 await page.goto('https://desktop.meta-gravity.com/');
 await page.getByRole('textbox',{name:'登录账号',exact:true}).waitFor();
 assert.equal(new URL(page.url()).origin,'https://identity.meta-gravity.com');
 const client=new URL(page.url()).searchParams.get('client_id');
 const health=await page.request.get('https://desktop.meta-gravity.com/api/health');assert.equal(health.status(),200);
 const anonymous=await page.request.get('https://desktop.meta-gravity.com/api/session');assert.equal(anonymous.status(),401);
 const files=await page.request.get('https://desktop.meta-gravity.com/apps/files/my-files');assert.equal(files.status(),200);
 const worker=await page.request.get('https://desktop.meta-gravity.com/apps/files/assets/pdf.worker.min-Dswkl-cV.mjs');assert.equal(worker.status(),200);assert.match(worker.headers()['content-type'],/javascript/);
 await mkdir('.runtime/production-smoke',{recursive:true});await page.screenshot({path:'.runtime/production-smoke/login.png'});
 assert.deepEqual(errors,[]);await writeFile('.runtime/production-smoke/result.json',JSON.stringify({passed:true,health:200,anonymousSession:401,filesDeepLink:200,pdfWorkerJavascript:true,unifiedLoginOrigin:new URL(page.url()).origin,errors},null,2));
 console.log('生产HTTPS、统一登录跳转、匿名拒绝、文件深链接与PDF worker MIME验证通过。');
}finally{await browser.close();}
