import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';
import { chromium } from '@playwright/test';

const output = resolve('.runtime/desktop-files');
await mkdir(output, { recursive: true });
const source = resolve('apps/web/src/DesktopFiles.vue').replaceAll('\\', '/');
const css = resolve('apps/web/src/desktop.css').replaceAll('\\', '/');
await writeFile(resolve(output, 'index.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>桌面文件验证</title><div id="app"></div><script type="module">
import {createApp,h,ref} from 'vue';import DesktopFiles from '/@fs/${source}';import '/@fs/${css}';
const enabled=ref(false),identity=ref('user-a'),component=ref(),opened=[],contexts=[];
const app=createApp({setup:()=>()=>h('main',{class:'desktop',style:'display:block'},[h('div',{class:'work-area',style:'height:100dvh'},[h(DesktopFiles,{key:identity.value,ref:component,enabled:enabled.value,onOpen:path=>opened.push(path),onContext:(_,item)=>contexts.push(item)})])])});
app.mount('#app');window.filesHarness={opened,contexts,setEnabled:value=>enabled.value=value,setIdentity:value=>identity.value=value,refresh:()=>component.value.refresh(),unmount:()=>app.unmount()};
</script>`, 'utf8');
const server = await createServer({ configFile: false, root: output, plugins: [vue()], server: { host: '127.0.0.1', port: 0, fs: { allow: [resolve('.')] } }, logLevel: 'error' });
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 850 } });
const page = await context.newPage(), errors = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
let requests = 0, status = 200;
let payload = { folderId: 'desktop-a', items: [
  { id: 'folder /?#', name: '项目资料', kind: 'folder', version: 7 },
  { id: 'file-a', name: '用于验证中文长文件名自动换行且不截断的项目进度记录.txt', kind: 'file' },
] };
await context.route('**/api/apps/files/desktop', async route => {
  requests++;
  assert.equal(route.request().method(), 'GET');
  await route.fulfill({ status, json: payload });
});
async function waitRequests(minimum) { await page.waitForFunction(() => !!window.filesHarness); for (let i = 0; i < 100 && requests < minimum; i++) await new Promise(r => setTimeout(r, 20)); assert.ok(requests >= minimum); }
async function check(name, run) { await run(); checks.push(name); }
try {
  await page.clock.install();
  await page.goto(origin); await page.waitForFunction(() => !!window.filesHarness);
  await check('未启用时不读取文件，初次启用获取桌面目录', async () => {
    assert.equal(requests, 0); assert.equal(await page.locator('.desktop-files').count(), 0);
    await page.evaluate(() => window.filesHarness.setEnabled(true));
    await page.getByRole('button', { name: '项目资料（文件夹）', exact: true }).waitFor();
    assert.equal(await page.locator('.desktop-file').count(), 2);
  });
  await check('单击选中、Enter打开文件、双击打开目录且安全编码路径', async () => {
    const file = page.getByRole('button', { name: /中文长文件名/ });
    await file.click(); assert.equal(await file.getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await page.evaluate(() => window.filesHarness.opened), []);
    await file.press('Enter');
    await page.getByRole('button', { name: '项目资料（文件夹）', exact: true }).dblclick();
    assert.deepEqual(await page.evaluate(() => window.filesHarness.opened), ['/my-files?open=file-a', '/my-files/folder%20%2F%3F%23']);
    const wraps = await file.locator('.desktop-file-name').evaluate(el => el.clientHeight > parseFloat(getComputedStyle(el).lineHeight) * 2);
    assert.equal(wraps, true);
    await page.screenshot({ path: resolve(output, 'desktop-files.png'), animations: 'disabled' });
  });
  await check('右键发出条目当前版本，供宿主执行并发修改保护', async () => {
    await page.getByRole('button', {name:'项目资料（文件夹）',exact:true}).click({button:'right'});
    assert.deepEqual(await page.evaluate(()=>window.filesHarness.contexts.at(-1)), {id:'folder /?#',name:'项目资料',kind:'folder',version:7});
  });
  await check('窗口focus、页面重新可见及15秒兜底刷新', async () => {
    let before = requests; await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await waitRequests(before + 1);
    before = requests; await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await waitRequests(before + 1);
    before = requests; await page.clock.runFor(15_000); await waitRequests(before + 1);
  });
  await check('离线不阻塞文件选择和打开，恢复在线立即刷新', async () => {
    await context.setOffline(true);
    const before = requests;
    await page.evaluate(() => window.filesHarness.refresh());
    await page.getByRole('button', { name: /中文长文件名/ }).press('Enter');
    assert.equal(requests, before);
    assert.equal(await page.evaluate(() => window.filesHarness.opened.at(-1)), '/my-files?open=file-a');
    await context.setOffline(false); await waitRequests(before + 1);
  });
  await check('账号切换销毁旧状态，未传入快捷方式时空目录没有占位', async () => {
    payload = { folderId: 'desktop-b', items: [] };
    await page.evaluate(() => window.filesHarness.setIdentity('user-b'));
    await page.locator('.desktop-files').waitFor({ state: 'detached' });
    await page.evaluate(() => window.filesHarness.refresh());
    assert.equal(await page.locator('.desktop-file,.desktop-shortcuts').count(), 0);
    assert.equal(await page.locator('.work-area').innerText(), '');
  });
  await check('权限失效立即清空，停用与卸载清理请求和事件监听', async () => {
    payload = { folderId: 'desktop-b', items: [{ id: 'file-b', name: '新账号文件.txt', kind: 'file' }] };
    await page.evaluate(() => window.filesHarness.refresh());
    await page.getByRole('button', { name: '新账号文件.txt（文件）', exact: true }).waitFor();
    status = 403; await page.evaluate(() => window.filesHarness.refresh());
    assert.equal(await page.locator('.desktop-files').count(), 0);
    await page.evaluate(() => window.filesHarness.setEnabled(false));
    const before = requests;
    await page.evaluate(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
    assert.equal(requests, before);
    await page.evaluate(() => window.filesHarness.unmount());
    await page.clock.runFor(30_000);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    assert.equal(requests, before);
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
  });
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }));
} finally { await browser.close(); await server.close(); }
