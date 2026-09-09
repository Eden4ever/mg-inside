import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const artifactDirectory = fileURLToPath(new URL('../node_modules/.cache/platform-entry-test/', import.meta.url));
await mkdir(artifactDirectory, { recursive: true });
// 使用桌面工作区已有的浏览器测试依赖；所有业务 API 和模型流都在浏览器内模拟。
const { chromium } = await import(new URL('../../../../../mg-desktop-one/node_modules/playwright/index.mjs', import.meta.url));
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-features=LocalNetworkAccessChecks'] });
const origin = 'http://127.0.0.1:4301';
const appOrigin = 'http://127.0.0.1:14311';
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const errors = [];
let authenticated = true;
let role = 'admin';
page.on('pageerror', error => errors.push(error.message));
page.on('requestfailed', request => { if (request.failure()?.errorText !== 'net::ERR_ABORTED') console.log('请求失败', request.url(), request.failure()); });
page.on('console', message => { if (message.type() === 'error') console.log('浏览器错误', message.text()); });
await context.route(`${origin}/api/**`, async route => {
  const path = new URL(route.request().url()).pathname;
  const isIdentity = /\/auth\/me(?:\/token-one(?:-console|-docs)?)?$/.test(path);
  const data = isIdentity ? { id: 7, username: 'platform-test', displayName: '测试用户', role }
    : path.endsWith('/portal/models') ? { list: [{ name: 'mock-model' }] }
    : path.endsWith('/session') ? { csrfToken: 'mock-csrf' }
    : /\/admin\/stats\/(by-|trend)/.test(path) ? []
    : { monthly: { isUnlimited: true, appliedGroups: [] }, today: { requests: 0, quota: 0, prompt: 0, completion: 0 }, period: { requests: 0, fails: 0, quota: 0, cost: 0 }, list: [] };
  await route.fulfill({ status: !authenticated && isIdentity ? 401 : 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': appOrigin, 'Access-Control-Allow-Credentials': 'true' }, body: JSON.stringify(data) });
});
await context.addInitScript(() => {
  window.__streamCalls = 0;
  window.__streamAborts = 0;
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (!String(input).includes('/chat/completions')) return realFetch(input, init);
    window.__streamCalls++;
    let timer;
    const body = new ReadableStream({ start(controller) {
      timer = setInterval(() => controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"测试"}}]}\n\n')), 60);
      init.signal.addEventListener('abort', () => { clearInterval(timer); window.__streamAborts++; controller.error(new DOMException('已停止', 'AbortError')); });
    }, cancel() { clearInterval(timer); } });
    return Promise.resolve(new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }));
  };
});
await context.route(`${origin}/platform-entry-test*`, async route => {
  const path = new URL(route.request().url()).searchParams.get('path');
  await route.fulfill({ contentType: 'text/html', body: `<script>window.messages=[];addEventListener('message',event=>messages.push(event.data))</script><iframe style="position:fixed;inset:0;width:100%;height:100%;border:0" name="mg-desktop-v1|${origin}|entry-test" src="${appOrigin}${path}"></iframe>` });
});
async function open(path, id) {
  await page.goto(`${origin}/platform-entry-test?path=${encodeURIComponent(path)}`);
  await page.waitForFunction(id => messages.some(m => m.type === 'ready' && m.payload.appId === id), id).catch(async error => { console.log({ frames: page.frames().map(f => f.url()), errors, messages: await page.evaluate(() => window.messages) }); throw error; });
  const frame = page.frames().find(frame => frame.url().startsWith(appOrigin));
  const sidebar = id === 'token-one-docs' ? '.docs-directory' : '.workspace-sidebar';
  await frame.waitForSelector(sidebar);
  assert.equal(await frame.locator('.mg-application-header').count(), 1);
  assert.equal(await frame.locator('.workspace-topbar').isVisible(), false);
  assert.equal(Math.round((await frame.locator(sidebar).boundingBox()).width), 64);
  const toggle = await frame.getByRole('button', { name: id === 'token-one-docs' ? '展开文档目录' : '展开导航', exact: true }).boundingBox();
  assert(toggle.y + toggle.height > 860, '折叠按钮位于底部');
  return frame;
}
try {
  let frame = await open('/playground', 'token-one');
  await frame.getByRole('button', { name: '文档中心', exact: true }).click();
  await page.waitForFunction(() => messages.some(m => m.type === 'open-application' && m.payload.appId === 'token-one-docs'));
  assert(new URL(frame.url()).pathname === '/playground', '跨应用保持当前窗口原路由');
  assert.equal(await frame.locator('.mg-nav-footer button').count(), 1, '业务导航底部只保留收起开关');
  await frame.getByPlaceholder('sk-...').fill('sk-mock-no-real-usage');
  await frame.getByRole('button', { name: '发送', exact: true }).click();
  await frame.getByRole('button', { name: '停止生成' }).waitFor();
  await frame.getByPlaceholder('问点什么…').press('Enter');
  assert.equal(await frame.evaluate(() => window.__streamCalls), 1, '忙时禁止重复请求');
  await page.evaluate(appOrigin => document.querySelector('iframe').contentWindow.postMessage({ protocol: 'mg-desktop-v1', windowId: 'entry-test', type: 'request-close', requestId: 'busy-close' }, appOrigin), appOrigin);
  await page.waitForFunction(() => messages.some(m => m.type === 'close-result' && m.requestId === 'busy-close' && m.payload.allow === false));
  await frame.getByRole('button', { name: '停止生成' }).click();
  await frame.getByText('已停止', { exact: true }).waitFor();
  assert.equal(await frame.evaluate(() => window.__streamAborts), 1);
  await frame.getByRole('button', { name: '发送', exact: true }).click();
  await frame.getByRole('button', { name: '停止生成' }).waitFor();
  await frame.getByRole('button', { name: '令牌与用量', exact: true }).click();
  await page.waitForFunction(() => messages.filter(m => m.type === 'dirty-change').at(-1)?.payload.busy === false);
  assert.equal(await frame.evaluate(() => window.__streamAborts), 2, '离开调试页取消流');
  frame = await open('/docs', 'token-one-docs');
  assert.equal(await frame.locator('.app-sidebar,.global-nav,.nav-item').count(), 0, '文档使用阅读目录而非业务导航');
  assert.equal(await frame.getByRole('navigation', { name: '文档目录', exact: true }).isVisible(), false);
  assert.equal(await frame.locator('.docs-directory-footer button').count(), 1, '文档底部只保留目录开关');
  await page.screenshot({ path: `${artifactDirectory}/docs-collapsed.png` });
  await frame.getByRole('button', { name: '展开文档目录', exact: true }).click();
  assert.equal(await frame.getByRole('navigation', { name: '文档目录', exact: true }).isVisible(), true);
  assert.equal(await frame.locator('.docs-directory-link').count(), 9, '目录保留全部九篇文章');
  assert.equal(await frame.locator('.docs-directory-link .el-icon').count(), 0, '文章使用文字层级而非图标轨道');
  assert.equal(await frame.locator('.docs-directory-link[aria-current="page"]').count(), 1);
  await page.screenshot({ path: `${artifactDirectory}/docs-expanded.png` });
  await frame.getByRole('link', { name: '首次调用 API', exact: true }).focus();
  await frame.getByRole('link', { name: '首次调用 API', exact: true }).press('Escape');
  assert.equal(await frame.getByRole('navigation', { name: '文档目录', exact: true }).isVisible(), false);
  assert.equal(await frame.getByRole('button', { name: '展开文档目录', exact: true }).evaluate(el => el === document.activeElement), true, '键盘收起目录后焦点回到入口');
  await frame.getByRole('button', { name: '展开文档目录', exact: true }).click();
  await frame.getByRole('link', { name: '模型目录', exact: true }).click();
  await frame.waitForURL('**/docs/models');
  await frame.evaluate(() => location.reload());
  await frame.waitForSelector('.desktop-embedded');
  assert.equal(await frame.locator('.workspace-topbar').isVisible(), false, '文档内部路由重载保留嵌入模式');
  frame = await open('/admin/stats', 'token-one-console');
  assert.equal(await frame.locator('.mg-nav-footer button').count(), 1);
  await page.evaluate(appOrigin => document.querySelector('iframe').contentWindow.postMessage({ protocol: 'mg-desktop-v1', windowId: 'entry-test', type: 'navigate', payload: { path: '/dashboard' } }, appOrigin), appOrigin);
  await page.waitForFunction(() => messages.some(m => m.type === 'open-application' && m.payload.appId === 'token-one'));
  await page.goto(`${appOrigin}/docs`);
  await page.locator('.docs-header').waitFor();
  assert.equal(await page.locator('.docs-header').isVisible(), true, '浏览器独立访问保留页头');
  assert.equal(await page.locator('.mg-application-header').count(), 1, '网页版使用公共顶部栏');
  await page.screenshot({ path: `${artifactDirectory}/docs-browser.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  const accountBox = await page.locator('.mg-application-header').getByRole('button', { name: '个人中心', exact: true }).boundingBox();
  assert(accountBox.x >= 0 && accountBox.x + accountBox.width <= 390, '窄屏公共页头账号入口完整显示');
  await page.getByRole('button', { name: '展开文档目录', exact: true }).click();
  assert((await page.locator('.docs-main').boundingBox()).width > 300, '窄屏展开导航不挤压内容列');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: `${artifactDirectory}/docs-mobile.png` });
  await page.getByRole('link', { name: '流式响应', exact: true }).click();
  await page.waitForURL('**/docs/streaming');
  assert.equal(await page.getByRole('navigation', { name: '文档目录', exact: true }).isVisible(), false, '窄屏选中目录后恢复阅读区域');
  await page.getByRole('button', { name: '展开文档目录', exact: true }).click();
  await page.getByRole('button', { name: '关闭文档目录', exact: true }).click({ position: { x: 350, y: 150 } });
  assert.equal(await page.getByRole('navigation', { name: '文档目录', exact: true }).isVisible(), false, '窄屏可从遮罩退出目录');
  role = 'user';
  await page.goto(`${origin}/platform-entry-test?path=%2Fadmin%2Fstats`);
  await page.frameLocator('iframe').locator('.workspace-main').waitFor();
  assert.equal(await page.frameLocator('iframe').locator('.workspace-main').count(), 1, '普通业务用户凭控制台独立授权进入内容');
  authenticated = false;
  await context.route(`${origin}/auth/start*`, route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<h1>统一登录</h1>' }));
  await page.goto(`${appOrigin}/docs`);
  await page.getByRole('heading', { name: '统一登录', exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('app'), 'token-one-docs', '匿名文档进入自身的统一认证授权入口');
  assert.deepEqual(errors, []);
  console.log('通过：三个入口独立身份、文档统一认证、跨应用窗口、公共页头、阅读目录键盘及窄屏交互、底部仅留开关、业务权限、嵌入重载、模型流取消/防重入/忙态关闭保护。');
} finally { await browser.close(); }
