import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import assert from 'node:assert/strict';
const out=resolve('.runtime/strict-shell');await mkdir(out,{recursive:true});
const targets=[['identity','C:/Projects/mg-inside/mg-auth-one-identity/web/dist','/'],['expert','C:/Projects/mg-inside/mg-expert-database/apps/web/dist','/systems']];
const browser=await chromium.launch({channel:'chrome',headless:true});const results=[];
try {for(const [name,root,start] of targets){
 const server=createServer(async(req,res)=>{try {let file=resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!extname(file))file=resolve(root,'index.html'); if(!file.startsWith(root.replaceAll('/', '\\')+'\\'))throw Error('outside');const data=await readFile(file);res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'})[extname(file)]||'application/octet-stream');res.end(data);}catch{res.statusCode=404;res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 const page=await browser.newPage({viewport:{width:1300,height:850}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',route=>{const path=new URL(route.request().url()).pathname;let body=[];if(path.endsWith('/auth/me'))body={csrfToken:'qa',user:{id:'qa',userId:'qa',username:'qa',name:'壳验证',departmentName:null,role:'system_admin',authSource:'local',status:'active',identityAuthorized:true,roles:[{id:'platform-admin',key:'platform-admin',name:'平台管理员'}]}};if(path.endsWith('/ai/status'))body={configured:false};return route.fulfill({json:body});});
 await page.goto(origin+start);await page.locator('.mg-configured-shell').waitFor();
 const metrics=()=>page.evaluate(()=>{const side=document.querySelector('.app-sidebar'),content=document.querySelector('.app-content'),header=document.querySelector('.app-header');return {side:side.getBoundingClientRect().width,sideVisible:getComputedStyle(side).visibility,contentLeft:content.getBoundingClientRect().left,contentTop:content.getBoundingClientRect().top,headerDisplay:getComputedStyle(header).display,navText:document.querySelector('.global-nav').textContent.trim(),radius:getComputedStyle(content).borderTopLeftRadius,shadow:getComputedStyle(content).boxShadow,bodyWidth:document.body.scrollWidth,viewport:innerWidth}});
 let m=await metrics();assert.equal(m.side,64);assert.equal(m.navText,'');assert.equal(m.contentTop,56);assert.equal(m.radius,'16px');assert.notEqual(m.shadow,'none');
 await page.getByRole('button',{name:'展开导航',exact:true}).click();m=await metrics();assert.equal(m.side,256);assert.ok(m.navText.length>0);await page.getByRole('button',{name:'收起导航',exact:true}).click();
 await page.screenshot({path:resolve(out,`${name}-browser.png`)});
 await page.evaluate(()=>document.documentElement.classList.add('desktop-embedded'));m=await metrics();assert.equal(m.contentTop,42);assert.equal(m.headerDisplay,'none');assert.equal(m.side,64);await page.screenshot({path:resolve(out,`${name}-embedded.png`)});
 await page.setViewportSize({width:500,height:780});m=await metrics();assert.equal(m.side,64);assert.equal(m.sideVisible,'visible');assert.equal(m.contentLeft,64);await page.getByRole('button',{name:'展开导航',exact:true}).click();m=await metrics();assert.equal(m.side,256);assert.equal(m.contentLeft,64);await page.getByRole('button',{name:'关闭导航遮罩'}).click({position:{x:350,y:100}});assert.equal((await metrics()).side,64);
 await page.getByRole('button',{name:'展开导航',exact:true}).click();await page.keyboard.press('Escape');assert.equal((await metrics()).side,64);await page.screenshot({path:resolve(out,`${name}-mobile.png`)});
 await page.evaluate(()=>{document.documentElement.classList.remove('desktop-embedded');document.documentElement.style.setProperty('--mg-bg-surface','#20242a');document.documentElement.style.setProperty('--mg-text-primary','#eef2f7');document.documentElement.style.setProperty('--mg-text-regular','#cbd5e1');});
 const dark=await page.locator('.app-content').evaluate(el=>getComputedStyle(el).backgroundColor);assert.equal(dark,'rgb(32, 36, 42)');await page.screenshot({path:resolve(out,`${name}-semantic-dark.png`)});
 assert.deepEqual(errors,[]);results.push({name,passed:true,browserTop:56,embeddedTop:42,collapsed:64,expanded:256,pageErrors:errors});await page.close();await new Promise(r=>server.close(r));
 }await writeFile(resolve(out,'result.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}finally{await browser.close();}
