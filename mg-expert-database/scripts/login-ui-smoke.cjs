// 登录界面回归：本地默认凭据、认证及企业微信全部浏览器模拟；不读取/提交真实凭据。
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { mkdirSync } = require('node:fs');
const assert = require('node:assert/strict');
const baseUrl = process.env.PRIMARY_UI_BASE_URL || 'http://localhost:5173';
const artifacts = 'artifacts/login-ui';
const demo = { username: 'demo.account', password: 'UI-demo-only-2026!' };

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  let page;
  try {
    mkdirSync(artifacts, { recursive: true });
    page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    page.setDefaultTimeout(15000);
    const errors = [], unexpectedRequests = [];
    let wecomEnabled = false;
    let loginCalls = 0, wecomCalls = 0, releaseLogin;
    const loginGate = new Promise(resolve => { releaseLogin = resolve; });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/__local-login-defaults', route => route.fulfill({ json: demo }));
    await page.route('**/api/**', async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (!path.startsWith('/api/')) return route.continue();
      if (path === '/api/auth/me' && request.method() === 'GET') return route.fulfill({ status: 401, json: { message: '请先登录' } });
      if (path === '/api/ai/status' && request.method() === 'GET') return route.fulfill({ json: { configured: false } });
      if (path === '/api/auth/wecom/status' && request.method() === 'GET') return route.fulfill({ json: { enabled: wecomEnabled, message: wecomEnabled ? '' : '企业微信登录暂未启用' } });
      if (path === '/api/auth/login' && request.method() === 'POST') {
        assert.deepEqual(request.postDataJSON(), demo, '只允许演示凭据进入模拟登录请求');
        loginCalls++;
        await loginGate;
        return route.fulfill({ status: 401, json: { message: '演示登录验证完成，请使用实际账号登录' } });
      }
      if (path === '/api/auth/wecom/start' && request.method() === 'POST') {
        wecomCalls++;
        return route.fulfill({ status: 503, json: { message: '企业微信演示验证完成' } });
      }
      unexpectedRequests.push(`${request.method()} ${path}`);
      return route.abort('blockedbyclient');
    });
    const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const screenshot = name => page.screenshot({ path: `${artifacts}/${name}.png`, fullPage: true, animations: 'disabled' });
    async function ready() {
      await page.getByLabel('账号', { exact: true }).waitFor();
      await page.waitForFunction(() => document.querySelector('input[autocomplete="username"]')?.value === 'demo.account');
      await page.evaluate(() => document.fonts.ready);
      await page.locator('.wecom-logo').evaluate(image => image.decode());
      assert.equal(await page.getByLabel('密码', { exact: true }).inputValue(), demo.password);
      assert.equal(await page.getByText('使用已分配的系统账号', { exact: true }).count(), 0);
      assert.equal(await page.getByText('账号权限由系统管理员统一配置', { exact: true }).count(), 0);
      assert.equal(await page.locator('.login-brand h1').evaluate(el => getComputedStyle(el).fontWeight), '400');
      assert.equal(await page.locator('.wecom-logo').evaluate(el => getComputedStyle(el).filter), 'none');
      assert.equal(await page.locator('.wecom-logo').getAttribute('alt'), '');
    }
    async function noOverflow() {
      const state = await page.locator('.login-page').evaluate(el => ({ own: el.scrollWidth - el.clientWidth, outer: document.documentElement.scrollWidth - document.documentElement.clientWidth, documentTop: document.scrollingElement.scrollTop }));
      assert.ok(state.own <= 1 && state.outer <= 1 && state.documentTop === 0, `登录页不应横向溢出或依赖外层文档滚动：${JSON.stringify(state)}`);
    }
    await page.goto(`${baseUrl}/systems`);
    await ready();
    for (const viewport of [{ width: 1500, height: 1000 }, { width: 768, height: 1000 }, { width: 390, height: 844 }, { width: 320, height: 720 }, { width: 390, height: 480 }, { width: 320, height: 420 }]) {
      await page.setViewportSize(viewport);
      await page.locator('.login-page').evaluate(el => { el.scrollTop = 0; });
      await settle();
      await noOverflow();
      const brand = await page.locator('.login-brand').boundingBox();
      assert.ok(brand && brand.y >= 0, '短屏顶部品牌不可被居中布局裁切');
      const card = await page.locator('.login-card').boundingBox();
      assert.ok(card && card.x >= 0 && card.x + card.width <= viewport.width);
      const logos = await page.locator('.wecom-logo').boundingBox();
      assert.ok(logos && logos.width === 22 && logos.height === 18, '企业微信标识应按原始比例放在22×18容器内');
      await screenshot(`login-${viewport.width}x${viewport.height}`);
      if (viewport.height <= 480) {
        const moved = await page.locator('.login-page').evaluate(el => { el.scrollTop = el.scrollHeight; return el.scrollTop; });
        assert.ok(moved > 0, '短屏应可以自然纵向滚动');
        const wecomButton = await page.locator('.wecom-button').boundingBox();
        assert.ok(wecomButton && wecomButton.y >= 0 && wecomButton.y + wecomButton.height <= viewport.height, '短屏滚动后企业微信按钮仍完整可达');
        await screenshot(`login-bottom-${viewport.width}x${viewport.height}`);
      }
    }
    await page.setViewportSize({ width: 1500, height: 1000 });
    await page.locator('.login-page').evaluate(el => { el.scrollTop = 0; });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const animated = await page.locator('.login-glow').evaluateAll(items => items.map(el => ({ name: getComputedStyle(el).animationName, duration: parseFloat(getComputedStyle(el).animationDuration) })));
    assert.equal(animated.length, 2);
    assert.ok(animated.every(item => item.name !== 'none' && item.duration >= 20 && item.duration <= 35), '背景仅使用低速光晕动画');
    assert.equal(await page.locator('.login-ambience').getAttribute('aria-hidden'), 'true');
    assert.equal(await page.locator('.login-ambience').evaluate(el => getComputedStyle(el).pointerEvents), 'none');
    const before = await page.locator('.login-card').boundingBox();
    const transformBefore = await page.locator('.login-glow-blue').evaluate(el => getComputedStyle(el).transform);
    await page.waitForTimeout(400);
    const after = await page.locator('.login-card').boundingBox();
    const transformAfter = await page.locator('.login-glow-blue').evaluate(el => getComputedStyle(el).transform);
    assert.deepEqual(after, before, '背景运动不能导致卡片或表单位移');
    assert.notEqual(transformAfter, transformBefore, '常态下背景光晕应有轻微移动');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.ok((await page.locator('.login-glow').evaluateAll(items => items.map(el => getComputedStyle(el).animationName))).every(name => name === 'none'), '减少动态效果偏好必须停止背景动画');
    await screenshot('login-reduced-motion');

    wecomEnabled = true;
    await page.reload(); await ready();
    assert.equal(await page.getByRole('button', { name: '企业微信扫码登录', exact: true }).isEnabled(), true);
    await page.getByLabel('账号', { exact: true }).focus();
    await screenshot('login-wecom-enabled-focus');
    // 标准表单Enter触发一次登录；等待期间重复Enter与按钮点击均不得并发提交。
    await page.getByLabel('密码', { exact: true }).press('Enter');
    await page.waitForFunction(() => document.querySelector('input[autocomplete="username"]').disabled);
    await page.keyboard.press('Enter');
    assert.equal(loginCalls, 1);
    assert.equal(await page.getByRole('button', { name: '企业微信扫码登录', exact: true }).isDisabled(), true);
    releaseLogin();
    await page.getByText('演示登录验证完成，请使用实际账号登录', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('账号', { exact: true }).inputValue(), demo.username);
    assert.equal(await page.getByLabel('密码', { exact: true }).inputValue(), demo.password);
    await page.getByRole('button', { name: '企业微信扫码登录', exact: true }).click();
    await page.getByText('企业微信演示验证完成', { exact: true }).waitFor();
    assert.equal(wecomCalls, 1);
    assert.deepEqual(errors, []); assert.deepEqual(unexpectedRequests, []);
    console.log('登录界面1500/768/390/320及短屏布局、品牌字重、用户提供企业微信标识、精简文案、克制动效/减少动态效果、Enter登录防重复和企业微信入口验证通过。全部凭据及认证请求为浏览器演示模拟，未读取或提交真实凭据。');
  } catch (error) {
    await page?.screenshot({ path: `${artifacts}/failure.png`, fullPage: true });
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
