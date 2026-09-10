import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';

const origin='http://127.0.0.1:4301';
const developer='郑州元引信息科技有限公司';
const catalog=JSON.parse(await readFile(new URL('../../mg-platform/packages/frontend/config/application-catalog.json',import.meta.url),'utf8'));
const account=JSON.parse(await readFile(new URL('../.runtime/local/account.json',import.meta.url),'utf8'));
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage();
 await page.goto(origin);
 await page.getByPlaceholder('请输入账号').fill(account.username);
 await page.getByPlaceholder('请输入密码').fill(account.password);
 await page.getByRole('button',{name:/^登\s*录$/}).click();
 await page.getByRole('button',{name:/打开统一身份/}).first().waitFor();
 const session=await (await page.request.get(origin+'/api/session')).json();
 let updated=0,verified=0;
 for(const id of Object.keys(catalog.applications)) {
  const url=origin+'/api/applications/'+encodeURIComponent(id);
  const response=await page.request.get(url);
  if(response.status()===404) {console.log(id+'：当前本机未提供该应用，跳过。');continue;}
  assert.equal(response.status(),200,id+' 读取失败');
  const detail=await response.json();
  if(detail.developer!==developer) {
   const data=Object.fromEntries(['name','description','icon','minWidth','minHeight','defaultMaximized'].map(key=>[key,detail[key]]));
   Object.assign(data,{developer,expectedRevision:detail.revision});
   const result=await page.request.patch(url,{headers:{Origin:origin,'X-CSRF-Token':session.csrfToken||session.user?.csrfToken||session.profile?.csrfToken},data});
   assert.equal(result.status(),200,id+': '+await result.text());
   updated++;
  }
  const saved=await (await page.request.get(url)).json();
  assert.equal(saved.developer,developer,id);
  verified++;
  console.log(saved.name+'：'+saved.developer);
 }
 console.log('已更新 '+updated+' 个默认应用，'+verified+' 个已安装默认应用复核通过。');
} finally {await browser.close();}
