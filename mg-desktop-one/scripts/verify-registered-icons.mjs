import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '..');
const output = await mkdtemp(join(root, '.runtime/registered-icons-'));
const component = resolve(root, '../mg-platform/packages/frontend/ApplicationIcon.vue').replaceAll('\\', '/');
await writeFile(join(output, 'index.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>注册图标验证</title>
<style>body{margin:24px;background:#edf3f0;font-family:system-ui}#app{display:flex;gap:32px;flex-wrap:wrap}.item{display:grid;justify-items:center;gap:16px;width:100px;font-size:14px}</style>
<div id="app"></div><script type="module">
import { createApp,h,ref } from 'vue';import Icon from '/@fs/${component}';
const icon=ref('resource-manager');window.changeIcon=value=>icon.value=value;
createApp({render:()=>[
h('div',{class:'item',id:'registered'},[h(Icon,{app:{id:'database-new-app',icon:icon.value}}),'数据库图标']),
h('div',{class:'item',id:'legacy'},[h(Icon,{app:{id:'files',icon:'knowledge'}}),'既有文件图标']),
h('div',{class:'item',id:'unknown'},[h(Icon,{app:{id:'files',icon:'unavailable-key'}}),'未知图标占位'])
]}).mount('#app');</script></html>`);
const server = await createServer({ configFile:false, root:output, plugins:[vue()],
  resolve:{ alias:{vue:join(root,'node_modules/vue/dist/vue.esm-bundler.js')} },
  server:{host:'127.0.0.1',port:0,fs:{allow:[resolve(root,'..')]}}, logLevel:'error' });
await server.listen();
const browser = await chromium.launch({ channel:'chrome', headless:true });
try {
  const page = await browser.newPage(); const errors=[];page.on('pageerror',error=>errors.push(error.message));
  for (const viewport of [{width:1024,height:600},{width:390,height:600}]) {
    await page.setViewportSize(viewport);await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
    await page.waitForFunction(()=>document.images.length===3&&[...document.images].every(image=>image.complete&&image.naturalWidth>0));
    assert.match(await page.locator('#registered img').getAttribute('src'),/resource-manager-fluent/);
    assert.match(await page.locator('#legacy img').getAttribute('src'),/files-fluent/);
    assert.equal(await page.locator('#unknown .app-icon').getAttribute('data-placeholder'),'true');
    await page.screenshot({path:join(output,`icons-${viewport.width}.png`)});
  }
  await page.evaluate(()=>window.changeIcon('files'));
  await page.waitForFunction(()=>document.querySelector('#registered img')?.src.includes('files-fluent'));
  assert.deepEqual(errors,[]);
  await writeFile(join(output,'result.json'),JSON.stringify({passed:true,viewports:[1024,390],dynamicKey:true,legacy:true,placeholder:true},null,2));
  console.log(`数据库图标键、既有图标、未知键占位及图标切换通过：${output}`);
} finally { await browser.close();await server.close(); }
