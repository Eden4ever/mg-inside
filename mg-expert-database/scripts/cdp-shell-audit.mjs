import fs from 'node:fs';

const base = 'http://127.0.0.1:9223';
const auditUsername = process.env.AUDIT_ADMIN_USERNAME || 'admin';
const auditPassword = process.env.AUDIT_ADMIN_PASSWORD || '';
const targets = await fetch(`${base}/json/list`).then((response) => response.json());
const target = targets.find((item) => item.type === 'page') || await fetch(`${base}/json/new?http://localhost:5173/`, { method: 'PUT' }).then((response) => response.json());
const socket = new WebSocket(target.webSocketDebuggerUrl);
let sequence = 0;
const pending = new Map();

socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
});
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, (message) => message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result));
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed');
  return result.result?.value;
}

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function loginIfNeeded() {
  return evaluate(`(async () => {
    const set = (selector, value) => {
      const element = document.querySelector(selector);
      if (!element) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    };
    if (!document.querySelector('input[autocomplete="username"]')) return 'existing-session';
    if (!${JSON.stringify(auditPassword)}) return 'credentials-missing';
    set('input[autocomplete="username"]', ${JSON.stringify(auditUsername)});
    set('input[autocomplete="current-password"]', ${JSON.stringify(auditPassword)});
    document.querySelector('button[type="submit"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 1600));
    return 'logged-in';
  })()`);
}

async function clickNav(label) {
  await evaluate(`(() => {
    const item = Array.from(document.querySelectorAll('.global-nav .nav-item')).find((button) => button.textContent?.includes(${JSON.stringify(label)}));
    item?.click();
    return Boolean(item);
  })()`);
  await wait(700);
}

async function inspect(width, height) {
  await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
  await command('Page.enable');
  await command('Page.navigate', { url: 'http://localhost:5173/' });
  await wait(1200);
  const auth = await loginIfNeeded();
  await wait(700);

  await clickNav('指标体系');
  const systems = await evaluate(`(() => ({
    hasPage: Boolean(document.querySelector('.systems-page')),
    activeNav: document.querySelector('.global-nav [aria-current="page"]')?.textContent?.trim(),
    headerTop: Math.round(document.querySelector('.app-header')?.getBoundingClientRect().top ?? -1),
    windowScrollY: window.scrollY,
    bodyOverflow: getComputedStyle(document.body).overflow,
    pageOverflowY: getComputedStyle(document.querySelector('.systems-page')).overflowY,
  }))()`);
  if (width === 1440 || width === 375) {
    await evaluate(`{ const page = document.querySelector('.system-detail-page'); if (page) page.scrollTop = 0; }`);
    const screenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(`artifacts/systems-${width}.png`, Buffer.from(screenshot.data, 'base64'));
  }

  await clickNav('用户管理');
  const users = await evaluate(`(() => ({
    hasPage: Boolean(document.querySelector('.users-page')),
    activeNav: document.querySelector('.global-nav [aria-current="page"]')?.textContent?.trim(),
    heading: document.querySelector('.users-page h1')?.textContent?.trim(),
    headerTop: Math.round(document.querySelector('.app-header')?.getBoundingClientRect().top ?? -1),
  }))()`);
  if (width === 1440 || width === 375) {
    const screenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(`artifacts/users-${width}.png`, Buffer.from(screenshot.data, 'base64'));
  }

  await clickNav('指标体系');
  await evaluate(`Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.includes('进入体系'))?.click()`);
  await wait(1300);
  const systemDetail = await evaluate(`(() => {
    const page = document.querySelector('.system-detail-page');
    const header = document.querySelector('.app-header');
    const beforeTop = Math.round(header?.getBoundingClientRect().top ?? -1);
    if (page) page.scrollTop = Math.min(220, Math.max(0, page.scrollHeight - page.clientHeight));
    return {
      hasPage: Boolean(page),
      activeNav: document.querySelector('.global-nav [aria-current="page"]')?.textContent?.trim(),
      beforeTop,
      afterTop: Math.round(header?.getBoundingClientRect().top ?? -1),
      pageOverflowY: page ? getComputedStyle(page).overflowY : '',
      pageScrollTop: page?.scrollTop || 0,
      noHorizontalOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      hasBack: Array.from(document.querySelectorAll('button')).some((button) => button.textContent?.includes('返回列表')),
      hasResearchEntry: Array.from(document.querySelectorAll('button')).some((button) => button.textContent?.includes('进入研究')),
      statText: document.querySelector('.stat-panel')?.textContent?.trim() || '',
    };
  })()`);
  if (width === 1440 || width === 375) {
    const screenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(`artifacts/system-detail-${width}.png`, Buffer.from(screenshot.data, 'base64'));
  }
  const openedResearch = await evaluate(`(() => {
    const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.includes('进入研究'));
    button?.click();
    return Boolean(button);
  })()`);
  if (!openedResearch) throw new Error(`${width}: 体系详情缺少三级指标研究入口`);
  await wait(1300);
  const detail = await evaluate(`(() => {
    const header = document.querySelector('.app-header');
    const scroller = window.innerWidth > 900 ? document.querySelector('.module-scroll') : document.querySelector('.detail-layout');
    const beforeTop = Math.round(header?.getBoundingClientRect().top ?? -1);
    const fixture = document.createElement('div');
    fixture.dataset.auditFixture = 'long-content';
    fixture.style.height = '960px';
    fixture.style.pointerEvents = 'none';
    scroller?.appendChild(fixture);
    const availableScroll = Math.max(0, (scroller?.scrollHeight || 0) - (scroller?.clientHeight || 0));
    if (scroller) scroller.scrollTop = Math.min(320, availableScroll);
    return {
      hasWorkspace: Boolean(document.querySelector('.workspace-detail')),
      activeNav: document.querySelector('.global-nav [aria-current="page"]')?.textContent?.trim(),
      beforeTop,
      afterTop: Math.round(header?.getBoundingClientRect().top ?? -1),
      scrollerClass: scroller?.className || '',
      scrollerClientHeight: scroller?.clientHeight || 0,
      scrollerScrollHeight: scroller?.scrollHeight || 0,
      scrollerOverflowY: scroller ? getComputedStyle(scroller).overflowY : '',
      scrollerParentHeight: scroller?.parentElement?.clientHeight || 0,
      workspaceHeight: document.querySelector('.workspace-detail')?.clientHeight || 0,
      detailLayoutHeight: document.querySelector('.detail-layout')?.clientHeight || 0,
      availableScroll,
      scrollerTop: scroller?.scrollTop || 0,
      windowScrollY: window.scrollY,
      viewportWidth: window.innerWidth,
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      noHorizontalOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      navVisible: Boolean(document.querySelector('.global-nav')),
      navLabels: Array.from(document.querySelectorAll('.global-nav .nav-item')).map((item) => item.textContent?.trim()),
      aiCollapsed: Boolean(document.querySelector('.ai-collapsed-button')),
      userAvatarVisible: Boolean(document.querySelector('.user-avatar')?.getBoundingClientRect().width),
    };
  })()`);
  await wait(500);
  detail.afterTop = await evaluate(`Math.round(document.querySelector('.app-header')?.getBoundingClientRect().top ?? -1)`);
  detail.scrollerTop = await evaluate(`(() => {
    const scroller = window.innerWidth > 900 ? document.querySelector('.module-scroll') : document.querySelector('.detail-layout');
    return scroller?.scrollTop || 0;
  })()`);

  const focusTrail = [];
  for (let index = 0; index < 6; index += 1) {
    await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    focusTrail.push(await evaluate(`(() => { const element = document.activeElement; return element && element !== document.body ? { tag: element.tagName, text: (element.textContent || '').trim().slice(0, 24), label: element.getAttribute('aria-label') } : null; })()`));
  }
  detail.keyboardFocusable = focusTrail.some(Boolean);
  detail.focusTrail = focusTrail;

  const screenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(`artifacts/shell-${width}.png`, Buffer.from(screenshot.data, 'base64'));
  return { width, height, auth, systems, users, systemDetail, detail };
}

