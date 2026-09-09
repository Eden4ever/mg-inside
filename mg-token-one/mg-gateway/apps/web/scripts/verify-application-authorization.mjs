import assert from 'node:assert/strict';
const { chromium } = await import(new URL('../../../../../mg-desktop-one/node_modules/playwright/index.mjs', import.meta.url));
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-features=LocalNetworkAccessChecks'] });
const desktop = 'http://127.0.0.1:4301', web = 'http://127.0.0.1:14311';
const cases = [['/dashboard', 'token-one', '.workspace-nav'], ['/admin/stats', 'token-one-console', '.workspace-nav'], ['/docs', 'token-one-docs', '.docs-main']];
try {
  for (const [path, id, content] of cases) {
    const context = await browser.newContext();
    let allowed = true;
    const identities = [];
    await context.route(`${desktop}/api/**`, async route => {
      const pathname = new URL(route.request().url()).pathname;
      let data = { monthly: { isUnlimited: true, appliedGroups: [] }, today: {}, period: {}, list: [] }, status = 200;
      if (pathname.includes('/auth/me/')) {
        identities.push(pathname);
        assert.equal(pathname, `/api/apps/${id}/auth/me/${id}`);
        status = allowed ? 200 : 403;
        data = { id: 7, username: 'ordinary-user', displayName: '普通业务用户', role: 'user' };
      } else if (pathname.endsWith('/session')) data = { csrfToken: 'mock', apps: allowed ? [{ id }] : [] };
      else if (/\/admin\/stats\/(by-|trend)/.test(pathname)) data = [];
      await route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': web, 'Access-Control-Allow-Credentials': 'true' }, body: JSON.stringify(data) });
    });
    await context.route(`${desktop}/auth/start*`, route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<h1>统一认证</h1>' }));
    const page = await context.newPage();
    await page.goto(web + path);
    await page.locator(content).waitFor();
    assert(identities.length > 0);
    assert.equal(new URL(page.url()).pathname, path, '普通业务角色可进入已授权应用');
    allowed = false;
    await page.reload();
    await page.getByRole('heading', { name: '统一认证' }).waitFor().catch(async error => { console.log({ id, url: page.url(), identities, body: (await page.locator('body').innerText()).slice(0, 300) }); throw error; });
    assert.equal(new URL(page.url()).searchParams.get('app'), id, '无授权时进入自身认证入口');
    await context.close();
  }
  console.log('通过：门户/控制台/文档使用各自固定授权接口；普通业务用户可进入授权控制台；撤权重载进入对应统一认证。');
} finally { await browser.close(); }
