// 仅在浏览器拦截语义库接口生成视觉测试数据，不修改数据库或调用智谱。
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { mkdirSync } = require('node:fs');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const scrollTest = process.env.SEMANTIC_SCROLL_TEST === '1';
    async function assertFixed(scrollSelector, includeFilters = false) {
      const heading = await page.locator('.semantic-heading').boundingBox();
      const filter = includeFilters ? await page.locator('.list-toolbar').boundingBox() : null;
      const moved = await page.locator(scrollSelector).evaluate(async el => { el.scrollTop = el.scrollHeight; await new Promise(requestAnimationFrame); return el.scrollTop; });
      if (!moved) throw new Error('滚动测试数据不足');
      const after = await page.locator('.semantic-heading').boundingBox();
      if (Math.abs(heading.y - after.y) > 1) throw new Error('标题栏发生位移');
      if (filter && Math.abs(filter.y - (await page.locator('.list-toolbar').boundingBox()).y) > 1) throw new Error('搜索栏发生位移');
      await page.screenshot({ path: `artifacts/semantic-ui/scroll-${includeFilters ? 'list' : 'detail'}-${page.viewportSize().width}.png`, fullPage: true, animations: 'disabled' });
      await page.locator(scrollSelector).evaluate(el => { el.scrollTop = 0; });
    }
    const build = { id: 'visual-build', status: 'ready', total: 128, completed: 128, reused: 96, tokens: 3420, createdAt: '2026-09-07T08:00:00Z' };
    const lib = { id: 'visual-library', name: '营商环境指标语义库', systemName: '2026年度营商环境监测指标体系', version: '2026 · V1.0', versionId: 'visual-version', canManage: true, activeBuildId: build.id, build };
    await page.route('**/api/semantic-libraries**', route => {
      const suffix = new URL(route.request().url()).pathname;
      let data;
      if (suffix.endsWith('/search')) data = { pendingChanges: false, matches: [{ id: 'c1', nodeId: 'n1', label: '指标定义与统计口径 · 办理流程', path: '信用环境 / 信用监管 / 信用修复办理时效', text: '符合信用修复条件的经营主体，可通过信用信息平台提交修复申请。受理部门核验申请材料后，按规定办理并反馈结果。', score: 0.863, metadata: {} }] };
      else if (suffix.endsWith('/visual-library')) data = { builds: [build], active: build, pendingChanges: false, indicatorCount: 36, chunkCount: 128, preview: [{ path: '信用环境 / 信用监管', label: '政策与依据', text: '视觉测试预览内容' }] };
      else data = { configured: true, libraries: [lib, { ...lib, id: 'visual-unbuilt', name: '市场准入指标语义库', systemName: '市场准入评价指标体系', activeBuildId: null, build: null }, { ...lib, id: 'visual-failed', name: '政务服务指标语义库', systemName: '政务服务监测指标体系', build: { ...build, status: 'failed', completed: 32 } }] };
      if (scrollTest && data.libraries) data.libraries = Array.from({ length: 24 }, (_, i) => ({ ...data.libraries[i % 3], id: i ? 'scroll-' + i : lib.id }));
      if (scrollTest && data.matches) data.matches = Array.from({ length: 8 }, (_, i) => ({ ...data.matches[0], id: 'scroll-result-' + i }));
      return route.fulfill({ json: data });
    });
    await page.goto('http://localhost:5173/systems');
    await page.getByLabel('账号', { exact: true }).fill(process.env.SEED_ADMIN_USERNAME || 'admin');
    await page.getByLabel('密码', { exact: true }).fill(process.env.SEED_ADMIN_PASSWORD);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.locator('.system-card').first().waitFor();
    await page.getByRole('button', { name: '智能语义库', exact: true }).click();
    await page.getByRole('button', { name: '进入语义库', exact: true }).first().waitFor();
    await page.locator('.semantic-page .el-loading-mask').waitFor({ state: 'hidden' });
    mkdirSync('artifacts/semantic-ui', { recursive: true });
    if (scrollTest) await assertFixed('.library-list', true);
    await page.screenshot({ path: 'artifacts/semantic-ui/list-cards.png', fullPage: true, animations: 'disabled' });
    await page.setViewportSize({ width: 390, height: 844 });
    if (scrollTest) await assertFixed('.library-list', true);
    await page.screenshot({ path: 'artifacts/semantic-ui/list-mobile.png', fullPage: true, animations: 'disabled' });
    if (await page.locator('.semantic-page').evaluate(el => el.scrollWidth > el.clientWidth + 1)) throw new Error('列表窄屏溢出');
    await page.setViewportSize({ width: 1500, height: 1000 });
    await page.getByRole('button', { name: '进入语义库', exact: true }).first().click();
    await page.getByRole('region', { name: '语义检索' }).waitFor();
    mkdirSync('artifacts/semantic-ui', { recursive: true });
    await page.screenshot({ path: 'artifacts/semantic-ui/detail-empty.png', fullPage: true, animations: 'disabled' });
    await page.getByPlaceholder('输入问题，例如：信用修复的办理流程是什么？').fill('信用修复的办理流程是什么？');
    await page.getByText('同意将问题发送至智谱生成向量', { exact: true }).click();
    await page.getByRole('button', { name: '检索', exact: true }).click();
    await page.getByRole('button', { name: '查看原指标', exact: true }).first().waitFor();
    if (scrollTest) await assertFixed('.detail-body');
    await page.screenshot({ path: 'artifacts/semantic-ui/detail-results.png', fullPage: true, animations: 'disabled' });
    await page.setViewportSize({ width: 390, height: 844 });
    if (scrollTest) await assertFixed('.detail-body');
    await page.screenshot({ path: 'artifacts/semantic-ui/detail-mobile.png', fullPage: true, animations: 'disabled' });
    const overflow = await page.locator('.semantic-page').evaluate(el => el.scrollWidth > el.clientWidth + 1);
    if (overflow || errors.length) throw new Error('布局溢出或页面异常：' + errors.join('; '));
    console.log('语义库详情空态、检索结果及窄屏验证通过（浏览器测试数据，未调用智谱）。');
  } finally { await browser.close(); }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
