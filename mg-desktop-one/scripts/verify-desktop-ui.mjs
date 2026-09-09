import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { build } from 'esbuild';

const origin = process.env.DESKTOP_TEST_ORIGIN || 'http://127.0.0.1:4301';
const output = resolve('.runtime/ui'); await mkdir(output, { recursive: true });
const bundled = await build({ entryPoints: ['../mg-platform/packages/frontend/desktop-sdk/src/index.ts'], bundle: true, write: false, format: 'iife', globalName: 'DesktopBridge', platform: 'browser' });
const apps = [
  { id: 'expert-database', name: '指标知识库', description: '研究窗口协议测试', icon: 'knowledge', entryUrl: 'http://127.0.0.1:14321', defaultPath: '/systems', allowedPaths: ['/systems'], minWidth: 640, minHeight: 420 },
  { id: 'token-one', name: 'Token One', description: '业务窗口协议测试', icon: 'token', entryUrl: 'http://127.0.0.1:14311', defaultPath: '/dashboard', allowedPaths: ['/dashboard'], minWidth: 640, minHeight: 420 },
];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], loads = { 'expert-database': 0, 'token-one': 0 };
page.on('pageerror', error => errors.push(error.message));
let preferences = {};
try {
  await page.route('**/api/session', route => route.fulfill({ json: { user: { id: 'isolated-ui-test', name: '桌面体验', role: 'member' }, csrfToken: 'test-csrf', expiresAt: Date.now() / 1000 + 36000, apps } }));
  await page.route('**/api/preferences', async route => { if (route.request().method() === 'PUT') preferences = route.request().postDataJSON(); await route.fulfill({ json: preferences }); });
  for (const app of apps) await page.route(`${app.entryUrl}/**`, route => {
    loads[app.id]++;
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>body{font:14px system-ui;margin:25px;color:#203149;background:#fff}input,button{font:inherit;padding:10px;margin:10px 8px 10px 0}</style><body><h1>${app.name}</h1><p>窗口协议测试应用</p><input aria-label="研究草稿" placeholder="研究草稿"><button id="save">保存</button><p id="status">已保存</p><script>${bundled.outputFiles[0].text}
      let dirty=false;
      const bridge=DesktopBridge.connectDesktop({appId:${JSON.stringify(app.id)},allowedOrigins:[${JSON.stringify(origin)}],onClose:()=>!dirty});
      document.querySelector('input').addEventListener('input',()=>{dirty=true;bridge.setState({dirty});document.querySelector('#status').textContent='未保存'});
      document.querySelector('#save').onclick=()=>{dirty=false;bridge.setState({dirty});document.querySelector('#status').textContent='已保存'};
      bridge.setTitle(${JSON.stringify(app.name)});bridge.routeChanged(location.pathname+'?module=portrait&token=should-not-persist');
      </script></body></html>` });
  });
  await page.goto(origin); await page.getByRole('button', { name: '所有应用', exact: true }).waitFor();
  await page.getByRole('button', { name: '打开指标知识库', exact: true }).click();
  const knowledge = page.locator('section.app-window').filter({ has: page.locator('iframe[title="指标知识库"]') });
  const knowledgeFrame = page.frameLocator('iframe[title="指标知识库"]');
  await knowledgeFrame.getByRole('textbox', { name: '研究草稿' }).fill('未保存的研究草稿');
  await page.getByRole('button', { name: '打开Token One', exact: true }).click();
  await page.getByRole('button', { name: '打开指标知识库', exact: true }).click();
  assert.equal(await knowledgeFrame.getByRole('textbox', { name: '研究草稿' }).inputValue(), '未保存的研究草稿');
  assert.equal(loads['expert-database'], 1); assert.equal(loads['token-one'], 1);
  await page.getByRole('button', { name: '最小化指标知识库', exact: true }).click();
  assert.equal(await knowledge.isVisible(), false);
  await page.getByRole('button', { name: '打开指标知识库', exact: true }).click();
  assert.equal(await knowledgeFrame.getByRole('textbox', { name: '研究草稿' }).inputValue(), '未保存的研究草稿');
  assert.equal(loads['expert-database'], 1);
  await page.getByRole('button', { name: '关闭指标知识库', exact: true }).click();
  await page.getByRole('alertdialog').waitFor(); assert.equal(await knowledge.isVisible(), true);
  await page.getByRole('button', {name:'继续使用',exact:true}).click();
  const title = knowledge.locator('.window-title'); const box = await title.boundingBox();
  await page.mouse.move(box.x + 180, box.y + 20); await page.mouse.down(); await page.mouse.move(box.x + 230, box.y + 70, { steps: 5 }); await page.mouse.up();
  const moved = await title.boundingBox(); assert.ok(moved.x > box.x); assert.ok(moved.y > box.y);
  const oldWidth = (await knowledge.boundingBox()).width;
  const handle = await knowledge.locator('.resize-handle.se').boundingBox();
  await page.mouse.move(handle.x + 4, handle.y + 4); await page.mouse.down(); await page.mouse.move(handle.x - 60, handle.y - 50, { steps: 5 }); await page.mouse.up();
  assert.ok((await knowledge.boundingBox()).width < oldWidth);
  await page.getByRole('button', { name: '最大化或还原指标知识库', exact: true }).click();
  assert.ok((await knowledge.boundingBox()).width > 1400);
  await page.screenshot({ path: resolve(output, 'desktop.png') });
  const stored = await page.evaluate(() => localStorage.getItem('mg-desktop-layout:isolated-ui-test'));
  assert.ok(!stored.includes('should-not-persist'));
  await knowledgeFrame.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '关闭指标知识库', exact: true }).click();
  await knowledge.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '打开Token One', exact: true }).click();
  for (const width of [1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 }); await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const r = await page.locator('.app-window:visible').boundingBox(); assert.ok(r.x >= 0 && r.x + r.width <= width);
  }
  await page.screenshot({ path: resolve(output, 'mobile.png') });
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'verification.json'), JSON.stringify({ passed: true, checks: ['SDK 握手', '窗口切换/最小化不重载', '未保存拒绝关闭', '保存后关闭', '拖动与缩放', '最大化', '布局不保存令牌', '多尺寸无横向溢出'], iframeLoads: loads }, null, 2));
  console.log('桌面窗口端到端验证通过。');
} catch (error) {
  await page.screenshot({ path: resolve(output, 'failure.png') });
  console.error('窗口诊断：', JSON.stringify({ errors, loads, frames: page.frames().map(f => f.url()), text: (await page.locator('body').innerText()).slice(0, 1600) }));
  throw error;
} finally { await browser.close(); }
