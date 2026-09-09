// 只读布局回归：除本地登录外不提交业务操作，也不调用外部模型。
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { mkdirSync } = require('node:fs');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://localhost:5173/systems');
    await page.getByLabel('账号', { exact: true }).fill(process.env.SEED_ADMIN_USERNAME || 'admin');
    await page.getByLabel('密码', { exact: true }).fill(process.env.SEED_ADMIN_PASSWORD);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.locator('.app-header').waitFor();
    await page.locator('.system-card').first().waitFor();
    mkdirSync('artifacts/shell-ui', { recursive: true });

    async function measureAxis() {
      const centers = await page.locator('.app-sidebar .nav-item .el-icon, .sidebar-toggle .el-icon').evaluateAll(elements => elements.map(element => {
        const box = element.getBoundingClientRect();
        return box.x + box.width / 2;
      }));
      if (centers.some(center => Math.abs(center - 32) > 0.5)) throw new Error('桌面导航图标未保持 x=32 对齐');
      return centers;
    }

    const initial = await measureAxis();
    await page.screenshot({ path: 'artifacts/shell-ui/collapsed.png', fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: '展开导航栏', exact: true }).click();
    const expanded = await measureAxis();
    if (expanded.some((center, index) => Math.abs(center - initial[index]) > 0.5)) throw new Error('展开导航后图标位移');
    await page.screenshot({ path: 'artifacts/shell-ui/expanded.png', fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: '收起导航栏', exact: true }).click();
    await measureAxis();
    const brandWeight = await page.locator('.brand-copy strong').evaluate(element => getComputedStyle(element).fontWeight);
    if (brandWeight !== '400') throw new Error('品牌标题不应加粗');
    if (await page.locator('.header-breadcrumb').innerText() !== '指标体系') throw new Error('顶部有重复标题');

    for (const width of [980, 640, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      if (await page.locator('.app-header').evaluate(element => element.scrollWidth > element.clientWidth + 1)) throw new Error(`顶部在 ${width}px 溢出`);
      await page.getByRole('button', { name: '打开导航', exact: true }).click();
      await page.locator('.app-sidebar.is-mobile-open').waitFor();
      await page.locator('.nav-item[aria-label="个人中心"]').click();
      await page.locator('.profile-page').waitFor();
      if (await page.locator('.app-sidebar').evaluate(element => element.classList.contains('is-mobile-open'))) throw new Error('选择模块后抽屉未收起');
      if (width === 390) await page.screenshot({ path: 'artifacts/shell-ui/mobile.png', fullPage: true, animations: 'disabled' });
    }
    if (errors.length) throw new Error('页面异常：' + errors.join('; '));
    console.log('导航质感回归通过：桌面收起/展开图标轴线一致、品牌不加粗、320–980px 顶栏无溢出、抽屉导航正常。');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
