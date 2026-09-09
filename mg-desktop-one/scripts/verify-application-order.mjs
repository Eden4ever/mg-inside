import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

// 使用独立浏览器上下文和模拟接口，不读取或修改真实账号的偏好。
// 所有拖动均由真实鼠标产生 Pointer Events，不派发 DragEvent/dataTransfer。
const origin = process.env.DESKTOP_ORIGIN || 'http://127.0.0.1:4301';
const output = resolve('.runtime/application-order'); await mkdir(output, { recursive: true });
const initialOrder = ['personal-center', 'expert-database', 'token-one', 'identity', 'app-manager', 'token-one-docs'];
const names = ['个人中心排序验证', '知识库排序验证', 'Token排序验证', '认证排序验证', '应用管理排序验证', '文档排序验证'];
const apps = initialOrder.map((id, index) => ({ id, name: names[index], description: '仅用于排序验证', kind: 'internal', icon: ['personal', 'knowledge', 'token', 'identity', 'knowledge', 'knowledge'][index], entryUrl: 'https://application-order.invalid', defaultPath: '/', allowedPaths: ['/'], minWidth: 480, minHeight: 320 }));
let preferences = { theme: 'light', wallpaper: 'dawn', restore: false, pinned: ['personal-center', 'token-one', 'expert-database'], applicationOrder: [...initialOrder] };
const results = { passed: false, checks: [], writes: [], errors: [], unexpectedRequests: [], pointer: null };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.route(`${origin}/api/**`, route => { results.unexpectedRequests.push({ path: new URL(route.request().url()).pathname, method: route.request().method() }); return route.fulfill({ status: 404, json: { message: '测试未声明的接口' } }); });
await context.route(`${origin}/api/session`, route => route.fulfill({ json: { user: { id: 'application-order-isolated', name: '排序验证', username: 'order-test', role: 'member', department: null }, csrfToken: 'order-test-only-csrf', expiresAt: Date.now() / 1000 + 36000, desktop: { name: '隔离排序验证' }, apps } }));
await context.route(`${origin}/api/notifications`, route => route.fulfill({ json: { items: [] } }));
await context.route(`${origin}/api/preferences`, async route => {
  if (route.request().method() === 'PUT') {
    assert.equal(route.request().headers()['x-csrf-token'], 'order-test-only-csrf');
    const value = route.request().postDataJSON();
    assert(Array.isArray(value.pinned) && Array.isArray(value.applicationOrder), '保存时需要同时保留两份顺序');
    preferences = structuredClone(value); results.writes.push({ pinned: [...value.pinned], applicationOrder: [...value.applicationOrder] });
  }
  await route.fulfill({ json: preferences });
});
await context.route('https://application-order.invalid/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<h1>不应由拖动打开此应用</h1>' }));
await context.addInitScript(() => {
  window.__orderPointerMetrics = { down: 0, move: 0, up: 0, untrusted: 0, nativeDrag: 0 };
  for (const [event, key] of [['pointerdown', 'down'], ['pointermove', 'move'], ['pointerup', 'up']]) document.addEventListener(event, value => { window.__orderPointerMetrics[key]++; if (!value.isTrusted) window.__orderPointerMetrics.untrusted++; }, true);
  document.addEventListener('dragstart', () => { window.__orderPointerMetrics.nativeDrag++; }, true);
});
const page = await context.newPage(); page.on('pageerror', error => results.errors.push(error.message));
const dock = () => page.locator('.dock [data-app-id]');
const grid = () => page.locator('.grid-app-launch[data-app-id]');
const dockItem = id => page.locator(`.dock [data-app-id="${id}"]`);
const gridItem = id => page.locator(`.grid-app-launch[data-app-id="${id}"]`);
const ids = locator => locator.evaluateAll(elements => elements.map(element => element.getAttribute('data-app-id')));
async function showGrid() {
  if (!await page.locator('.application-grid').isVisible()) await page.getByRole('button', { name: '所有应用', exact: true }).click();
  await expect(grid()).toHaveCount(apps.length);
}
async function hideGrid() { if (await page.locator('.application-grid').isVisible()) await page.keyboard.press('Escape'); }
async function anchor(locator, before = true) {
  const box = await locator.boundingBox(); assert(box, '拖动目标不可见');
  return { x: box.x + box.width * (before ? .15 : .85), y: box.y + box.height * .5 };
}
async function drag(source, destination, cancel = false) {
  await source.scrollIntoViewIfNeeded(); const box = await source.boundingBox(); assert(box, '拖动源不可见');
  const start = { x: box.x + box.width * .5, y: box.y + Math.min(30, box.height * .5) };
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  // 先跨过拖动阈值，再读取 Dock/网格的实际目标位置，兼容拖动时的浮起状态。
  await page.mouse.move(start.x + 12, start.y + 12, { steps: 4 });
  const target = await destination();
  await page.mouse.move(target.x, target.y, { steps: 20 });
  if (cancel) await page.keyboard.press('Escape');
  await page.mouse.up();
}
async function noAccidentalOpen() {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.locator('.app-window')).toHaveCount(0);
}
async function saved(pinned, applicationOrder) {
  await expect.poll(() => preferences.pinned).toEqual(pinned);
  await expect.poll(() => preferences.applicationOrder).toEqual(applicationOrder);
  await noAccidentalOpen();
}
let stage = '初始偏好';
try {
  await page.goto(origin); await expect.poll(() => ids(dock())).toEqual(preferences.pinned);
  await showGrid(); await expect.poll(() => ids(grid())).toEqual(initialOrder);
  results.checks.push('旧 pinned 与独立 applicationOrder 正确初始化');

  stage = '网格排序';
  const ordered = ['personal-center', 'token-one-docs', 'expert-database', 'token-one', 'identity', 'app-manager'];
  await drag(gridItem('token-one-docs'), () => anchor(gridItem('expert-database')));
  await showGrid(); await expect.poll(() => ids(grid())).toEqual(ordered);
  await saved(['personal-center', 'token-one', 'expert-database'], ordered);
  results.checks.push('网格末项通过真实鼠标拖到第二位，Dock 顺序不变');

  stage = '网格拖到 Dock 中间';
  const inserted = ['personal-center', 'identity', 'token-one', 'expert-database'];
  await drag(gridItem('identity'), () => anchor(dockItem('token-one')));
  await expect.poll(() => ids(dock())).toEqual(inserted); await saved(inserted, ordered);
  results.checks.push('网格应用拖到 Dock 中间固定，网格顺序不变');
  await hideGrid();

  stage = 'Dock 排序';
  const dockOrdered = ['personal-center', 'expert-database', 'identity', 'token-one'];
  await drag(dockItem('expert-database'), () => anchor(dockItem('identity')));
  await expect.poll(() => ids(dock())).toEqual(dockOrdered); await saved(dockOrdered, ordered);
  results.checks.push('Dock 末项通过真实鼠标拖到中间');

  stage = '拖出 Dock 取消固定';
  const unpinned = ['personal-center', 'expert-database', 'identity'];
  await drag(dockItem('token-one'), async () => ({ x: 1120, y: 350 }));
  await expect.poll(() => ids(dock())).toEqual(unpinned); await saved(unpinned, ordered);
  results.checks.push('拖出 Dock 只取消该应用固定');

  stage = 'Escape 取消 Dock 拖动';
  const beforeEscape = structuredClone(preferences);
  await drag(dockItem('identity'), async () => ({ x: 1100, y: 330 }), true);
  await expect.poll(() => ids(dock())).toEqual(unpinned); await noAccidentalOpen();
  assert.deepEqual(preferences, beforeEscape);
  results.checks.push('Escape 取消 Dock 拖出，不改变固定列表且不打开应用');

  stage = 'Escape 取消网格排序';
  await showGrid(); await drag(gridItem('app-manager'), () => anchor(gridItem('personal-center')), true);
  await showGrid(); await expect.poll(() => ids(grid())).toEqual(ordered); await saved(unpinned, ordered);
  results.checks.push('Escape 取消网格排序，不改变顺序且不打开应用');
  await page.screenshot({ path: resolve(output, 'grid-order.png'), animations: 'disabled' });
  results.pointer = await page.evaluate(() => window.__orderPointerMetrics);
  assert(results.pointer.down >= 6 && results.pointer.move >= 120, '必须实际完成六组鼠标拖动');
  assert.equal(results.pointer.untrusted, 0); assert.equal(results.pointer.nativeDrag, 0);

  stage = '刷新后保持两份顺序';
  // 只清当前隔离上下文，避免本地缓存掩盖服务端保存失败。
  await page.evaluate(() => localStorage.clear()); await page.reload();
  await expect.poll(() => ids(dock())).toEqual(unpinned); await showGrid(); await expect.poll(() => ids(grid())).toEqual(ordered);
  await noAccidentalOpen();
  results.checks.push('清隔离缓存后刷新，两份顺序均从模拟服务端恢复');
  assert.deepEqual(results.errors, []); assert.deepEqual(results.unexpectedRequests, []);
  results.passed = true;
} catch (error) {
  results.failure = { stage, message: error.message };
  await page.screenshot({ path: resolve(output, 'failure.png'), animations: 'disabled' }); process.exitCode = 1;
} finally {
  await writeFile(resolve(output, 'result.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results)); await browser.close();
}
