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

async function evaluate(expression, awaitPromise = true, returnByValue = true) {
  const result = await command('Runtime.evaluate', { expression, awaitPromise, returnByValue });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed');
  return result.result?.value;
}

async function wait(ms) { await new Promise((resolve) => setTimeout(resolve, ms)); }

async function openPage(width, height, label) {
  await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
  await command('Page.enable');
  await command('Page.navigate', { url: 'http://localhost:5173/' });
  await wait(1800);
  const auth = await evaluate(`(async () => {
    const set = (selector, value) => {
      const element = document.querySelector(selector);
      if (!element) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    };
    if (document.querySelector('input[autocomplete="username"]')) {
      if (!${JSON.stringify(auditPassword)}) return 'credentials-missing';
      set('input[autocomplete="username"]', ${JSON.stringify(auditUsername)});
      set('input[autocomplete="current-password"]', ${JSON.stringify(auditPassword)});
      document.querySelector('button[type="submit"]')?.click();
      await new Promise((resolve) => setTimeout(resolve, 1800));
      return 'logged-in';
    }
    return document.body.innerText.includes('指标体系管理') ? 'already-authenticated' : 'login-not-ready';
  })()`);
  await wait(1200);
  const systems = await evaluate(`Array.from(document.querySelectorAll('button')).find((button) => button.innerText.includes('进入体系'))?.click(); 'clicked'`);
  await wait(1800);
  const metrics = await evaluate(`(() => {
    const treeToggle = document.querySelector('.mobile-collapse');
    const aiClose = document.querySelector('[aria-label="收起 AI 指标专家"]');
    return {
      label: ${JSON.stringify(label)},
      auth: ${JSON.stringify(auth)},
      innerWidth: window.innerWidth,
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      noHorizontalOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      hasWorkspace: Boolean(document.querySelector('.workspace-detail')),
      treeToggleDisplay: treeToggle ? getComputedStyle(treeToggle).display : 'missing',
      aiClosePresent: Boolean(aiClose),
      focusableCount: document.querySelectorAll('button, input, textarea, select, [tabindex]:not([tabindex="-1"])').length,
    };
  })()`);
  const focusTrail = [];
  for (let index = 0; index < 8; index += 1) {
    await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    focusTrail.push(await evaluate(`(() => { const element = document.activeElement; return element && element !== document.body ? { tag: element.tagName, label: element.getAttribute('aria-label'), text: (element.innerText || '').trim().slice(0, 40) } : null; })()`));
  }
  metrics.keyboardFocusable = focusTrail.some((item) => item !== null);
  metrics.focusTrail = focusTrail;
  if (width < 600) {
    await evaluate(`document.querySelector('.mobile-collapse')?.click(); document.querySelector('[aria-label="收起 AI 指标专家"]')?.click(); 'collapsed'`);
    await wait(250);
    metrics.treeCollapsed = await evaluate(`(() => { const tree = document.querySelector('.tree-scroll'); return !tree || tree.getClientRects().length === 0 || getComputedStyle(tree).display === 'none'; })()`);
    metrics.aiCollapsed = await evaluate(`Boolean(document.querySelector('.ai-collapsed-button'))`);
  }
  const screenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(`artifacts/${label}.png`, Buffer.from(screenshot.data, 'base64'));
  return metrics;
}

const desktop = await openPage(1440, 900, 'workspace-desktop');
const mobile = await openPage(390, 844, 'workspace-mobile-390');
console.log(JSON.stringify({ desktop, mobile }, null, 2));
socket.close();
