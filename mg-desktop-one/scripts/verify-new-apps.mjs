import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const account = JSON.parse(await readFile('.runtime/local/account.json', 'utf8'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
// 偏好测试仅在本浏览器上下文模拟持久化，避免更改用户正在使用的真实桌面偏好。
let preferences = { theme: 'light', wallpaper: 'dawn', restore: false, pinned: ['personal-center', 'token-one', 'token-one-docs', 'expert-database', 'identity'] };
await page.route('**/api/preferences', async route => {
  if (route.request().method() === 'PUT') preferences = route.request().postDataJSON();
  await route.fulfill({ json: preferences });
});
await mkdir('.runtime/new-apps', { recursive: true });
try {
  await page.goto('http://127.0.0.1:14331/security');
  await page.getByRole('textbox', { name: '登录账号', exact: true }).fill(account.username);
  await page.getByRole('textbox', { name: '登录密码', exact: true }).fill(account.password);
  await page.getByRole('button', { name: '登 录', exact: true }).click();
  await page.waitForURL('http://127.0.0.1:14331/security');
  await page.getByRole('heading', { name: '账号安全', exact: true }).waitFor();
  assert.equal(await page.locator('.app-header').isVisible(), true);
  const cookies = await page.context().cookies();
  assert.equal(cookies.find(c => c.name === 'mg_desktop_token')?.value, cookies.find(c => c.name === 'mg_identity_session')?.value);
  await page.goto('http://127.0.0.1:4301/');
  await page.getByRole('button', { name: '所有应用', exact: true }).waitFor();
  const directory = await page.evaluate(async () => (await fetch('/api/session')).json());
  const ids = directory.apps.map(app => app.id);
  assert.ok(ids.includes('personal-center')); assert.ok(ids.includes('token-one-docs'));
  assert.equal(ids.includes('token-one-console'), false, '体验用户在业务中是普通用户，即使中心管理员也不显示控制台');
  const statuses = await page.evaluate(async () => Promise.all(['/api/apps/token-one-console/auth/me', '/api/apps/personal-center/users', '/api/apps/personal-center/account-security'].map(async url => (await fetch(url)).status)));
  assert.deepEqual(statuses, [403, 403, 200]);
  await page.getByRole('button', { name: '打开个人中心', exact: true }).click();
  const personal = page.frameLocator('iframe[title="个人中心"]');
  await personal.getByRole('heading', { name: '个人资料', exact: true }).waitFor();
  assert.equal(await personal.locator('.app-header').isVisible(), false);
  await personal.getByRole('button', { name: '账号安全', exact: true }).click();
  await personal.getByRole('heading', { name: '账号安全', exact: true }).waitFor();
  await personal.getByRole('button', { name: '桌面设置', exact: true }).click();
  await personal.getByText('紫色暮光', { exact: true }).click();
  await personal.getByRole('button', { name: '保存设置', exact: true }).click();
  await page.locator('.desktop.dusk').waitFor();
  assert.ok(preferences.pinned.includes('personal-center'));
  await page.getByRole('button', { name: '打开Token One', exact: true }).click();
  const portal = page.frameLocator('iframe[title="Token One"]');
  await portal.getByRole('heading', { name: '你好，桌面体验', exact: true }).waitFor();
  await portal.getByRole('button', { name: '文档中心', exact: true }).click();
  await page.frameLocator('iframe[title="Token One 文档"]').getByRole('navigation', { name: '文档目录', exact: true }).waitFor();
  assert.equal(new URL(await page.locator('iframe[title="Token One"]').getAttribute('src')).pathname, '/dashboard');
  await page.getByRole('button', { name: '打开指标知识库', exact: true }).click();
  await page.getByRole('button', { name: '个人账号', exact: true }).click();
  await personal.getByRole('heading', { name: '个人资料', exact: true }).waitFor();
  assert.equal(await page.locator('iframe[title="个人中心"]').count(), 1);
  await page.screenshot({ path: '.runtime/new-apps/desktop.png' });
  assert.deepEqual(errors, []);
  await writeFile('.runtime/new-apps/result.json', JSON.stringify({ passed: true, ids, statuses, errors, checks: ['个人中心独立原路由登录与同令牌', '真实个人安全读取', '控制台业务角色隔离', '个人中心接口白名单', '偏好同步（隔离模拟）', '文档独立窗口', '知识库复用全局个人中心'] }, null, 2));
  console.log('个人中心、独立文档、真实权限边界、跨应用入口和偏好同步通过。');
} catch (error) {
  console.error(JSON.stringify({ errors, alerts: await page.locator('.window-error').allTextContents() }));
  await page.screenshot({ path: '.runtime/new-apps/failure.png' }); throw error;
} finally { await browser.close(); }
