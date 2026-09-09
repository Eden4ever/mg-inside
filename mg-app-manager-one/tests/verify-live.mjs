import { chromium, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// 仅在明确授权本地联调时执行：创建唯一测试外链，并在 finally 中按返回 ID 清理。
const account = JSON.parse(await readFile(process.env.ACCOUNT_FILE || '../mg-desktop-one/.runtime/local/account.json', 'utf8'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
// 隔离“恢复窗口”偏好以检查实际 localStorage 快照，不改用户的服务端偏好。
await page.route('**/api/preferences', async route => {
  if (route.request().method() === 'PUT') return route.fulfill({ json: route.request().postDataJSON() });
  const response = await route.fetch(); return route.fulfill({ json: { ...await response.json(), restore: true } });
});
const errors = []; page.on('pageerror', error => errors.push(error.name));
const authenticationStatuses = [];
page.on('response', response => { const path = new URL(response.url()).pathname; if (path === '/auth/callback') authenticationStatuses.push({ path, status: response.status() }); });
const name = `界面验证外链-${Date.now()}`;
let createdId, dragEvidence, snapshotWindows, stage = '统一登录';
try {
  await page.goto('http://127.0.0.1:14341/applications');
  await page.getByRole('textbox', { name: '登录账号', exact: true }).fill(account.username);
  await page.getByRole('textbox', { name: '登录密码', exact: true }).fill(account.password);
  await page.getByRole('button', { name: '登 录', exact: true }).click();
  await page.waitForURL('http://127.0.0.1:14341/applications');
  stage = '目录读取';
  await expect(page.getByRole('heading', { name: '应用目录', exact: true })).toBeVisible();
  await expect(page.locator('.app-header')).toBeVisible();
  await expect(page.getByRole('article')).not.toHaveCount(0);
  const before = await page.evaluate(async () => (await fetch('http://127.0.0.1:4301/api/applications', { credentials: 'include' })).json());
  stage = '平台应用只读';
  for (const item of before.items.filter(value => value.kind !== 'external')) {
    const card = page.getByRole('article', { name: item.name, exact: true });
    await expect(card.getByRole('button', { name: /编辑|移除/ })).toHaveCount(0);
    if (!item.available) await expect(card.getByRole('button', { name: `打开${item.name}`, exact: true })).toBeDisabled();
  }
  stage = 'CSRF检查';
  const csrfRejected = await page.evaluate(async () => (await fetch('http://127.0.0.1:4301/api/applications', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '拒绝无CSRF测试', url: 'https://example.com', description: '', icon: 'knowledge' }) })).status);
  expect([401, 403]).toContain(csrfRejected);
  stage = '桌面嵌入';
  await page.goto('http://127.0.0.1:4301/open?app=app-manager');
  const app = page.frameLocator('iframe[title="应用管理"]:not([src*="platformDialog="])');
  await expect(app.getByRole('heading', { name: '应用目录', exact: true })).toBeVisible();
  await expect(app.locator('.app-header')).toBeHidden();
  stage = '注册弹窗关闭保护';
  await app.getByRole('button', { name: '添加外链应用', exact: true }).click();
  const childSelector = 'iframe[src*="platformDialog=external-application"]';
  const child = page.frameLocator(childSelector);
  await expect(child.getByRole('textbox', { name: '应用名称', exact: true })).toBeVisible();
  await child.getByRole('button', { name: '取消', exact: true }).click();
  stage = '空白子窗取消结果';
  await expect(page.locator(childSelector)).toHaveCount(0);
  await app.getByRole('button', { name: '添加外链应用', exact: true }).click();
  await child.getByRole('textbox', { name: '应用名称', exact: true }).fill('仅关闭保护验证，不保存');
  stage = '脏子窗标题栏关闭';
  await page.locator('.app-window').filter({ has: page.locator(childSelector) }).locator('.window-close').click();
  await page.getByRole('button', { name: '继续使用', exact: true }).click();
  stage = '子窗取消业务确认';
  await expect(child.getByRole('textbox', { name: '应用名称', exact: true })).toHaveValue('仅关闭保护验证，不保存');
  await child.getByRole('button', { name: '取消', exact: true }).click();
  await child.getByRole('button', { name: '放弃修改', exact: true }).click();
  stage = '子窗放弃结果';
  await expect(page.locator(childSelector)).toHaveCount(0);
  stage = '外链创建';
  await app.getByRole('button', { name: '添加外链应用', exact: true }).click();
  const dialog = page.frameLocator('iframe[src*="platformDialog=external-application"]');
  await expect(dialog.getByRole('textbox', { name: '应用名称', exact: true })).toBeVisible();
  await expect(dialog.locator('.app-header')).toHaveCount(0);
  const childUrl = new URL(await page.locator(childSelector).getAttribute('src')); expect([...childUrl.searchParams.keys()].sort()).toEqual(['desktopOrigin', 'desktopWindow', 'embed', 'platformDialog'].sort());
  const childWindow = page.locator('.app-window').filter({ has: page.locator(childSelector) });
  const parentWindow = page.locator('.app-window').filter({ has: page.locator('iframe[title="应用管理"]:not([src*="platformDialog="])') });
  const parentBounds = await parentWindow.boundingBox(), titleBounds = await childWindow.locator('.window-title').boundingBox();
  await page.mouse.move(titleBounds.x + 200, titleBounds.y + 20); await page.mouse.down(); await page.mouse.move(220, titleBounds.y + 90, { steps: 12 }); await page.mouse.up();
  const moved = await childWindow.boundingBox(); expect(moved.x).toBeLessThan(parentBounds.x);
  dragEvidence = { parentLeft: parentBounds.x, childLeft: moved.x, childWidth: moved.width };
  const snapshots = await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('mg-desktop-layout:')).flatMap(key => JSON.parse(localStorage.getItem(key) || '[]')));
  expect(snapshots.length).toBeGreaterThan(0); snapshotWindows = snapshots.length;
  expect(snapshots.every(value => !value.dialog && !String(value.path).includes('/applications/editor') && !Object.hasOwn(value, 'params'))).toBe(true);
  expect(JSON.stringify(snapshots)).not.toContain('platformDialog');
  await page.screenshot({ path: 'C:/Users/Eden/AppData/Local/Temp/app-manager-registered-dialog.png', animations: 'disabled' });
  await dialog.getByRole('textbox', { name: '应用名称', exact: true }).fill(name);
  await dialog.getByRole('textbox', { name: '网页地址', exact: true }).fill('https://example.com');
  const created = page.waitForResponse(response => response.url().endsWith('/api/applications') && response.request().method() === 'POST');
  await dialog.getByRole('button', { name: '添加应用', exact: true }).click();
  const response = await created; expect(response.status()).toBe(201); createdId = (await response.json()).id;
  await expect(page.locator('iframe[src*="platformDialog=external-application"]')).toHaveCount(0); await expect(app.getByRole('article', { name, exact: true })).toBeVisible();
  stage = '外链编辑';
  await app.getByRole('button', { name: `编辑${name}`, exact: true }).click();
  const edit = page.frameLocator('iframe[src*="platformDialog=external-application"]');
  await edit.getByRole('textbox', { name: '应用说明', exact: true }).fill('自动化联调完成后删除');
  const updated = page.waitForResponse(value => value.url().endsWith(`/api/applications/${createdId}`) && value.request().method() === 'PUT');
  await edit.getByRole('button', { name: '保存修改', exact: true }).click(); expect((await updated).status()).toBe(200); await expect(page.locator('iframe[src*="platformDialog=external-application"]')).toHaveCount(0);
  stage = '桌面目录刷新和外链隔离';
  await page.getByRole('button', { name: '所有应用', exact: true }).click();
  const shortcut = page.getByRole('button', { name: `启动${name}`, exact: true }); await expect(shortcut).toBeVisible(); await shortcut.click();
  const frame = page.locator(`iframe[title="${name}"]`); await expect(frame).toBeAttached();
  const src = new URL(await frame.getAttribute('src')); expect(src.href).toBe('https://example.com/');
  expect(src.searchParams.has('embed')).toBe(false); expect(src.searchParams.has('token')).toBe(false);
  // 点击 Dock 中的应用管理恢复管理窗口焦点，测试不触碰其它应用。
  await page.getByRole('button', { name: '打开应用管理', exact: true }).click();
  stage = '外链移除';
  await app.getByRole('button', { name: `移除${name}`, exact: true }).click();
  const removed = page.waitForResponse(value => value.url().endsWith(`/api/applications/${createdId}`) && value.request().method() === 'DELETE');
  await app.getByRole('button', { name: '移除', exact: true }).click(); expect((await removed).status()).toBe(200); await expect(app.getByRole('article', { name, exact: true })).toHaveCount(0);
  const after = await page.evaluate(async () => (await fetch('/api/applications')).json());
  expect(after.items.map(value => value.id).sort()).toEqual(before.items.map(value => value.id).sort()); createdId = undefined;
  console.log(JSON.stringify({ passed: true, csrfRejected, dragEvidence, catalog: before.items.map(value => ({ id: value.id, kind: value.kind, available: value.available })), errors }));
} catch (failure) {
  // 不输出登录回调查询参数、凭据或响应正文。
  if (stage !== '统一登录') await page.screenshot({ path: 'C:/Users/Eden/AppData/Local/Temp/app-manager-live-failure.png', animations: 'disabled' });
  console.error(JSON.stringify({ passed: false, stage, detail: failure instanceof Error ? failure.message.split('\n')[0] : '测试失败', pathname: new URL(page.url()).pathname, authenticationStatuses, errors })); process.exitCode = 1;
} finally {
  if (createdId) {
    const session = await (await context.request.get('http://127.0.0.1:4301/api/session')).json();
    const cleanup = await context.request.delete(`http://127.0.0.1:4301/api/applications/${encodeURIComponent(createdId)}`, { headers: { 'X-CSRF-Token': session.csrfToken, Origin: 'http://127.0.0.1:4301' } });
    console.log(JSON.stringify({ cleanupStatus: cleanup.status() }));
  }
  await browser.close();
}
