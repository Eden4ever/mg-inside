// 只读界面验证：模板/权限/修订使用浏览器测试数据，禁止提交任何业务写接口。
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { mkdirSync } = require('node:fs');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (request.method() !== 'GET' && !path.endsWith('/auth/login')) {
        errors.push('意外业务写请求：' + path);
        return route.abort();
      }
      if (path.endsWith('/templates')) return route.fulfill({ json: {
        revisionNo: 1, maxLevel: 3,
        levels: [1, 2, 3].map(level => ({ level, revisionNo: 1, affectedCount: 24, modules: [1, 2, 3].map(index => ({
          moduleKey: 'visual_' + index, name: level + ' 级指标内容模块 ' + index, displayOrder: index,
          researchQuestion: '填写该级指标对应的政策口径与维护说明。', active: true,
          fields: [1, 2, 3, 4].map(field => ({ fieldId: 'field_' + field, label: '字段 ' + field,
            fieldType: 'long_text', requirement: 'optional', active: true, allowNotApplicable: true })),
        })) })),
      } });
      if (path.endsWith('/access')) return route.fulfill({ json: Array.from({ length: 31 }, (_, index) => ({
        userId: 'visual_' + index, displayName: '演示用户 ' + index, username: 'member_' + index,
        departmentName: '综合管理部', role: 'reader', globalAdmin: false, isCreator: false,
        platformRoleLabel: '普通用户', systemRole: index < 30 ? 'editor' : null,
        permissions: { canView: index < 30, canResearch: index < 30, canManageCatalog: false },
      })) });
      if (path.endsWith('/revisions')) return route.fulfill({ json: Array.from({ length: 30 }, (_, index) => ({
        id: 'revision_' + index, revision: index + 1, action: 'saved', actorName: '演示用户',
        moduleKey: '指标口径', createdAt: '2026-09-07 10:00',
        snapshot: { values: { definition: '测试修订内容' }, evidence: [] },
      })) });
      return route.continue();
    });
    mkdirSync('artifacts/overlays-ui', { recursive: true });

    async function checkOverlay(name, selector = '.el-dialog:visible', scrollSelector = '.el-dialog__body', mustScroll = false) {
      const dialog = page.locator(selector).last();
      await dialog.waitFor();
      await page.waitForTimeout(350);
      const dimensions = await dialog.evaluate(el => {
        const rect = el.getBoundingClientRect();
        const header = el.querySelector('.el-dialog__header, .el-drawer__header, .el-message-box__header');
        const footer = el.querySelector('.el-dialog__footer, .el-drawer__footer, .el-message-box__btns');
        return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right,
          headerTop: header?.getBoundingClientRect().top, footerBottom: footer?.getBoundingClientRect().bottom,
          horizontalOverflow: el.scrollWidth > el.clientWidth + 1,
          radius: getComputedStyle(el).borderTopLeftRadius };
      });
      const viewport = page.viewportSize();
      if (dimensions.top < -1 || dimensions.bottom > viewport.height + 1 || dimensions.left < -1 || dimensions.right > viewport.width + 1 || dimensions.horizontalOverflow) {
        throw new Error(name + ' 弹层超出视口：' + JSON.stringify(dimensions));
      }
      const scroller = dialog.locator(scrollSelector).first();
      const before = await dialog.locator('.el-dialog__header, .el-drawer__header, .el-message-box__header').boundingBox();
      const moved = await scroller.evaluate(async el => { el.scrollTop = el.scrollHeight; await new Promise(requestAnimationFrame); return el.scrollTop; });
      const after = await dialog.locator('.el-dialog__header, .el-drawer__header, .el-message-box__header').boundingBox();
      if (Math.abs(before.y - after.y) > 1 || (mustScroll && !moved)) throw new Error(name + ' 标题不固定或滚动未生效');
      const footer = dialog.locator('.el-dialog__footer, .el-drawer__footer, .el-message-box__btns');
      if (await footer.count()) {
        const afterFooter = await footer.boundingBox();
        if (Math.abs(dimensions.footerBottom - (afterFooter.y + afterFooter.height)) > 1) throw new Error(name + ' 底部操作发生位移');
      }
      await page.screenshot({ path: `artifacts/overlays-ui/${name}-${viewport.width}.png`, fullPage: true, animations: 'disabled' });
      await scroller.evaluate(el => { el.scrollTop = 0; });
    }

    await page.goto('http://localhost:5173/systems');
    await page.getByLabel('账号', { exact: true }).fill(process.env.SEED_ADMIN_USERNAME || 'admin');
    await page.getByLabel('密码', { exact: true }).fill(process.env.SEED_ADMIN_PASSWORD);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.locator('.system-card').first().waitFor();

    await page.getByRole('button', { name: '新建指标体系', exact: true }).click();
    await checkOverlay('create-system');
    await page.setViewportSize({ width: 390, height: 560 });
    await checkOverlay('create-system');
    await page.locator('.el-dialog:visible').getByRole('button', { name: '取消', exact: true }).click();
    await page.setViewportSize({ width: 1500, height: 1000 });

    const versionId = await page.evaluate(async () => {
      const systems = await (await fetch('/api/systems', { credentials: 'include' })).json();
      return systems.find(system => system.indicatorCount > 0)?.versionId;
    });
    if (!versionId) throw new Error('缺少可用于只读验证的指标体系');
    await page.goto('http://localhost:5173/systems/' + versionId);
    await page.getByRole('button', { name: '模板设置', exact: true }).waitFor();
    await page.getByRole('button', { name: '模板设置', exact: true }).click();
    await page.getByLabel('模块名称', { exact: true }).first().waitFor();
    await checkOverlay('template-settings', '.template-settings-dialog:visible', '.template-editor-scroll > .el-scrollbar__wrap', true);
    await page.setViewportSize({ width: 390, height: 600 });
    await checkOverlay('template-settings', '.template-settings-dialog:visible', '.template-editor-scroll > .el-scrollbar__wrap', true);
    const templateOverflow = await page.locator('.template-editor-scroll .el-scrollbar__wrap').evaluate(el => el.scrollWidth > el.clientWidth + 1);
    if (templateOverflow) throw new Error('模板窄屏字段区横向溢出');
    await page.locator('.template-settings-dialog').getByRole('button', { name: '取消', exact: true }).click();
    await page.setViewportSize({ width: 1500, height: 1000 });

    await page.getByRole('button', { name: '权限管理', exact: true }).click();
    await page.locator('.system-access-dialog .el-table__row').first().waitFor();
    await checkOverlay('system-access', '.system-access-dialog:visible', '.el-table__body-wrapper .el-scrollbar__wrap', true);
    await page.setViewportSize({ width: 390, height: 600 });
    await checkOverlay('system-access', '.system-access-dialog:visible', '.el-table__body-wrapper .el-scrollbar__wrap', true);
    await page.getByRole('button', { name: '添加用户', exact: true }).click();
    await checkOverlay('add-member');
    await page.locator('.el-dialog:visible').last().getByRole('button', { name: '取消', exact: true }).click();
    await page.locator('.system-access-dialog').getByRole('button', { name: '关闭', exact: true }).click();
    await page.setViewportSize({ width: 1500, height: 1000 });

    await page.locator('.tree-label .node-text').first().click();
    await page.getByRole('button', { name: '修订记录', exact: true }).click();
    await page.locator('.el-timeline-item').first().waitFor();
    await checkOverlay('revisions', '.el-drawer:visible', '.el-drawer__body', true);
    await page.setViewportSize({ width: 390, height: 600 });
    await checkOverlay('revisions', '.el-drawer:visible', '.el-drawer__body', true);
    await page.locator('.el-drawer__close-btn').click();
    await page.setViewportSize({ width: 1500, height: 1000 });

    await page.getByRole('button', { name: '用户管理', exact: true }).click();
    await page.getByRole('button', { name: '新建用户', exact: true }).click();
    await checkOverlay('create-user');
    await page.setViewportSize({ width: 390, height: 500 });
    await checkOverlay('create-user', '.el-dialog:visible', '.el-dialog__body', true);
    await page.locator('.el-dialog:visible').getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '同步企业微信', exact: true }).click();
    await checkOverlay('confirm', '.el-message-box:visible', '.el-message-box__content');
    await page.locator('.el-message-box').getByRole('button', { name: /取消|Cancel/, exact: true }).click();
    if (errors.length) throw new Error(errors.join('; '));
    console.log('弹窗、模板字段滚动、权限表格、嵌套授权、修订抽屉及确认框的桌面/窄屏验证通过；未写入业务数据。');
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