const results = [];
for (const [width, height] of [[1440, 900], [1024, 768], [768, 900], [375, 812]]) {
  results.push(await inspect(width, height));
}

const failures = [];
for (const result of results) {
  const { width, systems, users, systemDetail, detail } = result;
  if (!systems.hasPage || systems.activeNav !== '指标体系') failures.push(`${width}: 指标体系导航状态错误`);
  if (systems.headerTop !== 0 || systems.windowScrollY !== 0 || systems.bodyOverflow !== 'hidden' || systems.pageOverflowY !== 'auto') failures.push(`${width}: 指标体系滚动壳层错误`);
  if (!users.hasPage || users.activeNav !== '用户管理' || users.heading !== '用户管理' || users.headerTop !== 0) failures.push(`${width}: 用户管理导航状态错误`);
  if (!systemDetail.hasPage || systemDetail.activeNav !== '指标体系' || !systemDetail.hasBack || !systemDetail.hasResearchEntry || !systemDetail.statText) failures.push(`${width}: 体系详情内容或操作缺失`);
  if (systemDetail.beforeTop !== 0 || systemDetail.afterTop !== 0 || !systemDetail.noHorizontalOverflow || systemDetail.pageOverflowY !== 'auto') failures.push(`${width}: 体系详情滚动或响应式错误`);
  if (!detail.hasWorkspace || detail.activeNav !== '指标体系' || !detail.navVisible) failures.push(`${width}: 研究工作台导航状态错误`);
  if (detail.beforeTop !== 0 || detail.afterTop !== 0 || detail.windowScrollY !== 0 || detail.scrollerTop <= 0) failures.push(`${width}: 内容独立滚动错误`);
  if (!detail.noHorizontalOverflow || !detail.keyboardFocusable || !detail.userAvatarVisible) failures.push(`${width}: 响应式或键盘可用性错误`);
  if (detail.aiCollapsed !== (width <= 1100)) failures.push(`${width}: AI 面板响应式状态错误`);
}
if (failures.length) throw new Error(`Shell audit failed:\n${failures.join('\n')}`);
console.log(JSON.stringify(results, null, 2));
socket.close();
