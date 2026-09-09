const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { mkdirSync } = require('node:fs');
async function main() {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto('http://localhost:5173/systems');
    await page.getByLabel('账号', { exact: true }).fill(process.env.SEED_ADMIN_USERNAME || 'admin');
    await page.getByLabel('密码', { exact: true }).fill(process.env.SEED_ADMIN_PASSWORD);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.locator('.system-card').first().waitFor();
    await page.getByRole('button', { name: '权限', exact: true }).first().click();
    await page.getByText('系统管理员（最高权限）', { exact: true }).waitFor();
    mkdirSync('artifacts/template-ui', { recursive: true });
    await page.screenshot({ path: 'artifacts/template-ui/access-roles.png', fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await page.getByRole('button', { name: '模板设置', exact: true }).first().click();
    await page.getByRole('dialog').getByRole('tab', { name: '1 级模板', exact: true }).waitFor();
    await page.getByLabel('模块名称').first().waitFor();
    mkdirSync('artifacts/template-ui', { recursive: true });
    await page.screenshot({ path: 'artifacts/template-ui/settings.png', fullPage: true, animations: 'disabled' });
    const firstName = await page.getByLabel('模块名称').first().inputValue();
    await page.getByRole('tab', { name: '2 级模板', exact: true }).click();
    const secondName = await page.getByLabel('模块名称').first().inputValue();
    if (firstName === secondName) throw new Error('一级二级模板未独立加载');
    await page.getByRole('button', { name: '取消', exact: true }).click();
    const counts = await page.locator('.system-card-stats > span:first-child').allTextContents();
    const index = counts.findIndex(text => parseInt(text, 10) > 0);
    if (index < 0) throw new Error('本地没有可验证的指标');
    await page.locator('.system-card-title').nth(index).click();
    await page.locator('.tree-label').first().waitFor();
    await page.locator('.tree-label').first().click();
    await page.getByText('一级指标概述', { exact: true }).waitFor();
    await page.screenshot({ path: 'artifacts/template-ui/level-one.png', fullPage: true, animations: 'disabled' });
    if (errors.length) throw new Error(errors.join('; '));
    console.log('卡片模板入口、一级/二级切换、一级正文和工作区模板入口验证通过');
  } catch (error) { await page.screenshot({ path: 'artifacts/template-ui/error.png', fullPage: true, animations: 'disabled' }); console.error((await page.locator('body').innerText()).slice(0, 1500)); throw error; } finally { await browser.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
