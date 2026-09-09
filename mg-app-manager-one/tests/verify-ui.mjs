import { chromium, expect } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 所有目录与写入接口都被拦截，测试不修改真实用户数据。
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let items = [
    { id: 'app-manager', name: '应用管理', description: '平台目录', kind: 'system', editable: true, available: true, entryUrl: 'http://127.0.0.1:14341', defaultPath: '/applications', icon: 'knowledge', minWidth: 600, minHeight: 400 },
    { id: 'personal-center', name: '个人中心', description: '个人资料与偏好', kind: 'default', editable: true, available: true, entryUrl: 'http://127.0.0.1:14331', defaultPath: '/profile', icon: 'personal', minWidth: 600, minHeight: 400 },
    { id: 'private-app', name: '受限内部应用', description: '无访问权限示例', kind: 'internal', editable: true, available: false, entryUrl: 'https://internal.example', defaultPath: '/', icon: 'token', minWidth: 600, minHeight: 400 },
    { id: 'external-one', name: '团队文档', description: '协作资料', kind: 'external', editable: true, available: true, entryUrl: 'https://docs.example/', defaultPath: '/', icon: 'personal', minWidth: 600, minHeight: 400 },
  ];
  const writes = []; let failNext = false;
  await page.route('**/api/session', route => route.fulfill({ json: { csrfToken: 'test-only-csrf' } }));
  await page.route('**/api/applications**', async route => {
    const request = route.request(), method = request.method(), id = decodeURIComponent(new URL(request.url()).pathname.split('/')[3] || '');
    if (method === 'GET') return route.fulfill({ json: { items, desktop: { name: '测试桌面' } } });
    if (method === 'OPTIONS') return route.fulfill({ status: 204 });
    expect(request.headers()['x-csrf-token']).toBe('test-only-csrf'); writes.push(method);
    if (failNext) { failNext = false; return route.fulfill({ status: 503, json: { message: '测试保存失败' } }); }
    if (method === 'DELETE') { items = items.filter(item => item.id !== id); return route.fulfill({ json: { ok: true } }); }
    const input = request.postDataJSON();
    const item = { id: id || 'external-new', name: input.name, description: input.description, entryUrl: input.url, icon: input.icon, kind: 'external', editable: true, available: true, defaultPath: '/', minWidth: 600, minHeight: 400 };
    items = id ? items.map(value => value.id === id ? item : value) : [...items, item];
    return route.fulfill({ status: id ? 200 : 201, json: item });
  });
  await page.goto(process.env.APP_URL || 'http://127.0.0.1:14341/applications');
  await expect(page.getByRole('article')).toHaveCount(4);
  const personalIcon = page.getByRole('article', { name: '个人中心', exact: true }).locator('.mg-application-icon');
  await expect(personalIcon).toHaveCSS('width', '44px');
  await expect(personalIcon).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(personalIcon.locator('img')).toHaveClass('rounded');
  await expect(personalIcon.locator('img')).toHaveJSProperty('naturalWidth', 1254);
  expect((await personalIcon.locator('img').boundingBox()).width).toBeCloseTo(44 * .88, 1);
  await expect(page.getByRole('article', { name: '应用管理', exact: true }).locator('.mg-application-icon svg')).toHaveCount(1);
  for (const name of ['应用管理', '个人中心', '受限内部应用']) await expect(page.getByRole('article', { name, exact: true }).getByRole('button', { name: /编辑|移除/ })).toHaveCount(0);
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
    await expect(page.getByRole('article')).toHaveCount(1); await expect(page.getByRole('article', { name, exact: true })).toBeVisible();
  }
  await expect(page.getByText('我的外链 · 仅自己可见', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '搜索应用', exact: true }).fill('不存在的关键词'); await expect(page.getByText('没有匹配的应用', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '搜索应用', exact: true }).fill('');
  await page.locator('.application-category .el-select__wrapper').click(); await page.getByRole('option', { name: '全部应用', exact: true }).click(); await expect(page.getByRole('article')).toHaveCount(4);
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
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: join(tmpdir(), 'app-manager-narrow.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: '添加外链应用', exact: true }).click(); await expect(dialog).toBeVisible();
  await page.screenshot({ path: join(tmpdir(), 'app-manager-dialog-narrow.png'), fullPage: true, animations: 'disabled' });
  const bounds = await dialog.boundingBox(); expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  const size = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  expect(size.scroll).toBe(size.width); expect(size.body).toBe(size.width); expect(errors).toEqual([]);
  await page.route('**/personal-center*.png*', route => route.request().resourceType() === 'image' ? route.abort() : route.fallback());
  await page.reload();
  await expect(personalIcon.locator('svg')).toHaveCount(1);
  await expect(personalIcon.locator('img')).toHaveCount(0);
  await expect(personalIcon).not.toHaveClass(/image-icon/);
  console.log(JSON.stringify({ passed: true, writes, size, errors }));
} finally { await browser.close(); }


