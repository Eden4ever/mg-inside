import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const origin='http://127.0.0.1:4301',account=JSON.parse(await readFile('.runtime/local/account.json','utf8'));
const login=await fetch('http://127.0.0.1:14200/api/auth/login',{method:'POST',headers:{Origin:'http://127.0.0.1:14200','Content-Type':'application/json'},body:JSON.stringify(account)});assert.equal(login.status,200);
const token=login.headers.getSetCookie().find(c=>c.startsWith('mg_identity_session=')).split(';')[0].slice('mg_identity_session='.length);
const file=JSON.parse(await readFile('../mg-office-one/.runtime/verification/docx.json','utf8'));
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:1440,height:960}});await context.addCookies([{name:'mg_desktop_token',value:token,domain:'127.0.0.1',path:'/',httpOnly:true,sameSite:'Lax'}]);const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
await mkdir('.runtime/office-desktop',{recursive:true});
try{
 await page.goto(`${origin}/open?app=files&path=${encodeURIComponent('/my-files?open='+file.id)}`);
 const office=page.frameLocator('iframe[title="Office One"]');await office.getByRole('button',{name:'保存',exact:true}).waitFor({timeout:45000});
 assert.equal(await office.locator('.app-header').isVisible(),false);await page.screenshot({path:'.runtime/office-desktop/open-from-files.png'});
 assert.deepEqual(errors,[]);await writeFile('.runtime/office-desktop/result.json',JSON.stringify({fileEntry:true,desktopBridge:true,editor:true,errors},null,2));console.log('桌面文件入口 → Office One 编辑器和嵌入公共壳验证通过。');
}catch(e){await page.screenshot({path:'.runtime/office-desktop/failure.png'});throw e}finally{await browser.close()}
