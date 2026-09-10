import {readFile,mkdir} from 'node:fs/promises';
import {chromium} from '../web/node_modules/playwright-core/index.mjs';
const account=JSON.parse(await readFile(new URL('../../mg-desktop-one/.runtime/local/account.json',import.meta.url),'utf8'));
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:960}});
 if(process.env.STAGED_DESKTOP==='1')await page.route('http://127.0.0.1:4301/api/**',async route=>{const response=await route.fetch({url:route.request().url().replace('127.0.0.1:4301','127.0.0.1:4302')});await route.fulfill({response});});
 await page.goto('http://127.0.0.1:4301');
 await page.getByPlaceholder('请输入账号').fill(account.username);
 await page.getByPlaceholder('请输入密码').fill(account.password);
 await page.getByRole('button',{name:/^登\s*录$/}).click();
 await page.waitForURL('http://127.0.0.1:4301/**');
 const result=await page.request.get(process.env.STAGED_DESKTOP==='1'?'http://127.0.0.1:4302/api/session':'http://127.0.0.1:4301/api/session');
 if(result.ok()){const data=await result.json();console.log(JSON.stringify({identity:data.apps?.find(a=>a.id==='identity')}));}
 console.log((await page.locator('body').innerText()).slice(0,1300));
 const launch=page.getByRole('button',{name:/打开统一身份/}).first();await launch.click();
 const frame=page.frameLocator('iframe').last();await frame.getByRole('heading',{name:'管理概览',exact:true}).waitFor();
 console.log(JSON.stringify({frames:page.frames().map(f=>f.url())}));
 await frame.getByRole('button',{name:'员工身份',exact:true}).click();
 await frame.getByRole('textbox',{name:'搜索员工',exact:true}).fill('搜索测试');
 await frame.getByRole('button',{name:'管理概览',exact:true}).click();
 await page.getByRole('button',{name:/^关闭统一身份/}).click();
 await page.locator('iframe').waitFor({state:'detached'});
 await mkdir('.runtime/local-identity-verification',{recursive:true});
 await page.screenshot({path:'.runtime/local-identity-verification/closed-clean.png'});
 console.log('本机桌面搜索后关闭无误报通过。');
}finally{await browser.close();}
