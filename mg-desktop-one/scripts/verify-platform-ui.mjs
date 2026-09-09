import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const account = JSON.parse(await readFile('.runtime/local/account.json', 'utf8'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], results = [], failedRequests = [];
page.on('pageerror', error => errors.push(error.message));
page.on('response', response => { if (response.status() >= 400) failedRequests.push({ path: new URL(response.url()).pathname, status: response.status() }); });
await mkdir('.runtime/platform-ui', { recursive: true });
try {
  await page.goto('http://127.0.0.1:4301/');
  await page.getByRole('textbox', { name: '登录账号', exact: true }).fill(account.username);
  await page.getByRole('textbox', { name: '登录密码', exact: true }).fill(account.password);
  await page.getByRole('button', { name: '登 录', exact: true }).click();
  for (const [name, shell, sidebar, content, header] of [
    ['统一身份', '.app-shell', '.app-sidebar', '.app-content', '.app-header'],
    ['Token One', '.workspace-shell', '.workspace-sidebar', '.workspace-main', '.workspace-topbar'],
    ['指标知识库', '.app-shell', '.app-sidebar', '.app-content', '.app-header'],
  ]) {
    await page.getByRole('button', { name: `打开${name}`, exact: true }).click();
    const frameElement = page.locator(`iframe[title="${name}"]`);
    const win = page.locator('.app-window').filter({ has: frameElement });
    await page.waitForFunction(name => [...document.querySelectorAll('.app-window.integrated')].some(w => w.querySelector('iframe')?.title === name), name);
    const frame = await (await frameElement.elementHandle()).contentFrame();
    await frame.locator(content).waitFor();
    assert.equal(await frame.locator(header).isVisible(), false, `${name} 内嵌页头隐藏`);
    assert.equal(Math.round((await frame.locator(sidebar).boundingBox()).width), 64, `${name} 默认收起`);
    await frame.getByRole('button', { name: '展开导航', exact: true }).click();
    assert.equal(Math.round((await frame.locator(sidebar).boundingBox()).width), 256);
    await frame.getByRole('button', { name: '收起导航', exact: true }).click();
    if (!(await win.getAttribute('class')).includes('maximized')) await win.getByRole('button', { name: `最大化或还原${name}`, exact: true }).click();
    assert.deepEqual(await win.boundingBox(), await page.locator('.work-area').boundingBox(), '最大化铺满可用区域');
    assert.equal(await win.evaluate(el => getComputedStyle(el).borderRadius), '14px', '最大化保留圆角');
    assert.notEqual(await win.evaluate(el => getComputedStyle(el).boxShadow), 'none');
    assert.equal(await page.locator('.work-area').evaluate(el => getComputedStyle(el).overflow), 'visible', '外阴影可以延伸到底部 Dock 区域');
    assert.equal(await win.locator('.window-title').evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)');
    const geometry = await frame.evaluate(({ shell, content, sidebar }) => {
      const root = document.querySelector(shell), panel = document.querySelector(content), nav = document.querySelector(sidebar);
      return { top: panel.getBoundingClientRect().top, shadow: getComputedStyle(panel).boxShadow, gradient: getComputedStyle(root).backgroundImage,
        sidebarBackground: getComputedStyle(nav).backgroundColor, sidebarImage: getComputedStyle(nav).backgroundImage };
    }, { shell, content, sidebar });
    assert.equal(geometry.top, 42, '内容上方为同一应用画布中的标题区，阴影不在 iframe 顶部裁切');
    assert.notEqual(geometry.shadow, 'none');
    assert.notEqual(geometry.gradient, 'none');
    assert.equal(geometry.sidebarBackground, 'rgba(0, 0, 0, 0)');
    assert.equal(geometry.sidebarImage, 'none');
    const expectedPath = new URL(frame.url()).pathname;
    const popupPromise = page.context().waitForEvent('page');
    await win.getByRole('button', { name: `在浏览器中打开${name}`, exact: true }).click();
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded');
    await popup.locator(header).waitFor({ state: 'visible' });
    assert.equal(new URL(popup.url()).pathname, expectedPath);
    assert.equal(new URL(popup.url()).searchParams.has('embed'), false);
    assert.equal(await popup.evaluate(() => window.opener === null), true);
    await popup.close();
    // 内部路由去掉接入参数后，重新加载仍应识别桌面窗口。
    await frame.evaluate(() => { history.replaceState(null, '', location.pathname); location.reload(); });
    await frame.locator(sidebar).waitFor();
    await frame.waitForFunction(() => document.documentElement.classList.contains('desktop-embedded'));
    assert.equal(await frame.locator(header).isVisible(), false);
    for (const width of [768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await frame.getByRole('button', { name: '展开导航', exact: true }).waitFor();
      assert.equal(await frame.locator(sidebar).isVisible(), true);
      await frame.getByRole('button', { name: '展开导航', exact: true }).click();
      await frame.getByRole('button', { name: '收起导航', exact: true }).click();
      assert.equal(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: `.runtime/platform-ui/${name}.png` });
    results.push({ name, passed: true, geometry });
  }
  assert.deepEqual(errors, []);
  await writeFile('.runtime/platform-ui/result.json', JSON.stringify({ passed: true, results, errors }, null, 2));
  console.log('三个应用的平台布局、透明标题、阴影、零边距最大化、独立浏览器入口与窄屏导航通过。');
} catch (error) {
  console.error(JSON.stringify({ results, errors, failedRequests, alerts: await page.locator('.window-error').allTextContents(), frames: page.frames().map(f => f.url()) }));
  await page.screenshot({ path: '.runtime/platform-ui/failure.png' });
  throw error;
} finally { await browser.close(); }
