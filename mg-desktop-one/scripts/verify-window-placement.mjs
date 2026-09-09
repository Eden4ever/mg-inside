import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { build } from 'esbuild';

const origin = 'http://127.0.0.1:4301';
const output = resolve('.runtime/window-placement'); await mkdir(output, { recursive: true });
const results = { checks: [], failures: [], styles: {} };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const bundle = await build({ entryPoints: ['../mg-platform/packages/frontend/desktop-sdk/src/index.ts'], bundle: true, write: false, format: 'iife', globalName: 'DesktopBridge', platform: 'browser' });
const app = { id: 'expert-database', name: '摆放测试', description: '', icon: 'knowledge', entryUrl: 'http://127.0.0.1:14321', defaultPath: '/systems', allowedPaths: ['/systems'], minWidth: 480, minHeight: 320 };
const mock = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await mock.newPage();
const closeEnough = (actual, expected) => assert(Math.abs(actual - expected) < 2, `${actual} ≠ ${expected}`);
async function check(name, action) { try { await action(); results.checks.push(name); } catch (error) { results.failures.push({ name, message: error.message }); } }
await mock.route('**/api/session', route => route.fulfill({ json: { user: { id: 'placement-isolated', name: '测试' }, csrfToken: 'mock', expiresAt: Date.now() / 1000 + 36000, apps: [app] } }));
await mock.route('**/api/preferences', route => route.fulfill({ json: {} }));
await mock.route('**/api/notifications', route => route.fulfill({ json: { items: [] } }));
await mock.route(`${app.entryUrl}/**`, route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<html><body style="margin:70px;background:transparent"><h1>窗口摆放验证</h1><script>${bundle.outputFiles[0].text};DesktopBridge.connectDesktop({appId:'${app.id}',allowedOrigins:['${origin}']});</script></body></html>` }));
try {
  await page.goto(origin);
  await page.getByRole('button', { name: '打开摆放测试', exact: true }).click();
  const win = page.locator('.app-window');
  await page.frameLocator('iframe').getByRole('heading').waitFor();
  const area = await page.locator('.work-area').boundingBox();
  async function drag(dx, dy) {
    const b = await win.locator('.window-title').boundingBox();
    const x = Math.max(10, Math.min(1400, b.x + Math.min(300, b.width * .42)));
    await page.mouse.move(x, b.y + 22); await page.mouse.down(); await page.mouse.move(x + dx, b.y + 22 + dy, { steps: 8 }); await page.mouse.up();
  }
  await check('右上四按钮统一46px宽且高度一致，贴靠按钮在左侧', async () => {
    const boxes = await win.locator('.window-controls button').evaluateAll(elements => elements.map(el => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })));
    results.styles.controls = boxes;
    assert.equal(boxes.length, 4); for (const b of boxes) { closeEnough(b.width, 46); closeEnough(b.height, boxes[0].height); }
    assert((await win.locator('.window-tools').boundingBox()).x < (await win.locator('.window-controls').boundingBox()).x);
  });
  for (const mode of ['left', 'right', 'maximized']) {
    await check(`${mode}零边距摆放、拖动保留尺寸、可继续缩放`, async () => {
      if (mode === 'maximized') await win.locator('.window-maximize').click();
      else await win.getByRole('button', { name: mode === 'left' ? '窗口左侧贴靠' : '窗口右侧贴靠', exact: true }).click();
      const before = await win.boundingBox();
      closeEnough(before.width, mode === 'maximized' ? area.width : area.width / 2);
      closeEnough(before.height, area.height); closeEnough(before.x, mode === 'right' ? area.width / 2 : 0); closeEnough(before.y, area.y);
      assert.equal(await win.locator('.resize-handle:visible').count(), 8);
      await drag(mode === 'right' ? -75 : 75, 35);
      const after = await win.boundingBox();
      closeEnough(after.width, before.width); closeEnough(after.height, before.height); assert(Math.abs(after.x - before.x) > 30); assert(after.y > before.y + 20);
      await win.locator('.resize-handle.se').focus(); await page.keyboard.press('ArrowLeft');
      closeEnough((await win.boundingBox()).width, after.width - 20);
    });
  }
  await page.screenshot({ path: resolve(output, 'placement.png') });
  await check('部分越屏后仍留可直接拖回的标题区域', async () => {
    await win.getByRole('button', { name: '窗口左侧贴靠', exact: true }).click();
    await drag(-2400, 15);
    const b = await win.boundingBox(); assert(b.x < 0 && b.x + b.width >= 79);
    const recoverable = await page.evaluate(() => {
      const title = document.querySelector('.app-window .window-title'); const b = title.getBoundingClientRect();
      for (let x = Math.max(0, b.x) + 5; x < Math.min(innerWidth, b.right) - 4; x += 5) {
        const el = document.elementFromPoint(x, b.y + 22);
        if (el?.closest('.window-title') === title && !el.closest('button')) return true;
      }
      return false;
    });
    await page.screenshot({ path: resolve(output, 'offscreen-recovery.png') });
    assert(recoverable, '剩余可见标题全部是窗口控制按钮，无法直接抓取标题拖回');
  });
  await mock.close();

  const real = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  // 禁止验证过程写入用户偏好及通知；只读真实应用与认证会话。
  await real.route('**/api/preferences', async route => { if (route.request().method() !== 'GET') await route.fulfill({ json: {} }); else await route.continue(); });
  await real.route('**/api/notifications', async route => { if (route.request().method() !== 'GET') await route.fulfill({ json: { items: [] } }); else await route.continue(); });
  const actual = await real.newPage();
  const account = JSON.parse(await readFile('.runtime/local/account.json', 'utf8'));
  await actual.goto(origin);
  await actual.getByRole('textbox', { name: '登录账号', exact: true }).fill(account.username);
  await actual.getByRole('textbox', { name: '登录密码', exact: true }).fill(account.password);
  await actual.getByRole('button', { name: '登 录', exact: true }).click();
  await actual.getByRole('button', { name: '所有应用', exact: true }).waitFor();
  for (const [id, name, entry, root, sidebar] of [
    ['personal-center', '个人中心', 'http://127.0.0.1:14331/profile', '.app-shell', '.app-sidebar'],
    ['token-one', 'Token One', 'http://127.0.0.1:14311/dashboard', '.workspace-shell', '.workspace-sidebar'],
  ]) {
    await check(`${name}真实嵌入透明与独立访问背景`, async () => {
      await actual.locator('.desktop-shortcuts button').filter({ hasText: new RegExp(`^${name}$`) }).click();
      const iframe = actual.frameLocator(`iframe[title="${name}"]`);
      await iframe.locator(root).waitFor();
      await iframe.locator(sidebar).waitFor();
      const host = actual.locator('.app-window').filter({ has: actual.locator(`iframe[title="${name}"]`) });
      await host.locator(':scope.integrated').waitFor();
      await iframe.locator('.el-loading-mask:visible').first().waitFor({ state: 'hidden', timeout: 15000 });
      const state = await iframe.locator(root).evaluate((el, sidebar) => {
        const style = getComputedStyle(el), nav = getComputedStyle(document.querySelector(sidebar));
        return { root: [style.backgroundColor, style.backgroundImage], sidebar: [nav.backgroundColor, nav.backgroundImage], embedded: document.documentElement.classList.contains('desktop-embedded') };
      }, sidebar);
      const blur = await host.evaluate(el => getComputedStyle(el).backdropFilter);
      assert(blur.includes('blur(24px)')); assert(state.embedded);
      assert.deepEqual(state.root, ['rgba(0, 0, 0, 0)', 'none']); assert.deepEqual(state.sidebar, ['rgba(0, 0, 0, 0)', 'none']);
      await actual.screenshot({ path: resolve(output, `${id}-glass.png`) });
      const standalone = await real.newPage(); await standalone.goto(entry); await standalone.locator(root).waitFor();
      const independent = await standalone.locator(root).evaluate((el, sidebar) => {
        const style = getComputedStyle(el), nav = getComputedStyle(document.querySelector(sidebar));
        return { root: [style.backgroundColor, style.backgroundImage], sidebar: [nav.backgroundColor, nav.backgroundImage], embedded: document.documentElement.classList.contains('desktop-embedded') };
      }, sidebar);
      assert.equal(independent.embedded, false); assert(independent.root[0] !== 'rgba(0, 0, 0, 0)' || independent.root[1] !== 'none');
      assert.notEqual(independent.sidebar[1], 'none');
      results.styles[id] = { blur, embedded: state, standalone: independent };
      await standalone.screenshot({ path: resolve(output, `${id}-browser.png`) }); await standalone.close();
    });
  }
  await real.close();
} finally {
  await browser.close();
  await writeFile(resolve(output, 'verification.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  if (results.failures.length) process.exitCode = 1;
}
