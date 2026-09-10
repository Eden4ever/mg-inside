import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '../web/node_modules/playwright-core/index.mjs';

const origin = process.env.DIRECTORY_PREVIEW_ORIGIN || 'http://127.0.0.1:4201';
if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw new Error('仅允许本地界面验证');
const output = resolve('.runtime/directory-verification');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const users = Array.from({ length: 25 }, (_, i) => ({ id: `sample-${i}`, username: `sample-${i}`, displayName: `测试员工${i}`,
  departmentName: i < 13 ? ' 研发部 ' : i < 24 ? '运营部' : null, role: 'member', roles: [{ id: 'r1', key: null, name: '项目成员' }],
  status: i === 0 ? 'disabled' : 'active', wecomBound: i < 13, wecomIdentities: [], zentaoIdentities: [],
  lastLoginAt: i === 0 ? null : '2026-09-09T02:00:00Z', createdAt: '', updatedAt: '' }));
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const errors = [], writes = [];
  await context.route(url => url.pathname.startsWith('/api/'), route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() !== 'GET') { writes.push(path); return route.abort(); }
    const body = path.endsWith('/auth/me') ? { csrfToken: 'test-only', user: { userId: 'preview', name: '测试管理员', role: 'system_admin', identityAuthorized: true, roles: [{ id: 'builtin', key: 'platform-admin', name: '平台管理员' }] } }
      : path.endsWith('/users') ? users : path.endsWith('/roles') ? [{ id: 'r1', key: null, name: '项目成员', description: '', members: [], applications: [] }] : [];
    return route.fulfill({ json: body });
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/admin`);
  await page.getByText('25 / 25 位员工', { exact: true }).waitFor({ timeout: 15000 }).catch(async error => {
    console.error(JSON.stringify({ url: page.url(), errors, text: (await page.locator('body').innerText()).slice(0,3000) })); throw error;
  });
  await page.locator('.el-loading-mask').waitFor({ state: 'detached' });
  await page.screenshot({ path: resolve(output, 'desktop.png'), animations: 'disabled' });
  await page.getByRole('button', { name: '下一页' }).click();
  await page.getByText('测试员工12', { exact: true }).waitFor();
  async function select(label, option) {
    await page.getByRole('combobox', { name: label, exact: true }).press('Enter');
    await page.getByRole('option', { name: option, exact: true }).click();
  }
  await select('所属部门', '研发部（13）');
  await page.getByText('13 / 25 位员工', { exact: true }).waitFor();
  await select('筛选角色', '项目成员');
  await select('绑定来源', '企业微信');
  await select('账号状态', '停用');
  await page.getByRole('textbox', { name: '搜索员工' }).fill(' sample-0 ');
  await page.getByText('1 / 25 位员工', { exact: true }).waitFor();
  await page.getByText('测试员工0', { exact: true }).waitFor();
  await page.getByText('暂无登录记录', { exact: true }).waitFor();
  await page.getByRole('button', { name: '清除筛选', exact: true }).click();
  await select('所属部门', '未设置部门（1）');
  await page.getByText('测试员工24', { exact: true }).waitFor();
  await page.getByRole('button', { name: '清除筛选', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索员工' }).fill('不存在的员工');
  await page.getByText('没有符合条件的员工').waitFor();
  await page.getByRole('button', { name: '清除筛选', exact: true }).last().click();
  await page.getByText('25 / 25 位员工', { exact: true }).waitFor();
  for (const [name, width, height] of [['narrow', 680, 800], ['mobile', 390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: resolve(output, `${name}.png`), animations: 'disabled' });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} 页面不应横向溢出`);
    const boxes = await page.locator('.directory-toolbar > *').evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom };
    }));
    for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
      const x = boxes[a], y = boxes[b];
      assert.ok(!(x.x < y.right - 1 && x.right > y.x + 1 && x.y < y.bottom - 1 && x.bottom > y.y + 1), `${name} 筛选控件不应重叠`);
    }
  }
  assert.deepEqual(errors, []); assert.deepEqual(writes, []);
  console.log('通过：部门/角色/来源/状态/搜索交集、分页重置、未设置部门、空结果恢复、最近登录、桌面与窄屏布局；仅使用模拟 API，无写请求。');
  await context.close();
} finally { await browser.close(); }
