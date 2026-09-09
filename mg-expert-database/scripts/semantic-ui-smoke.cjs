const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { mkdirSync } = require('node:fs');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://localhost:5173/systems');
    await page.getByLabel('账号', { exact: true }).fill(process.env.SEED_ADMIN_USERNAME || 'admin');
    await page.getByLabel('密码', { exact: true }).fill(process.env.SEED_ADMIN_PASSWORD);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.locator('.system-card').first().waitFor();
    await page.getByRole('button', { name: '智能语义库', exact: true }).click();
    await page.getByRole('button', { name: '新建语义库', exact: true }).waitFor();
    mkdirSync('artifacts/semantic-ui', { recursive: true });
    await page.screenshot({ path: 'artifacts/semantic-ui/list.png', fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: '新建语义库', exact: true }).click();
    await page.getByText('来源指标体系版本', { exact: true }).waitFor();
    await page.screenshot({ path: 'artifacts/semantic-ui/create.png', fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '模型管理', exact: true }).click();
    await page.getByText('向量模型', { exact: true }).waitFor();
    await page.getByText('embedding-3', { exact: true }).waitFor();
    await page.screenshot({ path: 'artifacts/semantic-ui/models.png', fullPage: true, animations: 'disabled' });
    if (errors.length) throw new Error(errors.join('; '));
    console.log('智能语义库导航、列表、新建配置页通过；未提交数据、未调用智谱。');
  } finally { await browser.close(); }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
