// Public production smoke test. It performs GET-only checks in a fresh browser
// context and never submits credentials or starts the WeCom authorization flow.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { mkdirSync } = require('node:fs');
const assert = require('node:assert/strict');

const baseUrl = (process.env.PRODUCTION_BASE_URL || 'https://yshj.meta-gravity.com/knowledge-base-inside').replace(/\/$/, '');
const artifacts = 'artifacts/production-stage6-public';

(async () => {
  mkdirSync(artifacts, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const pageErrors = [];
    const failedResources = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('response', response => {
      const url = new URL(response.url());
      if (url.origin !== new URL(baseUrl).origin) return;
      if (response.status() >= 400 && !(url.pathname.endsWith('/api/auth/me') && response.status() === 401)) {
        failedResources.push(`${response.status()} ${url.pathname}`);
      }
    });

    async function verify(pathname, viewport, screenshotName) {
      await page.setViewportSize(viewport);
      const response = await page.goto(`${baseUrl}${pathname}`, { waitUntil: 'networkidle' });
      assert.equal(response?.status(), 200, `${pathname} should return the SPA`);
      await page.getByLabel('账号', { exact: true }).waitFor();
      await page.locator('.wecom-logo').waitFor();
      assert.equal(await page.getByLabel('账号', { exact: true }).inputValue(), '', 'production username must not be prefilled');
      assert.equal(await page.getByLabel('密码', { exact: true }).inputValue(), '', 'production password must not be prefilled');
      assert.equal(await page.getByText('使用已分配的系统账号', { exact: true }).count(), 0);
      assert.equal(await page.getByText('账号权限由系统管理员统一配置', { exact: true }).count(), 0);
      assert.equal(await page.locator('.wecom-logo').evaluate(image => image.complete && image.naturalWidth > 0), true, 'WeCom logo should load');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 1, `${pathname} should not overflow horizontally at ${viewport.width}px`);
      await page.screenshot({ path: `${artifacts}/${screenshotName}.png`, fullPage: true, animations: 'disabled' });
    }

    await verify('/systems', { width: 1500, height: 1000 }, 'login-desktop');
    await verify('/systems/runtime-browser-check/indicators/node-check', { width: 390, height: 844 }, 'login-mobile');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload({ waitUntil: 'networkidle' });
    assert.ok(await page.locator('.login-glow').evaluateAll(items => items.every(item => getComputedStyle(item).animationName === 'none')), 'reduced motion should disable the ambience');
    assert.deepEqual(pageErrors, [], `browser errors: ${pageErrors.join('; ')}`);
    assert.deepEqual([...new Set(failedResources)], [], `failed resources: ${failedResources.join('; ')}`);
    console.log(JSON.stringify({ ok: true, paths: 2, viewports: [1500, 390], artifacts }));
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
