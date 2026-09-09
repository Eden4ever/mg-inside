import { chromium } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const account = JSON.parse(await readFile('.runtime/local/account.json', 'utf8'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const results = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto('http://127.0.0.1:4301/');
  await page.getByRole('textbox', { name: '登录账号', exact: true }).fill(account.username);
  await page.getByRole('textbox', { name: '登录密码', exact: true }).fill(account.password);
  await page.getByRole('button', { name: '登 录', exact: true }).click();
  await page.waitForURL('http://127.0.0.1:4301/');
  for (const [id, name, expected] of [['token-one', 'Token One', '你好'], ['token-one-console', 'Token One 控制台', '统计分析'], ['token-one-docs', 'Token One 文档', '首次调用 API']]) {
    const me = page.waitForResponse(response => response.url().endsWith(`/api/apps/${id}/auth/me/${id}`));
    await page.getByRole('button', { name: '所有应用', exact: true }).click();
    await page.getByRole('button', { name: `启动${name}`, exact: true }).click();
    const response = await me; assert.equal(response.status(), 200, `${name} 身份接口`);
    const frame = page.frameLocator(`iframe[title="${name}"]`);
    await frame.getByRole('heading', { name: new RegExp(expected) }).first().waitFor();
    const content = await frame.locator('body').innerText();
    assert.ok(content.length > 80); assert.equal(await page.locator('.app-window').filter({ has: page.locator(`iframe[title="${name}"]`) }).locator('.window-error').count(), 0);
    results.push({ id, status: response.status(), contentLoaded: true });
  }
  await mkdir('.runtime/token-entries-live', { recursive: true });
  await page.screenshot({ path: '.runtime/token-entries-live/desktop.png' });
  assert.deepEqual(errors, []);
  await writeFile('.runtime/token-entries-live/result.json', JSON.stringify({ passed: true, results, errors }, null, 2));
  console.log('真实演示账号三个 Token One 应用均已打开，身份接口200，页面内容正常。');
} finally { await browser.close(); }
