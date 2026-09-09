import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../../mg-desktop-one/package.json',import.meta.url));
const {chromium}=require('@playwright/test');
const origin='http://127.0.0.1:4301';
const account=JSON.parse(await readFile(new URL('../../mg-desktop-one/.runtime/local/account.json',import.meta.url),'utf8'));
const login=await fetch('http://127.0.0.1:14200/api/auth/login',{method:'POST',headers:{'content-type':'application/json',origin:'http://127.0.0.1:14200'},body:JSON.stringify(account)});
assert.equal(login.status,200);
const token=login.headers.getSetCookie().find(v=>v.startsWith('mg_identity_session=')).split(';')[0].slice('mg_identity_session='.length);
const cookie=`mg_desktop_token=${token}`;
const session=await (await fetch(origin+'/api/session',{headers:{cookie}})).json();
assert(session.apps.some(a=>a.id==='office-one'));
async function api(path,body){const r=await fetch(origin+'/api/apps/office-one'+path,{method:body?'POST':'GET',headers:{cookie,origin,'content-type':'application/json','x-csrf-token':session.csrfToken},...(body?{body:JSON.stringify(body)}:{})});const j=await r.json();assert(r.ok,j.message);return j}
await mkdir('.runtime/verification',{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:960}});
await context.addCookies([{name:'mg_desktop_token',value:token,domain:'127.0.0.1',path:'/',httpOnly:true,sameSite:'Lax'}]);
const page=await context.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
page.on('response',async response=>{const path=new URL(response.url()).pathname;if(path.includes('/api/apps/office-one/sessions/'))console.log(JSON.stringify({path,status:response.status(),body:await response.json().catch(()=>null)}))});
try{
  await page.goto('http://127.0.0.1:14361/documents');
  await page.getByRole('heading',{name:'我的文档',exact:true}).waitFor();
  await page.screenshot({path:'.runtime/verification/home.png'});
  if(process.env.OFFICE_QA_HOME_ONLY){console.log('公共壳首页已加载');}
  else for(const format of (process.env.OFFICE_QA_FORMAT?[process.env.OFFICE_QA_FORMAT]:['docx','xlsx','pptx'])){
    const file=process.env.OFFICE_QA_EDIT ? JSON.parse(await readFile(`.runtime/verification/${format}.json`,'utf8')) : await api('/documents',{format});
    await page.goto(`http://127.0.0.1:14361/documents/${file.id}`);
    try { await page.locator('.office-toolbar button').filter({hasText:'保存'}).waitFor({timeout:30000});
      await page.waitForFunction(()=>{const b=[...document.querySelectorAll('.office-toolbar button')].find(b=>b.textContent==='保存');return b&&!b.disabled},{},{timeout:90000});
      console.log(format+' 编辑器就绪');
    } catch(e) { console.log(JSON.stringify({format,text:(await page.locator('body').innerText()).slice(0,1000),frames:await Promise.all(page.frames().map(async f=>({url:new URL(f.url()||'about:blank').pathname,text:(await f.locator('body').innerText().catch(()=>'' )).slice(0,900)})))}));throw e; }
    await page.screenshot({path:`.runtime/verification/${format}.png`});
    if(process.env.OFFICE_QA_EDIT){
      const frame=page.frames().find(f=>f.url().includes('/main/index.html'));
      for(const button of await frame.getByText('知道了',{exact:true}).all())if(await button.isVisible())await button.click();
      const marker=`OFFICE-ONE-${format.toUpperCase()}-VERIFIED`;
      if(format==='docx'){await page.mouse.click(470,403);await page.keyboard.type(marker);}
      if(format==='xlsx'){await page.mouse.click(160,310);await page.keyboard.type(marker);await page.keyboard.press('Enter');}
      if(format==='pptx'){await frame.getByRole('button',{name:'文本框',exact:true}).click();await frame.getByRole('tabpanel',{name:'开始',exact:true}).getByText('插入水平文本框',{exact:true}).click();await page.mouse.move(700,440);await page.mouse.down();await page.mouse.move(1080,560,{steps:10});await page.mouse.up();await page.keyboard.type(marker);await page.keyboard.press('Escape');}
      await page.locator('.save-state').filter({hasText:'有未保存修改'}).waitFor({timeout:15000});
      await page.getByRole('button',{name:'保存',exact:true}).click();
      await page.locator('.save-state').filter({hasText:'已保存到文件'}).waitFor({timeout:60000});
      const download=await fetch(`${origin}/api/apps/files/entries/${file.id}/content`,{headers:{cookie}});assert.equal(download.status,200);await writeFile(`.runtime/verification/saved.${format}`,Buffer.from(await download.arrayBuffer()));
      console.log(format+' 实际键盘编辑并保存回文件成功');
    }
    await writeFile(`.runtime/verification/${format}.json`,JSON.stringify({id:file.id,errors}));
  }
}catch(error){await page.screenshot({path:'.runtime/verification/failure.png'});throw error}finally{await browser.close()}
