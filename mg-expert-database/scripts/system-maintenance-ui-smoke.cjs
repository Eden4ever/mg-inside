// 体系维护只读浏览器回归：登录和读取本地数据，创建/编辑请求全部由浏览器模拟，不写入业务数据库。
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { mkdirSync } = require('node:fs');
const assert = require('node:assert/strict');
const baseUrl = process.env.PRIMARY_UI_BASE_URL || 'http://localhost:5173';
const artifacts = 'artifacts/system-maintenance-ui';

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  let page;
  try {
    mkdirSync(artifacts, { recursive: true });
    page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    page.setDefaultTimeout(15000);
    const errors = [];
    const deniedWrites = [];
    const createdInputs = [];
    const editedInputs = [];
    const renamedNodes = new Map();
    page.on('pageerror', error => errors.push(error.message));
    function updateTree(nodes) {
      return nodes.map(node => ({ ...node, ...renamedNodes.get(node.id), children: updateTree(node.children || []) }));
    }
    await page.route('**/api/**', async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const method = request.method();
      if (method === 'POST' && path === '/api/systems') {
        const input = request.postDataJSON();
        createdInputs.push(input);
        return route.fulfill({ json: { id: 'browser-only-system', versionId: 'browser-only-version', ...input } });
      }
      const nodeMatch = path.match(/^\/api\/indicator-versions\/[^/]+\/nodes\/([^/]+)$/);
      if (method === 'PATCH' && nodeMatch) {
        const input = request.postDataJSON();
        editedInputs.push(input);
        renamedNodes.set(decodeURIComponent(nodeMatch[1]), input);
        return route.fulfill({ json: { id: decodeURIComponent(nodeMatch[1]), ...input } });
      }
      if (method === 'GET' && /\/indicator-versions\/[^/]+\/tree$/.test(path)) {
        const response = await route.fetch();
        const data = await response.json();
        const updated = Array.isArray(data) ? updateTree(data) : Object.fromEntries(Object.entries(data).map(([key, value]) => [key, ['items', 'nodes', 'data'].includes(key) && Array.isArray(value) ? updateTree(value) : value]));
        return route.fulfill({ response, json: updated });
      }
      if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !path.endsWith('/auth/login')) {
        deniedWrites.push(`${method} ${path}`);
        return route.abort('blockedbyclient');
      }
      return route.continue();
    });
    const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const screenshot = async name => {
      await page.locator('.el-message').last().waitFor({ state: 'hidden' });
      await page.locator('.dialog-fade-enter-active').waitFor({ state: 'hidden' });
      return page.screenshot({ path: `${artifacts}/${name}.png`, fullPage: true });
    };
    const noScriptErrors = () => assert.deepEqual(errors, [], '页面不应出现脚本异常（含递归更新）');
    async function noOverflow(selector) {
      const state = await page.locator(selector).evaluate(el => ({ own: el.scrollWidth - el.clientWidth, document: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
      assert.ok(state.own <= 1 && state.document <= 1, `${selector} 不应横向溢出：${JSON.stringify(state)}`);
    }
    async function headerButtonsFit() {
      const checks = await page.locator('.workspace-toolbar button:visible').evaluateAll(buttons => buttons.map(button => {
        const box = button.getBoundingClientRect();
        const toolbar = button.closest('.workspace-toolbar').getBoundingClientRect();
        return box.left >= toolbar.left - 1 && box.right <= toolbar.right + 1 && box.top >= toolbar.top - 1 && box.bottom <= toolbar.bottom + 1;
      }));
      assert.ok(checks.length && checks.every(Boolean), '详情标题栏的全部按钮应位于标题栏内');
    }
    await page.goto(`${baseUrl}/systems`);
    if (!process.env.SEED_ADMIN_PASSWORD) throw new Error('请通过 node --env-file=.env 提供本地登录环境变量。');
    await page.getByLabel('账号', { exact: true }).fill(process.env.SEED_ADMIN_USERNAME || 'admin');
    await page.getByLabel('密码', { exact: true }).fill(process.env.SEED_ADMIN_PASSWORD);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.locator('.system-card').first().waitFor();

    for (const width of [1500, 390]) {
      await page.setViewportSize({ width, height: width === 1500 ? 950 : 844 });
      await page.getByRole('button', { name: '新建指标体系', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '新建指标体系', exact: true });
      await dialog.waitFor();
      assert.deepEqual(await dialog.locator('.el-form-item__label').allTextContents(), ['体系名称', '最大层级', '适用地区']);
      await dialog.getByLabel('体系名称', { exact: true }).fill('浏览器回归验证体系');
      await dialog.getByLabel('适用地区', { exact: true }).fill('测试地区');
      await dialog.locator('.el-select').click();
      await page.getByRole('option', { name: '4 级', exact: true }).click();
      await settle();
      noScriptErrors();
      await noOverflow('.el-dialog');
      await screenshot(`create-${width}`);
      await dialog.getByRole('button', { name: '创建', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      assert.deepEqual(createdInputs.at(-1), { name: '浏览器回归验证体系', region: '测试地区', maxLevel: 4 });
      await page.locator('.system-card').first().waitFor();
    }

    await page.setViewportSize({ width: 1500, height: 950 });
    const counts = await page.locator('.system-card-stats > span:first-child').allTextContents();
    const index = counts.findIndex(text => parseInt(text, 10) > 0);
    assert.ok(index >= 0, '需要一个已包含指标的本地体系');
    await page.locator('.system-card-actions').nth(index).getByRole('button', { name: '进入体系', exact: true }).click();
    await page.locator('.workspace-edit-indicator').waitFor();
    await page.locator('.workspace-loading').waitFor({ state: 'hidden' });

    let lastName;
    for (const width of [1500, 390]) {
      await page.setViewportSize({ width, height: width === 1500 ? 950 : 844 });
      await settle();
      await headerButtonsFit();
      await noOverflow('.detail-page');
      await screenshot(`detail-${width}`);
      await page.getByRole('button', { name: '编辑指标', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '编辑指标节点', exact: true });
      await dialog.waitFor();
      const name = await dialog.getByLabel('指标名称', { exact: true }).inputValue();
      assert.ok(name, '编辑表单必须预填当前指标名称');
      assert.match(await dialog.locator('.el-tag').innerText(), /^[1-6]级指标$/, '编辑弹窗需显示当前指标层级');
      if (lastName) assert.equal(name, lastName, '重新打开表单应显示上次模拟保存后的当前名称');
      await noOverflow('.el-dialog');
      await screenshot(`edit-${width}`);
      lastName = `浏览器模拟指标 ${width}`;
      await dialog.getByLabel('指标名称', { exact: true }).fill(lastName);
      await dialog.getByRole('button', { name: '保存', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      await page.locator('.tree-label .node-text').filter({ hasText: lastName }).waitFor();
      assert.equal(editedInputs.at(-1).name, lastName);
      assert.deepEqual(Object.keys(editedInputs.at(-1)).sort(), ['code', 'name', 'sortOrder']);
      noScriptErrors();
    }
    assert.equal(createdInputs.length, 2);
    assert.equal(editedInputs.length, 2);
    assert.deepEqual(deniedWrites, [], '不应产生其它业务写入');
    noScriptErrors();
    console.log('精简新建体系表单、提交字段、详情编辑当前指标和树名称同步，以及桌面/390 窄屏标题栏按钮与弹窗布局验证通过。无页面异常；全部业务写入均为浏览器模拟，未修改数据库。');
  } catch (error) {
    await page?.screenshot({ path: `${artifacts}/failure.png`, fullPage: true, animations: 'disabled' });
    throw error;
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
