import { chromium, expect } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 所有目录与写入接口都被拦截，测试不修改真实用户数据。
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let items = [
    { id: 'app-manager', name: '应用管理', description: '平台目录', developer: '平台团队', revision: 1, enabled: true, kind: 'system', editable: true, available: true, entryUrl: 'http://127.0.0.1:14341', defaultPath: '/applications', icon: 'knowledge', minWidth: 600, minHeight: 400 },
    { id: 'personal-center', name: '个人中心', description: '个人资料与偏好', kind: 'default', editable: true, available: true, entryUrl: 'http://127.0.0.1:14331', defaultPath: '/profile', icon: 'personal', minWidth: 600, minHeight: 400 },
    { id: 'private-app', name: '受限内部应用', description: '无访问权限示例', kind: 'internal', editable: false, available: false, entryUrl: 'https://internal.example', defaultPath: '/', icon: 'token', minWidth: 600, minHeight: 400 },
    { id: 'external-one', name: '团队文档', description: '协作资料', kind: 'external', editable: true, available: true, entryUrl: 'https://docs.example/', defaultPath: '/', icon: 'personal', minWidth: 600, minHeight: 400 },
  ];
  items.push({ id: 'internal-one', name: '内部应用', description: '内部服务', developer: '业务团队', revision: 1, enabled: true, kind: 'internal', editable: true, available: true, entryUrl: 'https://internal.example', defaultPath: '/', icon: 'token', minWidth: 600, minHeight: 400 });
  const writes = []; let failNext = false, conflictNext = false;
  await page.route('**/api/session', route => route.fulfill({ json: { csrfToken: 'test-only-csrf' } }));
  await page.route('**/api/applications**', async route => {
    const request = route.request(), method = request.method(), id = decodeURIComponent(new URL(request.url()).pathname.split('/')[3] || '');
    if (method === 'GET') return route.fulfill({ json: id ? items.find(item => item.id === id) : { items, desktop: { name: '测试桌面' } } });
    if (method === 'OPTIONS') return route.fulfill({ status: 204 });
    expect(request.headers()['x-csrf-token']).toBe('test-only-csrf'); writes.push(method);
    if (failNext) { failNext = false; return route.fulfill({ status: 503, json: { message: '测试保存失败' } }); }
    if (conflictNext) { conflictNext = false; return route.fulfill({ status: 409, json: { message: '应用信息已被更新，请重新打开编辑后再保存' } }); }
    if (method === 'DELETE') { items = items.filter(item => item.id !== id); return route.fulfill({ json: { ok: true } }); }
    const input = request.postDataJSON();
    if (method === 'PATCH') {
      const previous = items.find(item => item.id === id);
      expect(previous).toBeTruthy();
      if (previous.kind !== 'external') expect(input.expectedRevision).toBe(previous.revision);
      const updated = { ...previous, ...input, revision: (previous.revision || 0) + 1 };
      items = items.map(item => item.id === id ? updated : item);
      return route.fulfill({ json: updated });
    }
    const item = { id: id || 'external-new', name: input.name, description: input.description, developer: input.developer, entryUrl: input.url, icon: input.icon, kind: 'external', editable: true, available: true, defaultPath: '/', minWidth: 600, minHeight: 400 };
    items = id ? items.map(value => value.id === id ? item : value) : [...items, item];
    return route.fulfill({ status: id ? 200 : 201, json: item });
  });
  await page.goto(process.env.APP_URL || 'http://127.0.0.1:14341/applications');
  await expect(page.getByRole('article')).toHaveCount(5);
  const personalIcon = page.getByRole('article', { name: '个人中心', exact: true }).locator('.mg-application-icon');
  await expect(personalIcon).toHaveCSS('width', '44px');
  await expect(personalIcon).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect.poll(() => personalIcon.locator('img').first().evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
  for (const name of ['应用管理', '个人中心']) {
    const card = page.getByRole('article', { name, exact: true });
    await expect(card.getByRole('button', { name: `编辑${name}` })).toHaveCount(1);
    await expect(card.getByRole('switch')).toHaveCount(0);
    await expect(card.getByRole('button', { name: `移除${name}` })).toHaveCount(0);
  }
  await expect(page.getByRole('article', { name: '受限内部应用', exact: true }).getByRole('button', { name: /编辑|移除/ })).toHaveCount(0);
  await expect(page.getByRole('article', { name: '个人中心', exact: true }).getByText('默认可用，无需授权', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '打开个人中心', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '打开受限内部应用', exact: true })).toBeDisabled();
  await expect(page.getByText('无访问权限', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '搜索应用', exact: true }).fill('协作'); await expect(page.getByRole('article')).toHaveCount(1);
  await page.getByRole('textbox', { name: '搜索应用', exact: true }).fill('');
  await page.locator('.application-category .el-select__wrapper').click();
  await expect(page.getByRole('option')).toHaveCount(5);
  await page.getByRole('option', { name: '默认应用', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(1); await expect(page.getByRole('article', { name: '个人中心', exact: true })).toBeVisible();
  for (const [label, name] of [['系统应用', '应用管理'], ['内部应用', '受限内部应用'], ['外部应用', '团队文档']]) {
    await page.locator('.application-category .el-select__wrapper').click();
    await page.getByRole('option', { name: label, exact: true }).click();
    await expect(page.getByRole('article')).toHaveCount(label === '内部应用' ? 2 : 1); await expect(page.getByRole('article', { name, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('switch', { name: '启停团队文档' }).locator('..')).toBeVisible();
  await page.getByRole('textbox', { name: '搜索应用', exact: true }).fill('不存在的关键词'); await expect(page.getByText('没有匹配的应用', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '搜索应用', exact: true }).fill('');
  await page.locator('.application-category .el-select__wrapper').click(); await page.getByRole('option', { name: '全部应用', exact: true }).click(); await expect(page.getByRole('article')).toHaveCount(5);
  await page.screenshot({ path: join(tmpdir(), 'app-manager-wide.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: '添加外链应用', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '添加外链应用', exact: true });
  const close = dialog.locator('.el-dialog__headerbtn');
  await expect(close).toBeVisible();
  const closeSize = await close.boundingBox(); expect(closeSize.width).toBeCloseTo(46, 2); expect(closeSize.height).toBeCloseTo(42, 2);
  await close.hover(); await expect(close).toHaveCSS('background-color', 'rgb(196, 43, 28)');
  await expect(close.locator('.el-icon')).toHaveCSS('color', 'rgb(255, 255, 255)');
  await dialog.getByRole('textbox', { name: '应用名称', exact: true }).fill('新外链');
  for (const url of ['javascript:alert(1)', 'https://user:pass@example.com', 'http://example.com']) {
    await dialog.getByRole('textbox', { name: '网页地址', exact: true }).fill(url); await dialog.getByRole('button', { name: '添加应用', exact: true }).click(); await expect(dialog.getByRole('alert')).toBeVisible();
  }
  expect(writes).toHaveLength(0);
  await dialog.getByRole('textbox', { name: '开发者', exact: true }).fill('外链开发团队');
  await dialog.getByRole('textbox', { name: '网页地址', exact: true }).fill('https://new.example/path');
  failNext = true; await dialog.getByRole('button', { name: '添加应用', exact: true }).click(); await expect(dialog.getByText('测试保存失败')).toBeVisible(); await expect(dialog.getByRole('textbox', { name: '应用名称', exact: true })).toHaveValue('新外链');
  await dialog.getByRole('button', { name: '添加应用', exact: true }).click(); await expect(dialog).toBeHidden(); await expect(page.getByRole('article', { name: '新外链', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '编辑新外链', exact: true }).click(); const edit = page.getByRole('dialog', { name: '编辑外链应用', exact: true });
  await edit.getByRole('textbox', { name: '应用名称', exact: true }).fill('已编辑'); await edit.getByRole('button', { name: '保存修改', exact: true }).click(); await expect(edit).toBeHidden(); await expect(page.getByRole('article', { name: '已编辑', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '编辑已编辑', exact: true }).click(); await edit.getByRole('textbox', { name: '应用名称', exact: true }).fill('未保存草稿');
  await edit.getByRole('button', { name: '取消', exact: true }).click(); await page.getByRole('button', { name: '继续编辑', exact: true }).click(); await expect(edit.getByRole('textbox', { name: '应用名称', exact: true })).toHaveValue('未保存草稿');
  await edit.getByRole('button', { name: '取消', exact: true }).click(); await page.getByRole('button', { name: '放弃修改', exact: true }).click(); await expect(edit).toBeHidden();
  await page.getByRole('button', { name: '移除已编辑', exact: true }).click(); await page.getByRole('button', { name: '取消', exact: true }).click(); expect(items.some(item => item.name === '已编辑')).toBe(true);
  await page.getByRole('button', { name: '移除已编辑', exact: true }).click(); await page.getByRole('button', { name: '移除', exact: true }).click(); await expect(page.getByRole('article', { name: '已编辑', exact: true })).toHaveCount(0);
  await expect(page.locator('.el-message-box__wrapper')).toBeHidden();
  await page.getByRole('button', { name: '查看应用管理详情', exact: true }).click();
  const details = page.getByRole('dialog', { name: '应用详情', exact: true });
  await expect(details.getByText('平台团队', { exact: true })).toBeVisible();
  await details.getByRole('button', { name: '编辑元数据', exact: true }).click();
  await details.getByRole('textbox', { name: '开发者', exact: true }).fill('新的开发团队');
  conflictNext = true;
  await details.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(details.getByText('应用信息已被更新，请重新打开编辑后再保存')).toBeVisible();
  await expect(details.getByRole('textbox', { name: '开发者', exact: true })).toHaveValue('新的开发团队');
  await details.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(details).toBeHidden();
  await expect(page.getByRole('article', { name: '应用管理', exact: true }).getByText('新的开发团队')).toBeVisible();
  await page.getByRole('button', { name: '详情应用管理', exact: true }).click();
  await expect(details.getByText('新的开发团队')).toBeVisible();
  await page.screenshot({ path: join(tmpdir(), 'app-manager-details-wide.png'), fullPage: true, animations: 'disabled' });
  await details.getByRole('button', { name: '关闭', exact: true }).click();
  for (const name of ['内部应用', '团队文档']) {
    const toggle = page.getByRole('switch', { name: `启停${name}`, exact: true });
    await toggle.locator('..').click(); await page.getByRole('button', { name: '取消', exact: true }).click(); await expect(toggle).toBeChecked();
    await toggle.locator('..').click(); await page.getByRole('button', { name: '确定', exact: true }).click(); await expect(toggle).not.toBeChecked();
    await expect(page.getByRole('button', { name: `打开${name}`, exact: true })).toBeDisabled();
    await toggle.locator('..').click(); await page.getByRole('button', { name: '确定', exact: true }).click(); await expect(toggle).toBeChecked();
    await expect(page.getByRole('button', { name: `打开${name}`, exact: true })).toBeEnabled();
  }
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: join(tmpdir(), 'app-manager-narrow.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: '添加外链应用', exact: true }).click(); await expect(dialog).toBeVisible();
  await page.screenshot({ path: join(tmpdir(), 'app-manager-dialog-narrow.png'), fullPage: true, animations: 'disabled' });
  const bounds = await dialog.boundingBox(); expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  const size = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  expect(size.scroll).toBe(size.width); expect(size.body).toBe(size.width); expect(errors).toEqual([]);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '详情应用管理', exact: true }).click();
  await expect(details).toBeVisible();
  await page.screenshot({ path: join(tmpdir(), 'app-manager-details-narrow.png'), fullPage: true, animations: 'disabled' });
  const detailsBounds = await details.boundingBox(); expect(detailsBounds.x).toBeGreaterThanOrEqual(0); expect(detailsBounds.x + detailsBounds.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  console.log(JSON.stringify({ passed: true, writes, size, errors }));
} finally { await browser.close(); }


