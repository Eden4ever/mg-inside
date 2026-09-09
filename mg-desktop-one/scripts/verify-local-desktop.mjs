import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const account=JSON.parse(await readFile('.runtime/local/account.json','utf8'));
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[],responses=[]; page.on('pageerror',e=>errors.push(e.message));
page.on('response',r=>{if(r.url().includes('/api/')) responses.push({path:new URL(r.url()).pathname,status:r.status()});});
try{
 await page.goto('http://127.0.0.1:4301');
 await page.getByRole('textbox',{name:'登录账号',exact:true}).fill(account.username);
 await page.getByRole('textbox',{name:'登录密码',exact:true}).fill(account.password);
 await page.getByRole('button',{name:'登 录',exact:true}).click();
 await page.getByRole('button',{name:'打开统一身份',exact:true}).click();
 await page.frameLocator('iframe[title="统一身份"]').getByRole('link',{name:'工作台',exact:true}).waitFor({timeout:15000});
 await page.waitForTimeout(1000);
 await page.getByRole('button',{name:'打开Token One',exact:true}).click();
 await page.frameLocator('iframe[title="Token One"]').getByRole('heading',{name:'你好，桌面体验',exact:true}).waitFor({timeout:15000});
 await page.getByRole('button',{name:'打开指标知识库',exact:true}).click();
 await page.frameLocator('iframe[title="指标知识库"]').getByRole('heading',{name:'指标体系',exact:true}).waitFor({timeout:15000});
 await page.waitForTimeout(1000);
 assert.equal(await page.locator('.window-error').count(),0);
 assert.deepEqual(errors,[]);
 assert.equal(responses.some(r=>r.status>=500),false);
 await mkdir('.runtime/local-verification',{recursive:true});
 await page.screenshot({path:'.runtime/local-verification/desktop.png'});
 await writeFile('.runtime/local-verification/result.json',JSON.stringify({passed:true,responses,errors},null,2));
 console.log('统一认证登录、三个真实应用嵌入与 API 读取均通过。');
}catch(e){console.error(JSON.stringify({errors,responses,frames:page.frames().map(f=>f.url()),text:(await page.locator('body').innerText()).slice(0,1800)}));throw e}
finally{await browser.close()}
