// 模板目录视觉回归：模板接口仅返回浏览器测试数据，所有业务写入均被阻止，不修改数据库。
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { mkdirSync } = require('node:fs');
const assert = require('node:assert/strict');
const baseUrl = process.env.PRIMARY_UI_BASE_URL || 'http://localhost:5173';
const artifacts = 'artifacts/template-navigation-ui';

function templateSettings(systemId) {
  return {
    systemId, maxLevel: 3, revisionNo: 7,
    levels: [1, 2, 3].map(level => ({
      level, revisionNo: 1, affectedCount: level * 3,
      modules: Array.from({ length: 6 }, (_, mi) => ({
        moduleKey: `m${mi + 1}`, name: `${level}级模块${mi + 1}`, researchQuestion: '模块与字段的目录导航测试说明', displayOrder: mi + 1, active: mi !== 5,
        // 不同模块有意使用相同字段 ID，检查导航是否使用模块+字段复合标识。
        fields: Array.from({ length: 4 }, (_, fi) => ({ fieldId: `f${fi + 1}`, label: `${level}级模块${mi + 1}字段${fi + 1}`, fieldType: 'long_text', description: '输入当前指标的知识内容', requirement: 'optional', active: fi !== 3, allowNotApplicable: false })),
      })),
    })),
  };
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  let page;
  try {
    mkdirSync(artifacts, { recursive: true });
    page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    page.setDefaultTimeout(15000);
    const errors = [];
    const deniedWrites = [];
    const savedInputs = [];
    let releaseSave;
    const saveResponseGate = new Promise(resolve => { releaseSave = resolve; });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const templates = path.match(/^\/api\/systems\/([^/]+)\/templates$/);
      if (request.method() === 'GET' && templates) return route.fulfill({ json: templateSettings(decodeURIComponent(templates[1])) });
      if (request.method() === 'PUT' && templates) {
        const input = request.postDataJSON();
        savedInputs.push(input);
        await saveResponseGate;
        return route.fulfill({ json: { systemId: decodeURIComponent(templates[1]), revisionNo: input.expectedRevisionNo + 1, maxLevel: input.maxLevel, levels: input.levels.map(item => ({ ...item, revisionNo: 2, affectedCount: item.level * 3 })) } });
      }
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && !path.endsWith('/auth/login')) {
        deniedWrites.push(`${request.method()} ${path}`);
        return route.abort('blockedbyclient');
      }
      return route.continue();
    });
    const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const dialog = () => page.locator('.template-settings-dialog');
    const editor = () => dialog().locator('.template-editor-scroll > .el-scrollbar__wrap');
    const navigation = () => dialog().locator('.template-nav-tree');
    const navActions = () => dialog().locator('.template-nav-actions');
    const navScroll = () => dialog().locator('.template-nav-scroll > .el-scrollbar__wrap');
    const module = key => dialog().locator(`.template-module[data-module-key="${key}"]`);
    const field = (moduleKey, fieldKey) => module(moduleKey).locator(`[data-field-id="${fieldKey}"]`);
    async function screenshot(name) {
      await page.locator('.dialog-fade-enter-active').waitFor({ state: 'hidden' });
      await page.screenshot({ path: `${artifacts}/${name}.png`, fullPage: true });
    }
    async function fixedPositions() {
      return Promise.all([dialog().locator(':scope > .el-dialog__header').boundingBox(), dialog().locator(':scope > .el-dialog__footer').boundingBox()]);
    }
    async function assertFixed(before) {
      const after = await fixedPositions();
      after.forEach((box, index) => {
        assert.ok(box && before[index]);
        assert.ok(Math.abs(box.y - before[index].y) < 1 && Math.abs(box.height - before[index].height) < 1, '模板标题与底部操作栏应固定');
      });
    }
    async function noOverflow() {
      for (const selector of ['.template-settings-dialog', '.template-nav', '.template-editor-scroll']) {
        const overflows = await page.locator(selector).evaluate(el => el.scrollWidth - el.clientWidth);
        assert.ok(overflows <= 1, `${selector} 不应横向溢出：${overflows}`);
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), '页面不应横向溢出');
    }
    async function openNavigation() {
      if (!await navigation().isVisible()) await dialog().getByRole('button', { name: '展开模板目录', exact: true }).click();
      await navigation().waitFor();
    }
    async function assertFocused(input) {
      assert.ok(await input.evaluate(el => document.activeElement === el), '新增后应聚焦名称输入，不需手动寻找目标');
      if (page.viewportSize().width === 390) assert.equal(await navigation().isVisible(), false, '窄屏新增后应收起目录回到编辑区');
    }
    async function targetReached(target) {
      await settle();
      const box = await target.boundingBox();
      const pane = await editor().boundingBox();
      assert.ok(box && pane && box.y >= pane.y - 2 && box.y < pane.y + pane.height - 20, '目录目标应位于右侧可视编辑区');
      assert.ok(await editor().evaluate(el => el.scrollTop) > 0, '远处目标应由右侧独立滚动区定位');
    }
    async function choose(label) {
      await navigation().getByText(label, { exact: true }).click();
      await settle();
    }
    await page.goto(`${baseUrl}/systems`);
    if (!process.env.SEED_ADMIN_PASSWORD) throw new Error('请通过 node --env-file=.env 提供本地登录环境变量。');
    await page.getByLabel('账号', { exact: true }).fill(process.env.SEED_ADMIN_USERNAME || 'admin');
    await page.getByLabel('密码', { exact: true }).fill(process.env.SEED_ADMIN_PASSWORD);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.locator('.system-card').first().waitFor();
    const counts = await page.locator('.system-card-stats > span:first-child').allTextContents();
    const index = counts.findIndex(text => parseInt(text, 10) > 0);
    assert.ok(index >= 0, '需要一个已包含指标的本地体系');
    await page.locator('.system-card-actions').nth(index).getByRole('button', { name: '进入体系', exact: true }).click();
    await page.getByRole('button', { name: '模板设置', exact: true }).click();
    await navigation().waitFor();
    const desktopFixed = await fixedPositions();
    await noOverflow();
    await screenshot('desktop-initial');

    await choose('1级模块5');
    await targetReached(module('m5'));
    await assertFixed(desktopFixed);
    await choose('1级模块2字段2');
    await targetReached(field('m2', 'f2'));
    assert.ok(await navigation().getByText('1级模块2字段2', { exact: true }).locator('xpath=ancestor::*[@role="treeitem"][1]').evaluate(el => el.classList.contains('is-current')), '同名字段 ID 应选中对应模块内的字段');
    await assertFixed(desktopFixed);
    await screenshot('desktop-field-navigation');

    await module('m2').getByRole('textbox', { name: '模块名称', exact: true }).fill('一级修改后模块');
    await field('m2', 'f2').getByRole('textbox', { name: '字段名称', exact: true }).fill('一级修改后字段');
    await navigation().getByText('一级修改后模块', { exact: true }).waitFor();
    await navigation().getByText('一级修改后字段', { exact: true }).waitFor();
    await module('m2').getByRole('button', { name: '模块上移', exact: true }).click();
    await field('m2', 'f2').getByRole('button', { name: '字段上移', exact: true }).click();
    const navOrder = await navigation().innerText();
    assert.ok(navOrder.indexOf('一级修改后模块') < navOrder.indexOf('1级模块1'));
    assert.ok(navOrder.indexOf('一级修改后字段') < navOrder.indexOf('1级模块2字段1'));

    await dialog().getByRole('tab', { name: '2 级模板', exact: true }).click();
    assert.equal(await module('m2').getByRole('textbox', { name: '模块名称', exact: true }).inputValue(), '2级模块2');
    await dialog().getByRole('tab', { name: '1 级模板', exact: true }).click();
    assert.equal(await module('m2').getByRole('textbox', { name: '模块名称', exact: true }).inputValue(), '一级修改后模块');
    assert.equal(await field('m2', 'f2').getByRole('textbox', { name: '字段名称', exact: true }).inputValue(), '一级修改后字段');

    await dialog().locator('.settings-head .el-switch').click();
    assert.equal(await navActions().isVisible(), false, '预览不显示新增模块/字段操作');
    assert.equal(await navigation().getByText('1级模块6', { exact: true }).count(), 0, '预览目录隐藏停用模块');
    assert.equal(await navigation().getByText('1级模块2字段4', { exact: true }).count(), 0, '预览目录隐藏停用字段');
    assert.equal(await module('m6').count(), 0, '预览正文隐藏停用模块');
    assert.equal(await field('m2', 'f4').count(), 0, '预览正文隐藏停用字段');
    await choose('1级模块4字段2');
    await targetReached(field('m4', 'f2'));
    await screenshot('desktop-preview');
    await dialog().locator('.settings-head .el-switch').click();

    await module('m2').getByRole('button', { name: '新增字段', exact: true }).click();
    await navigation().getByText('新字段', { exact: true }).waitFor();
    const addedField = module('m2').locator('.field-editor').last();
    await targetReached(addedField);
    await dialog().locator('.template-editor-scroll').getByRole('button', { name: '新增模块', exact: true }).click();
    await navigation().getByText('新模块', { exact: true }).waitFor();
    await targetReached(dialog().locator('.template-module').last());
    await screenshot('desktop-added-module');
    await assertFixed(desktopFixed);

    for (const width of [900, 768]) {
      await page.setViewportSize({ width, height: 950 });
      await settle();
      await choose('1级模块3字段2');
      await targetReached(field('m3', 'f2'));
      await noOverflow();
      const overflows = await dialog().locator('.field-main, .module-head').evaluateAll(items => items.map(el => el.scrollWidth - el.clientWidth));
      assert.ok(overflows.every(value => value <= 1), `${width} 中间宽度的模块/字段表单行不能被左树挤出：${overflows.filter(value => value > 1).join(',')}`);
      await screenshot(`midwidth-${width}`);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await settle();
    await noOverflow();
    const mobileFixed = await fixedPositions();
    const toggle = dialog().getByRole('button', { name: /展开.*目录|收起.*目录/ });
    if (!await navigation().isVisible()) await toggle.click();
    await navigation().waitFor();
    await screenshot('mobile-directory');
    await choose('1级模块3字段2');
    await targetReached(field('m3', 'f2'));
    await noOverflow();
    await assertFixed(mobileFixed);
    await screenshot('mobile-field-navigation');
    await field('m3', 'f2').getByRole('textbox', { name: '字段名称', exact: true }).fill('窄屏修改字段');
    if (!await navigation().isVisible()) await toggle.click();
    await navigation().getByText('窄屏修改字段', { exact: true }).waitFor();
    await choose('窄屏修改字段');
    assert.equal(await field('m3', 'f2').getByRole('textbox', { name: '字段名称', exact: true }).inputValue(), '窄屏修改字段');
    await screenshot('mobile-edited-field');
    await assertFixed(mobileFixed);

    // 固定目录工具栏：不依赖正文/目录已滚至何处，按当前模块或正文焦点新增。
    await dialog().getByRole('tab', { name: '2 级模板', exact: true }).click();
    for (const width of [1500, 900, 768, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await openNavigation();
      await choose('2级模块2字段1');
      await openNavigation();
      const fixed = await fixedPositions();
      const buttonBoxes = await Promise.all(['新增模块', '新增字段'].map(name => navActions().getByRole('button', { name, exact: true }).boundingBox()));
      const editorMoved = await editor().evaluate(el => { el.scrollTop = el.scrollHeight; return el.scrollTop; });
      const navMoved = await navScroll().evaluate(el => { el.scrollTop = el.scrollHeight; return el.scrollTop; });
      assert.ok(editorMoved > 0 && navMoved > 0, '快捷新增测试需要两侧各自的长滚动');
      await settle();
      const afterBoxes = await Promise.all(['新增模块', '新增字段'].map(name => navActions().getByRole('button', { name, exact: true }).boundingBox()));
      afterBoxes.forEach((box, index) => {
        assert.ok(box && buttonBoxes[index] && Math.abs(box.y - buttonBoxes[index].y) <= 1 && Math.abs(box.x - buttonBoxes[index].x) <= 1, '新增按钮不应随目录/正文长滚动移动');
      });
      await assertFixed(fixed);
      await noOverflow();
      await screenshot(`quick-actions-scrolled-${width}`);
      // 从正文中段发起新增字段，当前选中的是模块2的字段1，新增应留在模块2。
      await editor().evaluate(el => { el.scrollTop = Math.floor(el.scrollHeight / 2); });
      await navScroll().evaluate(el => { el.scrollTop = Math.floor(el.scrollHeight / 2); });
      const module2Fields = await module('m2').locator('.field-editor').count();
      await navActions().getByRole('button', { name: '新增字段', exact: true }).click();
      const quickField = module('m2').locator('.field-editor').last();
      await targetReached(quickField);
      await assertFocused(quickField.getByRole('textbox', { name: '字段名称', exact: true }));
      assert.equal(await module('m2').locator('.field-editor').count(), module2Fields + 1, '选中字段时新增字段应添加到所属模块');
      await quickField.getByRole('textbox', { name: '字段名称', exact: true }).fill(`快捷字段 ${width}`);

      // 用户直接编辑正文中的另一个模块，快捷新增应跟随正文焦点，而非停留在旧树选项。
      const description = field('m3', 'f1').getByRole('textbox', { name: '填写说明', exact: true });
      await description.fill(`保留正文输入 ${width}`);
      const module3Fields = await module('m3').locator('.field-editor').count();
      await openNavigation();
      await navActions().getByRole('button', { name: '新增字段', exact: true }).click();
      const focusedModuleField = module('m3').locator('.field-editor').last();
      await targetReached(focusedModuleField);
      await assertFocused(focusedModuleField.getByRole('textbox', { name: '字段名称', exact: true }));
      assert.equal(await module('m3').locator('.field-editor').count(), module3Fields + 1, '正文焦点改变后新增字段应进入当前正文所属模块');
      assert.equal(await description.inputValue(), `保留正文输入 ${width}`, '快捷新增不应丢失当前正文输入');
      await focusedModuleField.getByRole('textbox', { name: '字段名称', exact: true }).fill(`正文定位新增字段 ${width}`);

      // 常驻新增模块从当前位置直接追加，随后新增字段应指向这个刚创建的模块。
      await openNavigation();
      await editor().evaluate(el => { el.scrollTop = Math.floor(el.scrollHeight / 2); });
      const moduleCount = await dialog().locator('.template-module').count();
      await navActions().getByRole('button', { name: '新增模块', exact: true }).click();
      const newModule = dialog().locator('.template-module').last();
      await targetReached(newModule);
      await assertFocused(newModule.getByRole('textbox', { name: '模块名称', exact: true }));
      assert.equal(await dialog().locator('.template-module').count(), moduleCount + 1);
      await newModule.getByRole('textbox', { name: '模块名称', exact: true }).fill(`快捷新增模块 ${width}`);
      await openNavigation();
      await navActions().getByRole('button', { name: '新增字段', exact: true }).click();
      assert.equal(await newModule.locator('.field-editor').count(), 1, '选中模块时新增字段应进入当前模块');
      await assertFocused(newModule.getByRole('textbox', { name: '字段名称', exact: true }));
      await newModule.getByRole('textbox', { name: '字段名称', exact: true }).fill(`新增模块字段 ${width}`);
      await screenshot(`quick-actions-added-${width}`);
      await noOverflow();
      await assertFixed(fixed);
    }

    await page.setViewportSize({ width: 1500, height: 1000 });
    await dialog().getByRole('tab', { name: '3 级模板', exact: true }).click();
    const label = text => navigation().getByText(text, { exact: true });
    const moduleOrder = () => dialog().locator('.template-module').evaluateAll(items => items.map(item => item.dataset.moduleKey));
    const fieldOrder = key => module(key).locator('.field-editor').evaluateAll(items => items.map(item => item.dataset.fieldId));
    async function dragBefore(sourceLabel, targetLabel) {
      await label(sourceLabel).dragTo(label(targetLabel), { targetPosition: { x: 12, y: 2 } });
      await settle();
    }
    await dragBefore('3级模块2', '3级模块1');
    assert.deepEqual((await moduleOrder()).slice(0, 2), ['m2', 'm1'], '左树模块应可通过真实拖拽排序');
    await dragBefore('3级模块2字段2', '3级模块2字段1');
    assert.deepEqual((await fieldOrder('m2')).slice(0, 2), ['f2', 'f1'], '同模块字段应可通过真实拖拽排序');
    const beforeCrossModule = await fieldOrder('m2');
    await dragBefore('3级模块2字段2', '3级模块1字段1');
    assert.deepEqual(await fieldOrder('m2'), beforeCrossModule, '跨模块字段拖拽应被拒绝');
    assert.deepEqual(await fieldOrder('m1'), ['f1', 'f2', 'f3', 'f4']);
    const beforeMixedLevel = await moduleOrder();
    await dragBefore('3级模块2字段2', '3级模块1');
    assert.deepEqual(await moduleOrder(), beforeMixedLevel, '字段不能拖到模块层级');
    assert.deepEqual(await fieldOrder('m2'), beforeCrossModule);
    const targetBox = await label('3级模块2').boundingBox();
    await label('3级模块4').dragTo(label('3级模块2'), { targetPosition: { x: 12, y: targetBox.height / 2 } });
    await settle();
    assert.deepEqual(await moduleOrder(), beforeMixedLevel, '目录节点不能拖入另一模块内部');
    await choose('3级模块2字段2');
    await targetReached(field('m2', 'f2'));
    await screenshot('desktop-dragged-order');
    await dialog().locator('.settings-head .el-switch').click();
    assert.equal(await navigation().locator('[draggable="true"]').count(), 0, '预览目录不能拖拽');
    await dialog().locator('.settings-head .el-switch').click();
    assert.equal(savedInputs.length, 0, '编辑和拖拽不能自动保存模板');
    await dialog().getByRole('button', { name: '保存模板', exact: true }).click();
    await page.getByRole('button', { name: '保存并应用', exact: true }).click();
    await page.waitForFunction(() => {
      const buttons = document.querySelectorAll('.template-nav-actions button');
      return buttons.length >= 2 && [...buttons].every(button => button.disabled);
    });
    assert.equal(await navigation().locator('[draggable="true"]').count(), 0, '保存忙碌状态不能继续拖拽或快捷新增');
    releaseSave();
    await dialog().waitFor({ state: 'hidden' });
    assert.equal(savedInputs.length, 1, '显式保存仅发出一次模拟 PUT');
    const saved = savedInputs[0];
    assert.equal(saved.expectedRevisionNo, 7);
    assert.equal(saved.maxLevel, 3);
    const savedLevel1 = saved.levels.find(item => item.level === 1);
    const savedLevel2 = saved.levels.find(item => item.level === 2);
    const savedLevel3 = saved.levels.find(item => item.level === 3);
    assert.equal(savedLevel1.modules.find(item => item.moduleKey === 'm2').name, '一级修改后模块');
    assert.equal(savedLevel1.modules.find(item => item.moduleKey === 'm2').fields.find(item => item.fieldId === 'f2').label, '一级修改后字段');
    for (const width of [1500, 900, 768, 390]) {
      assert.ok(savedLevel2.modules.find(item => item.moduleKey === 'm2').fields.some(item => item.label === `快捷字段 ${width}`));
      assert.ok(savedLevel2.modules.find(item => item.moduleKey === 'm3').fields.some(item => item.label === `正文定位新增字段 ${width}`));
      const addedModule = savedLevel2.modules.find(item => item.name === `快捷新增模块 ${width}`);
      assert.equal(addedModule.fields[0].label, `新增模块字段 ${width}`);
    }
    assert.equal(savedLevel2.modules.find(item => item.moduleKey === 'm3').fields.find(item => item.fieldId === 'f1').description, '保留正文输入 390');
    assert.deepEqual(savedLevel3.modules.slice(0, 2).map(item => item.moduleKey), ['m2', 'm1']);
    assert.deepEqual(savedLevel3.modules[0].fields.slice(0, 2).map(item => item.fieldId), ['f2', 'f1']);
    for (const originalModule of templateSettings('unused').levels[2].modules) {
      const savedModule = savedLevel3.modules.find(item => item.moduleKey === originalModule.moduleKey);
      assert.equal(savedModule.name, originalModule.name);
      for (const originalField of originalModule.fields) assert.deepEqual(savedModule.fields.find(item => item.fieldId === originalField.fieldId), originalField, '拖拽不应修改字段 ID、名称、类型与内容设置');
    }
    assert.deepEqual(errors, [], '模板编辑不应产生页面脚本异常');
    assert.deepEqual(deniedWrites, [], '不应发生未模拟的业务写入');
    console.log('模板目录 1500/900/768/390 导航与布局、固定快捷新增、当前模块/正文焦点归属、输入保留与新增聚焦、预览过滤、真实同级拖拽和模拟保存完整性验证通过。模板 GET/PUT 仅浏览器 mock，未修改业务数据库。');
  } catch (error) {
    await page?.screenshot({ path: `${artifacts}/failure.png`, fullPage: true });
    throw error;
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
