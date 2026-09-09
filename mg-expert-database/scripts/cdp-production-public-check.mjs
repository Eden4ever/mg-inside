import fs from 'node:fs';

const cdpBase = process.env.CDP_BASE_URL || 'http://127.0.0.1:9223';
const appBase = (process.env.APP_BASE_URL || 'https://yshj.meta-gravity.com/knowledge-base-inside').replace(/\/$/, '');
const target = await fetch(`${cdpBase}/json/new?${encodeURIComponent(`${appBase}/`)}`, { method: 'PUT' }).then((response) => response.json());
const socket = new WebSocket(target.webSocketDebuggerUrl);
let sequence = 0;
const pending = new Map();

socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const settle = pending.get(message.id);
  pending.delete(message.id);
  message.error ? settle.reject(new Error(JSON.stringify(message.error))) : settle.resolve(message.result);
});

await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed.');
  return result.result?.value;
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForLogin(pathname) {
  await command('Page.navigate', { url: `${appBase}${pathname}` });
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10000) {
    const state = await evaluate(`(() => ({
      url: location.href,
      title: document.title,
      readyState: document.readyState,
      loginVisible: Boolean(document.querySelector('input[autocomplete="username"]')),
      wecomVisible: Array.from(document.querySelectorAll('button')).some((item) => item.textContent?.includes('企业微信扫码登录')),
      wecomDisabled: Boolean(document.querySelector('.wecom-button')?.disabled),
      wecomStatus: document.querySelector('.wecom-status')?.textContent?.trim() || '',
      errorMessages: Array.from(document.querySelectorAll('.el-message--error')).map((item) => item.textContent?.trim()),
      appMounted: Boolean(document.querySelector('#app')?.children.length),
    }))()`);
    if (state.readyState === 'complete' && state.loginVisible && state.wecomVisible && !state.wecomDisabled && !state.wecomStatus && state.errorMessages.length === 0) return state;
    await wait(150);
  }
  throw new Error(`Production login page did not render for ${pathname}.`);
}

try {
  await command('Page.enable');
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const home = await waitForLogin('/');
  const screenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync('artifacts/production-login-1440.png', Buffer.from(screenshot.data, 'base64'));
  const deepLink = await waitForLogin('/systems/runtime-browser-check/indicators/node-check');
  console.log(JSON.stringify({ home, deepLink }, null, 2));
} finally {
  socket.close();
  await fetch(`${cdpBase}/json/close/${target.id}`);
}
