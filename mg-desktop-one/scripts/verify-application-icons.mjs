import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';
import { chromium } from '@playwright/test';
const output = resolve('.runtime/fluent-application-icons'); await mkdir(output,{recursive:true});
const source = resolve('../mg-platform/packages/frontend/ApplicationIcon.vue').replaceAll('\\','/');
await writeFile(resolve(output,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>公共图标验证</title><style>body{margin:40px;background:#e8edf5;font-family:sans-serif}.row{display:flex;gap:24px;margin:24px 0}.tile{display:grid;justify-items:center;gap:10px;width:76px}.tile .app-icon{width:72px;height:72px}small{font-size:12px}</style><div id="app"></div><script type="module">import{createApp,h}from'vue';import Icon from'/@fs/${source}';const ids=['files','personal-center','app-manager','expert-database','token-one','token-one-console','token-one-docs','identity','office-one','resource-manager','launcher','trash','trash-full','unknown-app'];createApp({render:()=>[52,48,32].map(size=>h('div',{class:'row','data-size':size},ids.map(id=>h('div',{class:'tile','data-id':id},[h(Icon,{app:{id},style:{width:size+'px',height:size+'px'}}),h('small',id)]))))}).mount('#app')</script></html>`);
const server=await createServer({configFile:false,root:output,plugins:[vue()],resolve:{alias:{vue:resolve('node_modules/vue/dist/vue.esm-bundler.js')}},server:{host:'127.0.0.1',port:0,fs:{allow:[resolve('..')]}},logLevel:'error'});await server.listen();
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1560,height:440}}); const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let failure=0;
 await page.route('**/*',route=>{const u=route.request().url();if(route.request().resourceType()==='image'&&((failure>=1&&u.includes('/files-fluent.png'))||(failure>=2&&u.includes('/files.svg'))||(failure>=3&&u.includes('/placeholder.svg'))))return route.abort();return route.continue();});
 const url=`http://127.0.0.1:${server.httpServer.address().port}`;
 const target=page.locator('[data-size="52"] [data-id="files"]');
 await page.goto(url);await target.locator('img').waitFor();
 await page.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalWidth>0));
 assert.match(await target.locator('img').getAttribute('src'),/files-fluent\.png/);
 assert.equal(await page.locator('[data-size="52"] [data-id="unknown-app"] .app-icon').getAttribute('data-placeholder'),'true');
 const measurements=await page.evaluate(()=>[...document.querySelectorAll('.row .tile')].map(tile=>{const img=tile.querySelector('img'),container=tile.querySelector('.app-icon'),canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);const w=canvas.width,h=canvas.height,pixels=ctx.getImageData(0,0,w,h).data;let x0=w,y0=h,x1=0,y1=0;for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(pixels[(y*w+x)*4+3]>128){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x+1);y1=Math.max(y1,y+1);}const r=img.getBoundingClientRect(),c=container.getBoundingClientRect();return {id:tile.dataset.id,size:c.width,width:(x1-x0)/w*r.width,height:(y1-y0)/h*r.height,offsetX:r.x+(x0+x1)/2/w*r.width-c.x-c.width/2,offsetY:r.y+(y0+y1)/2/h*r.height-c.y-c.height/2};}));
 for(const m of measurements){assert.ok(Math.abs(Math.max(m.width,m.height)-m.size)<.6,JSON.stringify(m));assert.ok(Math.min(m.width,m.height)>=m.size*.6,JSON.stringify(m));assert.ok(Math.abs(m.offsetX)<.6&&Math.abs(m.offsetY)<.6,JSON.stringify(m));}
 const family=page.locator('[data-size="52"] [data-id^="token-one"]');
 const mainImages=await family.locator('img:not(.application-badge)').evaluateAll(images=>images.map(image=>image.src));
 assert.equal(new Set(mainImages).size,1,'Token 三应用必须共享同一主图');
 assert.equal(await family.nth(0).locator('.application-badge').count(),0);
 for(const tile of [family.nth(1),family.nth(2)]){const badge=await tile.locator('.application-badge').boundingBox();const icon=await tile.locator('.app-icon').boundingBox();assert.ok(Math.abs(badge.width-icon.width*.42)<.1);assert.ok(Math.abs(badge.x+badge.width-icon.x-icon.width)<.1);assert.ok(Math.abs(badge.y+badge.height-icon.y-icon.height)<.1);}
 await writeFile(resolve(output,'measurements.json'),JSON.stringify(measurements,null,2));
 await page.screenshot({path:resolve(output,'application-icons.png')});
 failure=1;await page.reload();await page.waitForFunction(()=>document.querySelector('[data-id="files"] img')?.src.startsWith('data:image/svg+xml'));assert.equal(await target.locator('.app-icon').getAttribute('data-placeholder'),null);
 await target.locator('img').dispatchEvent('error');await page.waitForFunction(()=>document.querySelector('[data-id="files"] .app-icon')?.dataset.placeholder==='true');
 await target.locator('img').dispatchEvent('error');await target.locator('.empty-icon').waitFor();assert.equal(await target.locator('img').count(),0);
 assert.deepEqual(errors,[]);console.log('应用图片优先、未知应用占位、图片失败回退基础、基础失败回退占位、占位失败无断图均通过。');
}finally{await browser.close();await server.close();}
