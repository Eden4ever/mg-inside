// 一级页面的只读布局回归：列表数据仅在浏览器中模拟，不写数据库、不调用智谱。
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { mkdirSync } = require('node:fs');

const baseUrl = process.env.PRIMARY_UI_BASE_URL || 'http://localhost:5173';
const artifacts = 'artifacts/primary-pages-ui';
const timestamp = '2026-09-07T08:00:00Z';
const systems = Array.from({ length: 24 }, (_, i) => ({
  id: `visual-system-${i}`, versionId: `visual-version-${i}`,
  name: `视觉测试体系 ${String(i + 1).padStart(2, '0')} · 营商环境监测指标`,
  code: `VISUAL-${String(i + 1).padStart(2, '0')}`, year: 2026, version: 'V1.0',
  region: '示例地区', maxLevel: 3, indicatorCount: 36 + i,
  progress: 40 + i * 2, status: 'draft', updatedAt: timestamp,
  access: { systemRole: 'creator', canManageAccess: true, canView: true, canResearch: true, canManageCatalog: true, canReview: true, canPublish: true },
}));
const users = Array.from({ length: 80 }, (_, i) => ({
  id: `visual-user-${i}`, username: `visual_user_${i + 1}`, displayName: `视觉测试用户 ${String(i + 1).padStart(2, '0')}`,
  departmentName: '示例部门', role: i % 3 ? 'reader' : 'catalog_manager', status: i % 7 ? 'active' : 'disabled',
  authSource: 'local', wecomBound: false, wecomIdentities: [], lastLoginAt: timestamp, createdAt: timestamp, updatedAt: timestamp,
}));

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  let page;
  try {
    page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    page.setDefaultTimeout(15000);
    const errors = [];
    const deniedWrites = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && !path.endsWith('/auth/login')) {
        deniedWrites.push(`${request.method()} ${path}`);
        return route.abort('blockedbyclient');
      }
      if (path.endsWith('/api/systems')) return route.fulfill({ json: systems });
      if (path.endsWith('/api/users')) return route.fulfill({ json: users });
      if (path.endsWith('/api/model-management')) return route.fulfill({ json: { enabled: true, configured: false, hasKey: false, revision: 0 } });
      return route.continue();
    });
    mkdirSync(artifacts, { recursive: true });
    await page.goto(`${baseUrl}/systems`);
    if (!process.env.SEED_ADMIN_PASSWORD) throw new Error('缺少本地登录环境变量，请通过 node --env-file=.env 运行。');
    await page.getByLabel('账号', { exact: true }).fill(process.env.SEED_ADMIN_USERNAME || 'admin');
    await page.getByLabel('密码', { exact: true }).fill(process.env.SEED_ADMIN_PASSWORD);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.locator('.system-card').first().waitFor();

    async function settle() {
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    }
    async function navigate(label) {
      const mobileTrigger = page.getByRole('button', { name: '打开导航', exact: true });
      if (await mobileTrigger.isVisible()) await mobileTrigger.click();
      await page.getByRole('button', { name: label, exact: true }).click();
    }
    async function noOuterOverflow(root) {
      const measurements = await page.locator(root).evaluate(el => ({
        rootOverflow: el.scrollWidth - el.clientWidth,
        documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        rootScrollTop: el.scrollTop,
        documentScrollTop: document.scrollingElement.scrollTop,
      }));
      if (measurements.rootOverflow > 1 || measurements.documentOverflow > 1) throw new Error(`${root} 发生页面横向溢出`);
      if (measurements.rootScrollTop || measurements.documentScrollTop) throw new Error(`${root} 外层页面发生滚动`);
    }
    async function assertContentVisible(scrollSelector, contentSelector) {
      const scroll = await page.locator(scrollSelector).boundingBox();
      const content = await page.locator(contentSelector).last().boundingBox();
      if (!scroll || !content || content.y < scroll.y - 2 || content.y + content.height > scroll.y + scroll.height + 2) {
        throw new Error(`${contentSelector} 无法在内容区滚动到完整可见`);
      }
    }
    async function assertFillsContainer(selector) {
      const measurements = await page.locator(selector).evaluate(el => {
        const parent = el.parentElement;
        const style = getComputedStyle(parent);
        return { width: el.getBoundingClientRect().width, available: parent.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) };
      });
      if (measurements.width < measurements.available * 0.95 || measurements.width > measurements.available + 2) throw new Error(`${selector} 未跟随可用内容宽度伸缩`);
    }
    async function checkFixed({ root, heading, scroll, fixed = [], last, name, requiredScroll = true }) {
      await page.locator(heading).waitFor();
      await settle();
      const selectors = [heading, ...fixed];
      const positions = await Promise.all(selectors.map(selector => page.locator(selector).boundingBox()));
      const moved = await page.locator(scroll).evaluate(el => { el.scrollTop = el.scrollHeight; return el.scrollTop; });
      await settle();
      if (requiredScroll && moved < 1) throw new Error(`${name} 测试内容未产生预期独立滚动`);
      for (let i = 0; i < selectors.length; i++) {
        const after = await page.locator(selectors[i]).boundingBox();
        if (!positions[i] || !after || Math.abs(after.y - positions[i].y) > 1 || Math.abs(after.x - positions[i].x) > 1) {
          throw new Error(`${name} 的 ${selectors[i]} 随内容滚动发生位移`);
        }
      }
      if (last) await assertContentVisible(scroll, last);
      await noOuterOverflow(root);
      const viewport = page.viewportSize();
      await page.screenshot({ path: `${artifacts}/${name}-${viewport.width}x${viewport.height}.png`, fullPage: true, animations: 'disabled' });
      await page.locator(scroll).evaluate(el => { el.scrollTop = 0; });
      await settle();
    }

    for (const viewport of [{ width: 1500, height: 950 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await page.goto(`${baseUrl}/systems`);
      await page.locator('.system-card').nth(23).waitFor();
      await page.locator('.systems-page .el-loading-mask').waitFor({ state: 'hidden' });
      const search = page.getByPlaceholder('搜索体系名称或地区');
      await search.fill('VISUAL-01');
      await settle();
      if (await page.locator('.system-card').count() !== 1) throw new Error('体系搜索筛选回归失败');
      await search.fill('');
      await page.locator('.system-card').nth(23).waitFor();
      await checkFixed({ root: '.systems-page', heading: '.page-heading', scroll: '.table-card > .el-card__body', fixed: ['.table-toolbar'], last: '.system-card', name: 'systems' });

      await navigate('用户管理');
      await page.locator('.table-wrap .el-table__row').nth(79).waitFor();
      const userScroll = '.table-wrap .el-table__body-wrapper .el-scrollbar__wrap';
      await checkFixed({ root: '.users-page', heading: '.users-toolbar', scroll: userScroll, fixed: ['.users-list-toolbar', '.table-wrap .el-table__header-wrapper'], last: '.table-wrap .el-table__row', name: 'users' });
      if (viewport.width < 700) {
        const shift = await page.locator(userScroll).evaluate(el => { el.scrollLeft = el.scrollWidth; return el.scrollLeft; });
        await settle();
        if (shift < 1) throw new Error('窄屏用户表格缺少内部横向滚动');
        const operationHeader = await page.locator('.table-wrap .el-table__header th').last().boundingBox();
        const operationCell = await page.locator('.table-wrap .el-table__row').first().locator('td').last().boundingBox();
        if (!operationHeader || !operationCell || Math.abs(operationHeader.x - operationCell.x) > 1) throw new Error('用户表头与内容横向滚动不同步');
        await noOuterOverflow('.users-page');
        await page.screenshot({ path: `${artifacts}/users-horizontal-${viewport.width}.png`, fullPage: true, animations: 'disabled' });
      }

      await navigate('模型管理');
      await page.getByText('embedding-3', { exact: true }).waitFor();
      await assertFillsContainer('.model-body > .el-card');
      await checkFixed({ root: '.model-page', heading: '.model-header', scroll: '.model-body', last: '.model-body .muted', name: 'models', requiredScroll: false });
      await page.setViewportSize({ width: viewport.width, height: viewport.width > 700 ? 380 : 480 });
      await checkFixed({ root: '.model-page', heading: '.model-header', scroll: '.model-body', last: '.model-body .muted', name: 'models-short' });

      await page.setViewportSize(viewport);
      await navigate('个人中心');
      await page.getByRole('button', { name: '保存新密码', exact: true }).waitFor();
      await assertFillsContainer('.profile-body');
      await checkFixed({ root: '.profile-page', heading: '.profile-header', scroll: '.profile-scroll', last: '.profile-tip', name: 'profile', requiredScroll: viewport.width < 700 });
      await page.setViewportSize({ width: viewport.width, height: viewport.width > 700 ? 380 : 480 });
      await checkFixed({ root: '.profile-page', heading: '.profile-header', scroll: '.profile-scroll', last: '.profile-tip', name: 'profile-short' });
    }
    await page.setViewportSize({ width: 900, height: 900 });
    await assertFillsContainer('.profile-body');
    await checkFixed({ root: '.profile-page', heading: '.profile-header', scroll: '.profile-scroll', last: '.profile-tip', name: 'profile-tablet', requiredScroll: false });
    // 全局导航在 <=980px 时变为覆盖式抽屉；1000px 才能验证占据宽度的展开侧栏。
    await page.setViewportSize({ width: 1000, height: 900 });
    const expandSidebar = page.getByRole('button', { name: '展开导航栏', exact: true });
    if (await expandSidebar.isVisible()) await expandSidebar.click();
    await settle();
    await assertFillsContainer('.profile-body');
    const panels = await page.locator('.profile-panel').evaluateAll(items => items.map(el => ({ x: el.getBoundingClientRect().x, y: el.getBoundingClientRect().y })));
    if (Math.abs(panels[0].x - panels[1].x) > 1 || panels[1].y <= panels[0].y) throw new Error('1000px 且导航展开时个人中心未根据实际内容宽度切换单列');
    await checkFixed({ root: '.profile-page', heading: '.profile-header', scroll: '.profile-scroll', last: '.profile-tip', name: 'profile-expanded-sidebar', requiredScroll: false });
    if (errors.length) throw new Error('页面脚本异常：' + errors.join('; '));
    if (deniedWrites.length) throw new Error('检测到意外业务写入请求，已阻止：' + deniedWrites.join('; '));
    console.log('指标体系、用户管理、模型管理和个人中心的桌面/窄屏固定标题、独立滚动与内容可达性验证通过。列表数据仅浏览器模拟，未修改业务数据或调用智谱。');
  } catch (error) {
    await page?.screenshot({ path: `${artifacts}/failure.png`, fullPage: true, animations: 'disabled' });
    throw error;
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
