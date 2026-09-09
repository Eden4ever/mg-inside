// 模板删除/恢复回归：GET/PUT 模板数据全在浏览器模拟，禁止其它业务写入。
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { mkdirSync } = require('node:fs');
const assert = require('node:assert/strict');
const baseUrl = process.env.PRIMARY_UI_BASE_URL || 'http://localhost:5173';
const artifacts = 'artifacts/template-delete-ui';
function fixtures(systemId) {
  return {
    systemId, maxLevel: 3, revisionNo: 9,
    levels: [1, 2, 3].map(level => ({ level, revisionNo: 2, affectedCount: 6, modules: Array.from({ length: level === 2 ? 1 : 3 }, (_, mi) => ({
      moduleKey: `m${mi + 1}`, name: `${level}级模块${mi + 1}`, researchQuestion: '已维护内容的模板模块', displayOrder: mi + 1, active: true,
      fields: ['f1', 'f2', 'f3'].map((fieldId, fi) => ({ fieldId, label: `${level}级模块${mi + 1}字段${fi + 1}`, fieldType: 'long_text', description: '字段原说明不应因删除丢失', requirement: 'optional', active: true })),
    })) })),
  };
}
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  let page;
  try {
    mkdirSync(artifacts, { recursive: true });
    page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    page.setDefaultTimeout(15000);
    const errors = [], deniedWrites = [], saves = [];
    let releaseSave;
    const saveGate = new Promise(resolve => { releaseSave = resolve; });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', async route => {
      const req = route.request();
      const path = new URL(req.url()).pathname;
      const match = path.match(/^\/api\/systems\/([^/]+)\/templates$/);
      if (match && req.method() === 'GET') return route.fulfill({ json: fixtures(match[1]) });
      if (match && req.method() === 'PUT') {
        const input = req.postDataJSON(); saves.push(input); await saveGate;
        return route.fulfill({ json: { systemId: match[1], maxLevel: input.maxLevel, revisionNo: 10, levels: input.levels.map(item => ({ ...item, revisionNo: 3, affectedCount: 6 })) } });
      }
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method()) && !path.endsWith('/auth/login')) { deniedWrites.push(`${req.method()} ${path}`); return route.abort('blockedbyclient'); }
      return route.continue();
    });
    const dialog = () => page.locator('.template-settings-dialog');
    const nav = () => dialog().locator('.template-nav-tree');
    const actions = () => dialog().locator('.template-nav-actions');
    const module = key => dialog().locator(`.template-module[data-module-key="${key}"]`);
    const field = (mk, fk) => module(mk).locator(`[data-field-id="${fk}"]`);
    const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    async function openNav() { if (!await nav().isVisible()) await dialog().getByRole('button', { name: '展开模板目录', exact: true }).click(); }
    async function choose(text) { await openNav(); await nav().getByText(text, { exact: true }).click(); await settle(); }
    async function confirmDelete(kind, cancel = false) {
      const box = page.getByRole('dialog', { name: `删除${kind}`, exact: true });
      await box.waitFor();
      await box.getByRole('button', { name: cancel ? '取消' : '确认删除', exact: true }).click();
      await box.waitFor({ state: 'hidden' });
      await settle();
    }
    async function screenshot(name) {
      await page.locator('.el-message').last().waitFor({ state: 'hidden' });
      await page.locator('.dialog-fade-enter-active').waitFor({ state: 'hidden' });
      await page.locator('.el-fade-in-linear-enter-active').last().waitFor({ state: 'hidden' });
      await page.screenshot({ path: `${artifacts}/${name}.png`, fullPage: true });
    }
    async function checkLayout() {
      for (const selector of ['.template-settings-dialog', '.template-nav-actions', '.scope-note', '.field-main', '.module-head']) {
        const values = await page.locator(selector).evaluateAll(items => items.map(el => el.scrollWidth - el.clientWidth));
        assert.ok(values.every(value => value <= 1), `${selector} 不应横向溢出：${values}`);
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
    }
    async function fallbackExists() {
      const selectedKey = await nav().locator('.el-tree-node.is-current > .el-tree-node__content .template-nav-label').getAttribute('data-nav-key');
      const [moduleKey, fieldId] = JSON.parse(selectedKey);
      assert.equal(await (fieldId ? field(moduleKey, fieldId) : module(moduleKey)).count(), 1, '删除选中项后应回退到有效的模块/字段');
    }
    async function restore(text, kind) {
      await dialog().locator('.template-deleted-trigger').click();
      const item = page.locator('.deleted-template-item').filter({ hasText: text });
      await item.getByRole('button', { name: `恢复${kind}`, exact: true }).click();
      await settle();
      // 点击当前已恢复正文，收起弹出的已删除列表。
      await dialog().locator(':scope > .el-dialog__header').click();
    }
    await page.goto(`${baseUrl}/systems`);
    if (!process.env.SEED_ADMIN_PASSWORD) throw new Error('请通过 node --env-file=.env 提供本地登录环境变量。');
    await page.getByLabel('账号', { exact: true }).fill(process.env.SEED_ADMIN_USERNAME || 'admin');
    await page.getByLabel('密码', { exact: true }).fill(process.env.SEED_ADMIN_PASSWORD);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.locator('.system-card').first().waitFor();
    const counts = await page.locator('.system-card-stats > span:first-child').allTextContents();
    const index = counts.findIndex(text => parseInt(text, 10) > 0);
    assert.ok(index >= 0, '需要一个已有指标的本地体系');
    await page.locator('.system-card-actions').nth(index).getByRole('button', { name: '进入体系', exact: true }).click();

    const removedNewKeys = [];
    for (const width of [1500, 768, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.getByRole('button', { name: '模板设置', exact: true }).click();
      await module('m1').waitFor();
      await choose('1级模块2字段1');
      await field('m2', 'f1').getByRole('button', { name: '删除字段', exact: true }).click();
      await confirmDelete('字段', true);
      assert.equal(await field('m2', 'f1').count(), 1, '取消确认不能删除字段');
      await field('m2', 'f1').getByRole('button', { name: '删除字段', exact: true }).click();
      await confirmDelete('字段');
      assert.equal(await field('m2', 'f1').count(), 0);
      assert.equal(await nav().getByText('1级模块2字段1', { exact: true }).count(), 0);
      await fallbackExists();
      await restore('1级模块2字段1', '字段');
      assert.equal(await field('m2', 'f1').count(), 1, '旧字段可从已删除列表恢复');
      assert.equal((await field('m2', 'f1').getAttribute('class')).includes('inactive'), false, '恢复字段默认启用');
      await choose('1级模块2字段1');
      await openNav();
      await dialog().locator('.template-nav-title').getByRole('button', { name: '删除选中项', exact: true }).click();
      await confirmDelete('字段');
      assert.equal(await field('m2', 'f1').count(), 0, '左目录删除应作用于当前选中字段');

      await choose('1级模块3');
      await module('m3').getByRole('button', { name: '删除模块', exact: true }).click();
      await confirmDelete('模块', true);
      assert.equal(await module('m3').count(), 1);
      await module('m3').getByRole('button', { name: '删除模块', exact: true }).click();
      await confirmDelete('模块');
      assert.equal(await module('m3').count(), 0);
      await fallbackExists();
      await restore('1级模块3', '模块');
      assert.equal(await module('m3').count(), 1, '旧模块可恢复，原字段仍在');
      assert.equal((await module('m3').getAttribute('class')).includes('inactive'), false, '恢复模块默认启用');
      assert.equal(await module('m3').locator('.field-editor').count(), 3);
      await module('m3').getByRole('button', { name: '删除模块', exact: true }).click();
      await confirmDelete('模块');
      await field('m1', 'f3').getByRole('button', { name: '删除字段', exact: true }).click();
      await confirmDelete('字段');
      await restore('1级模块1字段3', '字段');
      await checkLayout();
      await dialog().locator('.template-deleted-trigger').click();
      await page.locator('.deleted-template-item:visible').first().waitFor();
      assert.equal(await page.locator('.deleted-template-item:visible').count(), 2);
      await screenshot(`deleted-list-${width}`);
      await dialog().locator(':scope > .el-dialog__header').click();

      await openNav();
      await actions().getByRole('button', { name: '新增模块', exact: true }).click();
      const freshModule = dialog().locator('.template-module').last();
      const freshKey = await freshModule.getAttribute('data-module-key');
      removedNewKeys.push(freshKey);
      await freshModule.getByRole('textbox', { name: '模块名称', exact: true }).fill('未保存临时模块');
      await freshModule.getByRole('button', { name: '删除模块', exact: true }).click();
      await confirmDelete('模块');
      assert.equal(await module(freshKey).count(), 0);
      await choose('1级模块1');
      await openNav();
      await actions().getByRole('button', { name: '新增字段', exact: true }).click();
      const freshField = module('m1').locator('.field-editor').last();
      const freshFieldId = await freshField.getAttribute('data-field-id');
      removedNewKeys.push(freshFieldId);
      await freshField.getByRole('textbox', { name: '字段名称', exact: true }).fill('未保存临时字段');
      await freshField.getByRole('button', { name: '删除字段', exact: true }).click();
      await confirmDelete('字段');
      assert.equal(await field('m1', freshFieldId).count(), 0);
      assert.match(await dialog().locator('.template-deleted-trigger').innerText(), /2/, '未保存新项直接移除，不进入已删除列表');

      await dialog().locator('.settings-head .el-switch').click();
      assert.equal(await module('m3').count(), 0);
      assert.equal(await field('m2', 'f1').count(), 0);
      assert.equal(await dialog().getByRole('button', { name: '删除字段', exact: true }).count(), 0, '预览隐藏删除操作');
      assert.equal(await dialog().getByRole('button', { name: '删除模块', exact: true }).count(), 0);
      await screenshot(`preview-${width}`);
      await dialog().locator('.settings-head .el-switch').click();
      await dialog().getByRole('tab', { name: '2 级模板', exact: true }).click();
      await module('m1').getByRole('button', { name: '删除模块', exact: true }).click();
      await page.getByText('至少保留一个启用模块，请先新增或启用其他模块。', { exact: true }).waitFor();
      assert.equal(await page.getByRole('dialog', { name: '删除模块', exact: true }).count(), 0, '最后有效模块不能进入删除确认');
      assert.equal(await module('m1').count(), 1, '至少保留一个有效模块');
      await dialog().getByRole('tab', { name: '1 级模板', exact: true }).click();
      assert.equal(await module('m3').count(), 0, '切级不应丢失删除草稿');
      await checkLayout();
      await screenshot(`editor-${width}`);
      if (width !== 390) {
        await dialog().locator(':scope > .el-dialog__footer').getByRole('button', { name: '取消', exact: true }).click();
        await dialog().waitFor({ state: 'hidden' });
      }
    }

    await page.setViewportSize({ width: 1500, height: 1000 });
    await openNav();
    await nav().getByText('1级模块2', { exact: true }).dragTo(nav().getByText('1级模块1', { exact: true }), { targetPosition: { x: 12, y: 2 } });
    await settle();
    assert.deepEqual(await dialog().locator('.template-module').evaluateAll(items => items.map(item => item.dataset.moduleKey)), ['m2', 'm1'], '隐藏已删除模块后有效模块仍可同级排序');
    await nav().getByText('1级模块1字段2', { exact: true }).dragTo(nav().getByText('1级模块1字段1', { exact: true }), { targetPosition: { x: 12, y: 2 } });
    await settle();
    assert.deepEqual((await module('m1').locator('.field-editor').evaluateAll(items => items.map(item => item.dataset.fieldId))).slice(0, 2), ['f2', 'f1']);
    assert.equal(saves.length, 0, '删除/恢复/排序不能自动保存');
    await dialog().getByRole('button', { name: '保存模板', exact: true }).click();
    await page.getByRole('button', { name: '保存并应用', exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('.template-settings-dialog button[aria-label^="删除"]')].every(button => button.disabled));
    releaseSave();
    await dialog().waitFor({ state: 'hidden' });
    assert.equal(saves.length, 1);
    const input = saves[0];
    assert.equal(input.expectedRevisionNo, 9);
    const level1 = input.levels.find(item => item.level === 1);
    const deletedModule = level1.modules.find(item => item.moduleKey === 'm3');
    assert.equal(deletedModule.deleted, true); assert.equal(deletedModule.active, false);
    assert.deepEqual(deletedModule.fields, fixtures('unused').levels[0].modules[2].fields, '删除模块必须保留原字段设置');
    const deletedField = level1.modules.find(item => item.moduleKey === 'm2').fields.find(item => item.fieldId === 'f1');
    assert.equal(deletedField.deleted, true); assert.equal(deletedField.active, false);
    assert.equal(deletedField.description, '字段原说明不应因删除丢失');
    const restoredField = level1.modules.find(item => item.moduleKey === 'm1').fields.find(item => item.fieldId === 'f3');
    assert.equal(restoredField.deleted, false); assert.equal(restoredField.active, true);
    assert.equal(restoredField.description, '字段原说明不应因删除丢失');
    assert.deepEqual(level1.modules.filter(item => !item.deleted).map(item => item.moduleKey), ['m2', 'm1']);
    assert.deepEqual(level1.modules.find(item => item.moduleKey === 'm1').fields.slice(0, 2).map(item => item.fieldId), ['f2', 'f1']);
    for (const id of removedNewKeys) assert.equal(JSON.stringify(input).includes(id), false, '未保存新项删除后不能作为 tombstone 留在提交中');
    assert.deepEqual(errors, []); assert.deepEqual(deniedWrites, []);
    console.log('模板删除/取消/恢复、当前选中项回退、新旧项提交规则、最后有效模块保护、删除后排序、预览与busy限制及1500/768/390布局验证通过；所有模板GET/PUT均浏览器模拟，未修改业务数据库。');
  } catch (error) {
    await page?.screenshot({ path: `${artifacts}/failure.png`, fullPage: true });
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
