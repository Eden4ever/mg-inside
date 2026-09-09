// 字段独立编辑浏览器回归：仅登录真实本地服务；体系、内容、修订和 PATCH 均为浏览器模拟，禁止其他业务写入。
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { mkdirSync } = require('node:fs');
const assert = require('node:assert/strict');
const baseUrl = process.env.PRIMARY_UI_BASE_URL || 'http://localhost:5173';
const artifacts = 'artifacts/field-edit-ui';
const versionId = '11111111-1111-4111-8111-111111111111';
const nodeIds = ['22222222-2222-4222-8222-222222222221', '22222222-2222-4222-8222-222222222222'];
const clone = value => JSON.parse(JSON.stringify(value));
const definitions = [
  { moduleKey: 'portrait', name: '指标内容', displayOrder: 1, researchQuestion: '维护指标定义、考核范围及相关说明', active: true, fields: [
    { fieldId: 'definition', label: '指标定义', fieldType: 'short_text', requirement: 'optional' },
    { fieldId: 'scope', label: '考核范围', fieldType: 'long_text', requirement: 'optional' },
    { fieldId: 'exception', label: '例外说明', fieldType: 'long_text', requirement: 'optional', allowNotApplicable: true },
    { fieldId: 'structure', label: '结构化记录', fieldType: 'object_list', requirement: 'optional' },
    { fieldId: 'legacy_enum', label: '历史选项', fieldType: 'enum', requirement: 'optional', enumValues: ['当前选项'], inactiveEnumValues: ['旧选项'] },
  ] },
  { moduleKey: 'policy', name: '政策依据', displayOrder: 2, researchQuestion: '记录适用政策', active: true, fields: [{ fieldId: 'policy_text', label: '政策说明', fieldType: 'long_text', requirement: 'optional' }] },
];
const evidence = { id: 'evidence-browser-only', moduleKey: 'portrait', title: '考核范围依据材料', sourceType: '政策文件', sourceUrl: '', excerpt: '经营主体服务范围与部门职责说明。', status: 'verified', fieldIds: ['scope'] };
const tree = nodeIds.map((id, index) => ({ id, name: index ? '第二个测试指标' : '第一个测试指标', code: `UI-${index + 1}`, level: 1, parentId: null, sortOrder: index + 1, progress: 80, issues: 0, children: [] }));

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  let page;
  let releasePending;
  let notifyPending;
  try {
    mkdirSync(artifacts, { recursive: true });
    page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    page.setDefaultTimeout(15000);
    const errors = [], deniedWrites = [], patches = [], revisions = [];
    let readonly = false;
    let nextMode = 'ok';
    const records = new Map(nodeIds.map((id, index) => [id, definitions.map(module => ({
      id: `record-${index}-${module.moduleKey}`, moduleKey: module.moduleKey, status: 'in_progress', revisionNo: 4, completedFields: module.fields.length, totalFields: module.fields.length, updatedAt: '2026-09-07T08:00:00Z',
      values: module.fields.map(field => ({ fieldKey: field.fieldId, value: ({ definition: `${index ? '第二指标' : '第一指标'}原始定义`, scope: '涵盖经营主体设立、运行及退出的相关服务。', exception: null, structure: { departments: ['主管部门', '协同部门'], online: true }, legacy_enum: '旧选项', policy_text: '保留既有政策说明。' })[field.fieldId], evidence: field.fieldId === 'scope' ? [clone(evidence)] : [], ...(field.fieldId === 'exception' ? { notApplicableReason: '本指标不涉及此项职责' } : {}) })),
    }))]));
    const system = () => ({ id: '33333333-3333-4333-8333-333333333333', versionId, name: '字段编辑视觉验证体系', code: 'BROWSER-ONLY', year: 2026, version: 'V1', region: '浏览器测试', maxLevel: 3, indicatorCount: 2, progress: 80, status: 'researching', updatedAt: '2026-09-07', access: { canView: true, canResearch: !readonly, canManageCatalog: !readonly, canReview: false, canPublish: false, canManageAccess: !readonly } });
    const workspace = id => ({ templateRevision: 7, system: system(), indicator: { ...tree.find(item => item.id === id), level1Name: '指标内容', level2Name: '' }, summary: '本指标已有知识内容，各字段可以分别维护。', summaryRevisionNo: 1, summarySourceRevisionIds: [], moduleDefinitions: clone(definitions), modules: clone(records.get(id)), recentRevisions: clone(revisions) });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const method = request.method();
      if (method === 'GET' && path === '/api/systems') return route.fulfill({ json: [system()] });
      if (method === 'GET' && path === `/api/indicator-versions/${versionId}`) return route.fulfill({ json: { ...system(), tree: clone(tree) } });
      if (method === 'GET' && path === `/api/indicator-versions/${versionId}/tree`) return route.fulfill({ json: clone(tree) });
      const match = path.match(/^\/api\/indicator-versions\/[^/]+\/indicators\/([^/]+)\/(workspace|revisions|evidence|ai-suggestions|modules\/[^/]+)$/);
      if (match && records.has(match[1])) {
        const [, nodeId, action] = match;
        if (method === 'GET' && action === 'workspace') return route.fulfill({ json: workspace(nodeId) });
        if (method === 'GET' && action === 'revisions') return route.fulfill({ json: clone(revisions) });
        if (method === 'GET' && action === 'evidence') return route.fulfill({ json: [{ id: evidence.id, moduleKey: evidence.moduleKey, type: evidence.sourceType, title: evidence.title, sourceUrl: evidence.sourceUrl, excerpt: evidence.excerpt, verificationStatus: evidence.status, fieldKeys: evidence.fieldIds }] });
        if (method === 'GET' && action === 'ai-suggestions') return route.fulfill({ json: [] });
        if (method === 'PATCH' && action.startsWith('modules/')) {
          const moduleKey = action.slice(8), input = request.postDataJSON(), mode = nextMode;
          nextMode = 'ok';
          patches.push({ nodeId, moduleKey, input: clone(input), mode });
          if (mode === 'hold') await new Promise(resolve => { releasePending = resolve; notifyPending?.(); });
          if (mode === 'conflict') return route.fulfill({ status: 409, json: { code: 'TEMPLATE_REVISION_CONFLICT', message: '模板已变更，请刷新后核对当前输入' } });
          if (mode === 'network') return route.abort('failed');
          const record = records.get(nodeId).find(item => item.moduleKey === moduleKey);
          assert.ok(record, '模拟 PATCH 必须指向已有模块');
          assert.equal(input.expectedRevisionNo, record.revisionNo, '应使用进入编辑时的内容修订号');
          assert.equal(input.expectedTemplateRevision, 7, '应携带进入编辑时的模板修订号');
          // 模拟服务端局部合并；断言客户端只发送目标字段，而非借此脚本证明实际数据库行为。
          for (const changed of input.values) {
            const value = record.values.find(item => item.fieldKey === changed.fieldKey);
            assert.ok(value, '不得写入模板不存在的字段');
            value.value = clone(changed.value);
            if (input.notApplicableReasons?.[changed.fieldKey]) value.notApplicableReason = input.notApplicableReasons[changed.fieldKey];
            else delete value.notApplicableReason;
          }
          record.revisionNo += 1;
          revisions.unshift({ id: `revision-${patches.length}`, moduleKey, revision: record.revisionNo, action: 'saved', actorName: '浏览器测试', createdAt: '2026-09-07T08:30:00Z' });
          return route.fulfill({ json: clone(record) });
        }
      }
      if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && path !== '/api/auth/login') {
        deniedWrites.push(`${method} ${path}`);
        return route.abort('blockedbyclient');
      }
      return route.continue();
    });
    const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const module = (key = 'portrait') => page.locator(`#module-${key}`);
    const inline = (key = 'definition') => page.locator(`.field-inline-form[data-field-id="${key}"]`);
    const edit = async (label, key = 'portrait') => { await module(key).getByRole('button', { name: `编辑${label}`, exact: true }).click(); await settle(); };
    const cancel = label => page.getByRole('button', { name: `取消编辑${label}`, exact: true }).click();
    const save = async (label, key) => { await page.getByRole('button', { name: `保存${label}`, exact: true }).click(); await inline(key).waitFor({ state: 'hidden' }); };
    const values = (nodeId = nodeIds[0]) => records.get(nodeId).find(item => item.moduleKey === 'portrait').values;
    const fieldValue = key => values().find(item => item.fieldKey === key);
    async function assertSinglePatch(key, previous) {
      const latest = patches.at(-1);
      assert.deepEqual(latest.input.values.map(item => item.fieldKey), [key], '字段保存必须只提交当前 fieldKey');
      assert.ok(Object.keys(latest.input.notApplicableReasons || {}).every(item => item === key), '不得提交其他字段的不适用理由');
      assert.deepEqual(values().filter(item => item.fieldKey !== key), previous.filter(item => item.fieldKey !== key), '其他字段值、不适用理由与依据不能变化');
    }
    async function noOverflow() {
      for (const selector of ['.detail-page', '.module-scroll', '.field-inline-form']) {
        const sizes = await page.locator(selector).evaluateAll(items => items.map(item => item.scrollWidth - item.clientWidth));
        assert.ok(sizes.every(size => size <= 1), `${selector} 横向溢出：${sizes.join(',')}`);
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
    }
    async function screenshot(name) { await settle(); await page.locator('.el-message').last().waitFor({ state: 'hidden' }); await page.screenshot({ path: `${artifacts}/${name}.png`, fullPage: true, animations: 'disabled' }); }
    await page.goto(`${baseUrl}/systems`);
    if (!process.env.SEED_ADMIN_PASSWORD) throw new Error('请通过 node --env-file=.env 提供本地登录环境变量。');
    await page.getByLabel('账号', { exact: true }).fill(process.env.SEED_ADMIN_USERNAME || 'admin');
    await page.getByLabel('密码', { exact: true }).fill(process.env.SEED_ADMIN_PASSWORD);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.getByRole('button', { name: '进入体系', exact: true }).click();
    await module().waitFor();
    await page.locator('.workspace-loading').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.field-edit-button').count(), 6);
    await screenshot('desktop-read');

    await edit('指标定义');
    assert.equal(await page.locator('.field-inline-form').count(), 1);
    assert.equal(await page.locator('.module-form').count(), 0);
    await inline().getByRole('textbox', { name: '指标定义', exact: true }).fill('尚未保存的定义');
    await cancel('指标定义');
    assert.equal(patches.length, 0, '取消编辑不得发送 PATCH');
    assert.ok((await module().innerText()).includes('第一指标原始定义'));
    let before = clone(values());
    await edit('指标定义');
    await inline().getByRole('textbox', { name: '指标定义', exact: true }).fill('独立保存后的指标定义');
    await save('指标定义', 'definition');
    await assertSinglePatch('definition', before);
    assert.equal(fieldValue('definition').value, '独立保存后的指标定义');
    assert.ok((await module().innerText()).includes(evidence.title), '保存其他字段后依据摘要仍可见');

    before = clone(values());
    await edit('例外说明');
    await inline('exception').getByPlaceholder('填写不适用理由').fill('仅当前例外说明的不适用理由更新');
    await save('例外说明', 'exception');
    await assertSinglePatch('exception', before);
    assert.equal(fieldValue('exception').notApplicableReason, '仅当前例外说明的不适用理由更新');

    await module().getByRole('button', { name: '编辑模块', exact: true }).click();
    await module().locator('.module-form').waitFor();
    await module().locator('.module-form').getByRole('textbox', { name: '指标定义', exact: true }).fill('模块整体保存后的定义');
    await module().locator('.module-actions').getByRole('button', { name: '保存', exact: true }).click();
    await module().locator('.module-form').waitFor({ state: 'hidden' });
    assert.equal(patches.at(-1).input.values.length, 5, '保留整模块编辑兼容入口');
    assert.deepEqual(patches.at(-1).input.values.find(item => item.fieldKey === 'structure').value, { departments: ['主管部门', '协同部门'], online: true }, '未改变的结构化字段不能转为字符串');
    assert.equal(fieldValue('legacy_enum').value, '旧选项', '保留已停用枚举原值');
    assert.deepEqual(fieldValue('scope').evidence, [evidence], '模块保存不改变依据');

    await edit('指标定义');
    await inline().getByRole('textbox', { name: '指标定义', exact: true }).fill('切换时待放弃内容');
    await edit('考核范围');
    await page.locator('.el-message-box').waitFor();
    await page.locator('.el-message-box__headerbtn').click();
    await page.locator('.el-message-box').waitFor({ state: 'hidden' });
    assert.equal(await inline().getByRole('textbox', { name: '指标定义', exact: true }).inputValue(), '切换时待放弃内容');
    await edit('考核范围');
    await page.getByRole('button', { name: '放弃修改', exact: true }).click();
    await inline('scope').waitFor();
    assert.equal(fieldValue('definition').value, '模块整体保存后的定义');
    before = clone(values());
    await inline('scope').getByRole('textbox', { name: '考核范围', exact: true }).fill('先保存当前字段再切换编辑');
    await edit('指标定义');
    await page.getByRole('button', { name: '保存后切换', exact: true }).click();
    await inline().waitFor();
    await assertSinglePatch('scope', before);
    await cancel('指标定义');

    nextMode = 'conflict';
    await edit('指标定义');
    await inline().getByRole('textbox', { name: '指标定义', exact: true }).fill('409 冲突仍保留的输入');
    await page.getByRole('button', { name: '保存指标定义', exact: true }).click();
    await page.locator('.workspace-detail .el-alert').getByText('模板已变更，请刷新后核对当前输入', { exact: true }).waitFor();
    assert.equal(await inline().getByRole('textbox', { name: '指标定义', exact: true }).inputValue(), '409 冲突仍保留的输入');
    assert.ok(await page.getByRole('button', { name: '保存指标定义', exact: true }).isEnabled(), '冲突后应解锁保存');
    await screenshot('conflict-preserved');
    await page.getByRole('button', { name: '核对完成', exact: true }).click();
    await cancel('指标定义');

    nextMode = 'network';
    await edit('指标定义');
    await inline().getByRole('textbox', { name: '指标定义', exact: true }).fill('网络失败后重试的输入');
    await page.getByRole('button', { name: '保存指标定义', exact: true }).click();
    await page.getByText('无法连接知识库服务，请确认前后端服务均已启动。', { exact: true }).waitFor();
    assert.equal(await inline().getByRole('textbox', { name: '指标定义', exact: true }).inputValue(), '网络失败后重试的输入');
    assert.ok(await page.getByRole('button', { name: '保存指标定义', exact: true }).isEnabled());
    await save('指标定义', 'definition');
    assert.equal(fieldValue('definition').value, '网络失败后重试的输入');

    nextMode = 'hold';
    const pendingStarted = new Promise(resolve => { notifyPending = resolve; });
    await edit('指标定义');
    await inline().getByRole('textbox', { name: '指标定义', exact: true }).fill('保存中阻止重复提交和跨指标污染');
    await page.getByRole('button', { name: '保存指标定义', exact: true }).click();
    await pendingStarted;
    await page.waitForFunction(() => document.querySelector('.field-inline-actions .is-loading'));
    const patchCount = patches.length;
    await page.getByRole('button', { name: '保存指标定义', exact: true }).evaluate(button => button.click());
    await page.locator('.tree-label .node-text').filter({ hasText: '第二个测试指标' }).click();
    await settle();
    assert.equal(patches.length, patchCount, '保存中不得重复提交');
    assert.ok(page.url().endsWith(nodeIds[0]), '保存中不得切到其他指标');
    assert.ok(await inline().isVisible(), '保存中不能丢弃当前编辑区');
    releasePending(); releasePending = undefined;
    await inline().waitFor({ state: 'hidden' });
    await page.locator('.tree-label .node-text').filter({ hasText: '第二个测试指标' }).click();
    await page.waitForURL(`**/${nodeIds[1]}`);
    await module().getByText('第二指标原始定义', { exact: true }).waitFor();
    assert.equal(values(nodeIds[1]).find(item => item.fieldKey === 'definition').value, '第二指标原始定义');
    await page.locator('.tree-label .node-text').filter({ hasText: '第一个测试指标' }).click();
    await page.waitForURL(`**/${nodeIds[0]}`);
    await module().waitFor();

    for (const width of [1500, 768, 390]) {
      await page.setViewportSize({ width, height: width === 1500 ? 1000 : 950 });
      await edit('考核范围');
      await inline('scope').scrollIntoViewIfNeeded();
      await noOverflow();
      await screenshot(`field-edit-${width}`);
      await cancel('考核范围');
    }
    readonly = true;
    await page.goto(`${baseUrl}/systems/${versionId}/indicators/${nodeIds[0]}`);
    await module().waitFor();
    assert.equal(await page.locator('.field-edit-button').count(), 0, '只读权限不提供字段编辑入口');
    assert.equal(await page.getByRole('button', { name: '编辑模块', exact: true }).count(), 0, '只读权限不提供模块编辑入口');
    await screenshot('readonly');
    assert.deepEqual(deniedWrites, [], '除已模拟 PATCH 外，不应有业务写入');
    assert.deepEqual(errors, [], '页面不应有运行异常');
    console.log('独立字段保存/取消、局部 PATCH、未保存切换、409 保留输入、网络重试、防重及保存中切指标、只读权限与 1500/768/390 布局全部通过。数据和 PATCH 均为浏览器模拟，未修改数据库。');
  } catch (error) {
    await page?.screenshot({ path: `${artifacts}/failure.png`, fullPage: true, animations: 'disabled' });
    throw error;
  } finally {
    releasePending?.();
    await browser.close();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
