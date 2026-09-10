import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';

const origin='http://127.0.0.1:4301';
const developer='郑州元引信息科技有限公司';
const account=JSON.parse(await readFile(new URL('../.runtime/local/account.json',import.meta.url),'utf8'));
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage();
 await page.goto(origin);
 await page.getByPlaceholder('请输入账号').fill(account.username);
 await page.getByPlaceholder('请输入密码').fill(account.password);
 await page.getByRole('button',{name:/^登\s*录$/}).click();
 await page.waitForURL('http://127.0.0.1:4301/**');
 await page.waitForFunction(async()=>{try{return (await fetch('/api/session')).ok}catch{return false}});
 const request=(path,init={})=>page.evaluate(async({path,init})=>{const response=await fetch(path,{credentials:'include',...init});return {status:response.status,text:await response.text()}},{path,init});
 const sessionResult=await request('/api/session');
 assert.equal(sessionResult.status,200,'读取桌面会话失败');
 const session=JSON.parse(sessionResult.text);
 const applicationResponse=await request('/api/applications');
 assert.equal(applicationResponse.status,200,'读取内核应用清单失败');
 const applicationPayload=JSON.parse(applicationResponse.text);
 const applications=Array.isArray(applicationPayload)?applicationPayload:applicationPayload.items;
 assert(Array.isArray(applications),'内核应用清单格式无效');
 let updated=0,verified=0;
 for(const id of applications.filter(item=>item.kind!=='external').map(item=>item.id)) {
  const url='/api/applications/'+encodeURIComponent(id);
  const response=await request(url);
  if(response.status===404) {console.log(id+'：当前本机未提供该应用，跳过。');continue;}
  assert.equal(response.status,200,id+' 读取失败');
  const detail=JSON.parse(response.text);
  if(detail.developer!==developer) {
   const data=Object.fromEntries(['name','description','icon','minWidth','minHeight','defaultMaximized'].map(key=>[key,detail[key]]));
   Object.assign(data,{developer,expectedRevision:detail.revision});
   const result=await request(url,{method:'PATCH',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrfToken||session.user?.csrfToken||session.profile?.csrfToken},body:JSON.stringify(data)});
   assert.equal(result.status,200,id+': '+result.text);
   updated++;
  }
  const saved=JSON.parse((await request(url)).text);
  assert.equal(saved.developer,developer,id);
  verified++;
  console.log(saved.name+'：'+saved.developer);
 }
 console.log('已更新 '+updated+' 个默认应用，'+verified+' 个已安装默认应用复核通过。');
} finally {await browser.close();}
