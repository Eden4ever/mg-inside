// 工作区与登录页只读视觉回归：读取本地记录，不保存业务数据，也不生成 AI 内容。
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { mkdirSync } = require('node:fs');
const baseUrl = process.env.PRIMARY_UI_BASE_URL || 'http://localhost:5173';
const artifacts = 'artifacts/workspace-surfaces-ui';

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  let page;
  try {
    page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    page.setDefaultTimeout(15000);
    const errors = [];
    const deniedWrites = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && !path.endsWith('/auth/login')) {
        deniedWrites.push(`${request.method()} ${path}`);
        return route.abort('blockedbyclient');
      }
      return route.continue();
    });
    mkdirSync(artifacts, { recursive: true });
    const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const screenshot = name => page.screenshot({ path: `${artifacts}/${name}.png`, fullPage: true, animations: 'disabled' });
    async function noOverflow(selector) {
      const result = await page.locator(selector).evaluate(el => ({
        overflow: el.scrollWidth - el.clientWidth,
        documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        documentScroll: document.scrollingElement.scrollTop,
      }));
      if (result.overflow > 1 || result.documentOverflow > 1) throw new Error(`${selector} 页面横向溢出`);
      if (result.documentScroll) throw new Error(`${selector} 发生文档外层滚动`);
    }
    async function scrollTo(selector, end) {
      const moved = await page.locator(selector).evaluate((el, toEnd) => { el.scrollTo({ top: toEnd ? el.scrollHeight : 0, behavior: 'instant' }); return el.scrollTop; }, end);
      await settle();
      return moved;
    }
    await page.goto(`${baseUrl}/systems`);
    await page.getByLabel('账号', { exact: true }).waitFor();
    for (const viewport of [{ width: 1500, height: 950 }, { width: 390, height: 844 }, { width: 390, height: 480 }]) {
      await page.setViewportSize(viewport);
      await scrollTo('.login-page', false);
      const brand = await page.locator('.login-brand').boundingBox();
      if (!brand || brand.y < 0) throw new Error('登录页顶部品牌被居中布局裁掉');
      await noOverflow('.login-page');
      await screenshot(`login-top-${viewport.width}x${viewport.height}`);
      const moved = await scrollTo('.login-page', true);
      if (viewport.height === 480 && moved < 1) throw new Error('登录页短高视口未提供内部滚动');
      const button = await page.locator('.login-submit').boundingBox();
      if (!button || button.y < 0 || button.y + button.height > viewport.height + 1) throw new Error('登录按钮无法在内部滚动后完整到达');
      await screenshot(`login-bottom-${viewport.width}x${viewport.height}`);
    }
    await page.setViewportSize({ width: 1500, height: 950 });
    if (!process.env.SEED_ADMIN_PASSWORD) throw new Error('请通过 node --env-file=.env 提供本地登录环境变量。');
    await page.getByLabel('账号', { exact: true }).fill(process.env.SEED_ADMIN_USERNAME || 'admin');
    await page.getByLabel('密码', { exact: true }).fill(process.env.SEED_ADMIN_PASSWORD);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.locator('.system-card').first().waitFor();
    const counts = await page.locator('.system-card-stats > span:first-child').allTextContents();
    const index = counts.findIndex(text => parseInt(text, 10) > 0);
    if (index < 0) throw new Error('本地没有包含指标的体系可供只读验证');
    await page.locator('.system-card-actions').nth(index).getByRole('button', { name: '进入体系', exact: true }).click();
    await page.locator('.tree-label').first().waitFor();
    // 优先验证现存三级明细模板；展开树只改变浏览器状态。
    const secondLevel = page.locator('.el-tree-node').filter({ has: page.locator(':scope > .el-tree-node__content .tree-label.level-2') }).first();
    if (await secondLevel.count()) {
      const expander = secondLevel.locator(':scope > .el-tree-node__content .el-tree-node__expand-icon:not(.is-leaf)');
      if (await expander.count() && !(await secondLevel.getAttribute('class')).includes('is-expanded')) await expander.click();
    }
    const thirdLevel = page.locator('.tree-label.level-3').first();
    if (await thirdLevel.isVisible()) await thirdLevel.locator('.node-text').click();
    else await page.locator('.tree-label .node-text').first().click();
    await page.locator('.module-section').first().waitFor();
    await page.locator('.workspace-loading').waitFor({ state: 'hidden' });
    if (!(await page.locator('.ai-collapsed-button').isVisible()) || await page.locator('.ai-panel').count()) throw new Error('AI 指标专家没有默认收起');

    async function checkWorkspace(width, height) {
      await page.setViewportSize({ width, height });
      await scrollTo('.detail-layout', false);
      await scrollTo('.module-scroll', false);
      const header = await page.locator('.workspace-toolbar').boundingBox();
      const root = await page.locator('.detail-page').boundingBox();
      if (!header || !root || Math.abs(header.x - root.x) > 1 || Math.abs(header.width - root.width) > 1) throw new Error('工作区标题操作栏没有贯穿内容区域');
      const panels = await page.locator('.summary-card, .module-section').evaluateAll(items => items.map(el => {
        const box = el.getBoundingClientRect(); const style = getComputedStyle(el);
        return { x: box.x, width: box.width, border: style.borderTopWidth, radius: style.borderTopLeftRadius };
      }));
      if (panels.some(item => Math.abs(item.x - panels[0].x) > 1 || Math.abs(item.width - panels[0].width) > 1)) throw new Error('摘要与模块正文未保持单列对齐');
      if (panels.some(item => item.border !== '1px' || item.radius !== '6px')) throw new Error('摘要或模块卡片边框规格未生效');
      const doubleBorders = await page.locator('.module-values .el-descriptions__table').evaluateAll(tables => tables.some(table => {
        if (getComputedStyle(table).borderCollapse !== 'collapse') return true;
        const rows = [...table.querySelectorAll('tr')];
        return rows.some((row, index) => [...row.children].some((cell, col) => {
          const style = getComputedStyle(cell);
          return (index === 0 && style.borderTopWidth !== '0px') || (index === rows.length - 1 && style.borderBottomWidth !== '0px') || (col === 0 && style.borderLeftWidth !== '0px') || (col === row.children.length - 1 && style.borderRightWidth !== '0px');
        }));
      }));
      if (doubleBorders) throw new Error('模块描述表外围与卡片边框重复');
      await noOverflow('.detail-page');
      await noOverflow('.workspace-detail');
      await screenshot(`workspace-top-${width}x${height}`);
      await scrollTo('.detail-layout', true);
      const moved = await scrollTo('.module-scroll', true);
      if (!moved) throw new Error('指标明细未产生预期正文滚动');
      const after = await page.locator('.workspace-toolbar').boundingBox();
      if (Math.abs(after.y - header.y) > 1) throw new Error('工作区标题栏随正文滚动发生位移');
      const lastCell = await page.locator('.module-section').last().locator('.el-descriptions__cell').last().boundingBox();
      if (!lastCell || lastCell.y + lastCell.height > height + 1 || lastCell.y + lastCell.height <= after.y + after.height) throw new Error('正文末尾内容无法滚动至可见范围');
      await screenshot(`workspace-bottom-${width}x${height}`);
      await scrollTo('.detail-layout', false);
      await scrollTo('.module-scroll', false);
    }
    await checkWorkspace(1500, 950);
    const treeBorder = await page.locator('.tree-panel').evaluate(el => getComputedStyle(el).borderRightWidth);
    if (treeBorder !== '1px') throw new Error('指标树与正文之间缺少分栏边界');
    // 仅展开面板检查三栏分隔；不填写、生成或采纳任何 AI 内容。
    await page.locator('.ai-collapsed-button').click();
    await page.locator('.ai-panel').waitFor();
    if (await page.locator('.ai-panel').evaluate(el => getComputedStyle(el).borderLeftWidth) !== '1px') throw new Error('正文与 AI 面板之间缺少分栏边界');
    await screenshot('workspace-three-panels-1500x950');
    await page.getByRole('button', { name: '收起 AI 指标专家', exact: true }).click();
    await checkWorkspace(390, 844);
    await page.getByRole('button', { name: '编辑模块', exact: true }).first().click();
    await page.locator('.module-form').waitFor();
    await noOverflow('.workspace-detail');
    await screenshot('workspace-edit-390x844');
    await page.locator('.module-actions').filter({ has: page.getByRole('button', { name: '取消', exact: true }) }).getByRole('button', { name: '取消', exact: true }).click();
    if (errors.length) throw new Error('页面脚本异常：' + errors.join('; '));
    if (deniedWrites.length) throw new Error('检测到意外业务写入请求，已阻止：' + deniedWrites.join('; '));
    console.log('登录页桌面/窄屏/短高滚动，以及真实指标工作区贯穿标题、三栏边界、单列正文、单线表格、末尾可达和编辑态布局验证通过。未提交业务变更或调用 AI。');
  } catch (error) {
    await page?.screenshot({ path: `${artifacts}/failure.png`, fullPage: true, animations: 'disabled' });
    throw error;
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
