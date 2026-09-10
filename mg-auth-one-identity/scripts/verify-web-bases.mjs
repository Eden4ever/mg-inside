import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { build } from '../web/node_modules/vite/dist/node/index.js';
import { chromium } from '../web/node_modules/playwright-core/index.mjs';

const output = resolve('.runtime/web-base-verification');
await mkdir(output, { recursive: true });
const directories = { root: resolve(output, 'root'), desktop: resolve(output, 'desktop') };
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/frame-harness') {
    const desktopOrigin = `http://${req.headers.host}`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<script>window.bridgeMessages=[];addEventListener('message',e=>bridgeMessages.push(e.data))</script><iframe style="width:100%;height:850px;border:0" src="/apps/identity/roles?embed=desktop&desktopOrigin=${encodeURIComponent(desktopOrigin)}&desktopWindow=base-test"></iframe>`); return;
  }
  if (path === '/auth/start' || path === '/api/unified/authorize') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<p>验证跳转目标</p>'); return; }
  const base = path.startsWith('/apps/identity/') ? '/apps/identity/' : '/';
  const directory = base === '/' ? directories.root : directories.desktop;
  const relative = decodeURIComponent(path.slice(base.length));
  const file = resolve(directory, relative || 'index.html');
  if (!file.startsWith(directory + sep)) { res.writeHead(403); res.end(); return; }
  try {
    const content = await readFile(file);
    res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' })[extname(file)] || 'text/html; charset=utf-8');
    res.end(content);
  } catch {
    if (extname(file)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(await readFile(resolve(directory, 'index.html')));
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const original = { base: process.env.VITE_APP_BASE, origin: process.env.VITE_DESKTOP_ORIGIN };
let browser;
const checks = [];
try {
  process.env.VITE_DESKTOP_ORIGIN = origin;
  for (const [name, base] of [['root', '/'], ['desktop', '/apps/identity/']]) {
    process.env.VITE_APP_BASE = base;
    await build({ root: resolve('web'), configFile: resolve('web/vite.config.ts'), logLevel: 'error', build: { outDir: directories[name], emptyOutDir: true } });
    const html = await readFile(resolve(directories[name], 'index.html'), 'utf8');
    assert.ok(html.includes(`name="application-base" content="${base}"`));
    assert.ok(html.includes(`src="${base}assets/`));
  }
  checks.push('根路径与/apps/identity/两份构建的资源前缀、application-base正确');
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const account = { userId: 'isolated-user', name: '平台验证用户', role: 'system_admin', identityAuthorized: true, roles: [{ id: 'builtin', key: 'platform-admin', name: '平台管理员' }] };
  async function scenario(authenticated) {
    const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    const requests = [], errors = [];
    await context.route('**/api/**', route => {
      const url = new URL(route.request().url()); requests.push(url.pathname);
      if (url.pathname === '/api/unified/authorize') return route.continue();
      if (url.pathname.endsWith('/auth/me')) return route.fulfill({ status: authenticated ? 200 : 401, json: authenticated ? { user: account, csrfToken: 'test-csrf' } : { message: '请先登录' } });
      if (url.pathname.endsWith('/auth/login')) { authenticated = true; return route.fulfill({ json: { user: account, csrfToken: 'test-csrf' } }); }
      if (url.pathname.endsWith('/status')) return route.fulfill({ json: { enabled: false } });
      return route.fulfill({ json: [] });
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    return { context, page, requests, errors };
  }
  {
    const { context, page, requests, errors } = await scenario(true);
    await page.goto(`${origin}/roles`); await page.getByRole('heading', { name: '角色管理', exact: true }).waitFor();
    assert.ok(requests.includes('/api/auth/me')); assert.ok(!requests.some(p => p.startsWith('/api/apps/')));
    await page.getByRole('button', { name: '员工身份', exact: true }).click(); await page.waitForURL('**/admin');
    await page.locator('.el-loading-mask').waitFor({ state: 'detached' });
    await page.screenshot({ path: resolve(output, 'root-management.png'), animations: 'disabled' });
    assert.deepEqual(errors, []); await context.close();
  }
  checks.push('认证域名根路径管理页继续使用/api，根路径导航保持原样');
  {
    const { context, page, requests, errors } = await scenario(true);
    await page.goto(`${origin}/apps/identity/roles`); await page.getByRole('heading', { name: '角色管理', exact: true }).waitFor();
    assert.ok(requests.includes('/api/apps/identity/auth/me')); assert.ok(!requests.includes('/api/auth/me'));
    await page.getByRole('button', { name: '员工身份', exact: true }).click(); await page.waitForURL('**/apps/identity/admin');
    await page.getByRole('button', { name: '应用授权', exact: true }).click();
    await page.waitForURL('**/apps/identity/applications');
    assert.equal(new URL(page.url()).pathname, '/apps/identity/applications');
    await page.locator('.el-loading-mask').waitFor({ state: 'detached' });
    await page.screenshot({ path: resolve(output, 'desktop-management.png'), animations: 'disabled' });
    assert.deepEqual(errors, []); await context.close();
  }
  checks.push('桌面子路径管理页使用应用代理，内部导航保留挂载前缀');
  {
    const { context, page, requests, errors } = await scenario(true);
    await page.goto(`${origin}/frame-harness`);
    const frame = page.frameLocator('iframe');
    await frame.getByRole('heading', { name: '角色管理', exact: true }).waitFor();
    await page.waitForFunction(() => window.bridgeMessages.some(m => m.type === 'ready' && m.payload?.appId === 'identity'));
    assert.equal(await frame.locator('html').getAttribute('class').then(value => value.includes('desktop-embedded')), true);
    assert.equal(await frame.locator('.app-header').isVisible(), false);
    assert.ok(requests.includes('/api/apps/identity/auth/me'));
    assert.ok(await page.evaluate(() => window.bridgeMessages.some(m => m.type === 'route-change' && m.payload?.path === '/roles')));
    const waitDirty = value => page.waitForFunction(value => window.bridgeMessages.filter(m => m.type === 'dirty-change').at(-1)?.payload?.dirty === value, value);
    await frame.getByRole('button', { name: '员工身份', exact: true }).click();
    await frame.getByRole('textbox', { name: '搜索员工', exact: true }).fill('搜索测试');
    await frame.getByRole('combobox', { name: '账号状态', exact: true }).press('Enter');
    await frame.getByRole('option', { name: '停用', exact: true }).click();
    await waitDirty(false);
    await frame.getByRole('button', { name: '创建身份', exact: true }).click();
    await waitDirty(true);
    await frame.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
    await waitDirty(false);
    await frame.getByRole('button', { name: '管理概览', exact: true }).click();
    await frame.getByRole('heading', { name: '管理概览', exact: true }).waitFor();
    await waitDirty(false);
    await page.evaluate(() => document.querySelector('iframe').contentWindow.postMessage({protocol:'mg-desktop-v1',windowId:'base-test',type:'request-close',requestId:'clean-close'}, location.origin));
    await page.waitForFunction(() => window.bridgeMessages.some(m => m.type === 'close-result' && m.requestId === 'clean-close' && m.payload.allow));
    assert.deepEqual(errors, []); await context.close();
  }
  checks.push('子路径iframe继续使用公共SDK，消息发送应用相对路径并隐藏嵌入页头');
  {
    const { context, page, requests, errors } = await scenario(false);
    await page.goto(`${origin}/apps/identity/roles`); await page.waitForURL('**/auth/start?**');
    const target = new URL(page.url());
    assert.equal(target.origin, origin); assert.equal(target.searchParams.get('app'), 'identity');
    assert.equal(target.searchParams.get('path'), '/roles'); assert.equal(target.searchParams.get('display'), 'standalone');
    assert.ok(!requests.includes('/api/auth/login')); assert.deepEqual(errors, []); await context.close();
  }
  checks.push('非嵌入子路径未登录通过桌面auth/start返回正确应用路由，不在桌面提交中心密码');
  {
    const { context, page, requests, errors } = await scenario(false);
    await page.goto(`${origin}/login?next=${encodeURIComponent('//evil.invalid')}`);
    await page.getByPlaceholder('请输入账号').fill('test-only'); await page.getByPlaceholder('请输入密码').fill('test-only-not-real');
    await page.getByRole('button', { name: /^登\s*录$/ }).click();
    await page.getByRole('heading', { name: '管理概览', exact: true }).waitFor();
    assert.equal(new URL(page.url()).origin, origin); assert.equal(new URL(page.url()).pathname, '/');
    assert.ok(requests.includes('/api/auth/login')); assert.deepEqual(errors, []); await context.close();
  }
  checks.push('认证根路径仍显示并提交原登录表单，外部next不会造成开放重定向');
  {
    const { context, page, errors } = await scenario(true);
    const target = '/api/unified/authorize?client_id=desktop-one&state=test';
    await page.goto(`${origin}/login?next=${encodeURIComponent(target)}`); await page.waitForURL('**/api/unified/authorize?**');
    assert.equal(page.url(), origin + target); assert.deepEqual(errors, []); await context.close();
  }
  checks.push('PKCE登录返回仍进入认证域名根端点，不附加桌面应用前缀');
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ checks }, null, 2));
  console.log(JSON.stringify({ checks }));
} finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve));
  if (original.base === undefined) delete process.env.VITE_APP_BASE; else process.env.VITE_APP_BASE = original.base;
  if (original.origin === undefined) delete process.env.VITE_DESKTOP_ORIGIN; else process.env.VITE_DESKTOP_ORIGIN = original.origin;
}
