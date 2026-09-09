import { chromium } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const account = JSON.parse(await readFile('.runtime/local/account.json', 'utf8'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
try {
  await page.goto('http://127.0.0.1:4301/');
  await page.getByRole('textbox', { name: '登录账号', exact: true }).fill(account.username);
  await page.getByRole('textbox', { name: '登录密码', exact: true }).fill(account.password);
  await page.getByRole('button', { name: '登 录', exact: true }).click();
  await page.waitForURL('http://127.0.0.1:4301/');
  const info = await page.evaluate(async () => {
    const session = await (await fetch('/api/session')).json();
    const apps = ['personal-center', 'app-manager', 'expert-database'].map(id => session.apps.find(app => app.id === id));
    if (apps.some(app => !app)) throw new Error('演示账号缺少验收应用授权');
    localStorage.setItem(`mg-desktop-layout:${session.user.id}`, JSON.stringify(apps.map(app => ({ appId: app.id, path: app.defaultPath, rect: { x: 99999, y: -99999, width: 1440, height: 1000 }, mode: 'maximized', minimized: false }))));
    return { desktop: session.desktop, appIds: session.apps.map(app => app.id) };
  });
  await page.reload(); await page.locator('.app-window').nth(2).waitFor();
  await page.waitForTimeout(1000);
  const windows = await page.locator('.app-window').evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect(); return { title: element.getAttribute('aria-label'), x: rect.x, y: rect.y, width: rect.width, height: rect.height, z: Number(getComputedStyle(element).zIndex) };
  }));
  assert.equal(windows.length, 3);
  assert.equal(new Set(windows.map(win => `${win.x},${win.y}`)).size, 3);
  assert.ok(windows[1].y > windows[0].y && windows[2].y > windows[1].y);
  assert.ok(windows[0].z < windows[1].z && windows[1].z < windows[2].z);
  assert.equal(await page.title(), info.desktop.name);
  await mkdir('.runtime/restored-windows', { recursive: true });
  await page.screenshot({ path: '.runtime/restored-windows/cascade.png' });
  await writeFile('.runtime/restored-windows/result.json', JSON.stringify({ passed: true, windows, desktopName: info.desktop.name, appIds: info.appIds }, null, 2));
  console.log('刷新后应用页面、错位层级和配置名称验证通过。');
} finally { await browser.close(); }
