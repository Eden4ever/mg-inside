const cdpBase = process.env.CDP_BASE_URL || 'http://127.0.0.1:9223';
const appBase = (process.env.APP_BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
const targets = await fetch(`${cdpBase}/json/list`).then((response) => response.json());
const target = targets.find((item) => item.type === 'page');
if (!target) throw new Error('No browser page is available for route verification.');

const socket = new WebSocket(target.webSocketDebuggerUrl);
let sequence = 0;
const pending = new Map();

socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.method === 'Page.javascriptDialogOpening') {
    socket.send(JSON.stringify({ id: ++sequence, method: 'Page.handleJavaScriptDialog', params: { accept: true } }));
    return;
  }
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

async function pageState() {
  return evaluate(`(() => ({
    url: location.href,
    title: document.title,
    readyState: document.readyState,
    loginVisible: Boolean(document.querySelector('input[autocomplete="username"]')),
    systemsVisible: Boolean(document.querySelector('.systems-page')),
    systemDetailVisible: Boolean(document.querySelector('.system-detail-page')),
    workspaceVisible: Boolean(document.querySelector('.workspace-detail')),
    usersVisible: Boolean(document.querySelector('.users-page')),
    activeNav: document.querySelector('.global-nav [aria-current="page"]')?.textContent?.trim() || '',
  }))()`);
}

async function waitFor(predicate, label, timeout = 8000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    const state = await pageState();
    if (await predicate(state)) return state;
    await wait(150);
  }
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(await pageState())}`);
}

await command('Page.enable');
await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await command('Page.navigate', { url: `${appBase}/systems` });
const systems = await waitFor((state) => state.systemsVisible || state.loginVisible, 'systems page');
if (systems.loginVisible) throw new Error('The selected browser page is not authenticated.');

const entered = await evaluate(`(() => {
  const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.includes('进入体系'));
  button?.click();
  return Boolean(button);
})()`);
if (!entered) throw new Error('No indicator system is available to enter.');

const detail = await waitFor((state) => state.systemDetailVisible && state.url !== systems.url && !state.url.includes('/indicators/'), 'system detail');
await evaluate('history.back()');
const afterBack = await waitFor((state) => state.systemsVisible && new URL(state.url).pathname.endsWith('/systems'), 'browser back to systems');

await evaluate('history.forward()');
const afterForward = await waitFor((state) => state.systemDetailVisible && state.url === detail.url, 'browser forward to detail');

await command('Page.reload', { ignoreCache: true });
await wait(800);
const afterReload = await waitFor((state) => state.readyState === 'complete' && state.systemDetailVisible && state.url === detail.url, 'detail reload');

const openedWorkspace = await evaluate(`(() => {
  const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.includes('进入研究'));
  button?.click();
  return Boolean(button);
})()`);
if (!openedWorkspace) throw new Error('The system detail has no level-3 research entry.');
const workspace = await waitFor((state) => state.workspaceVisible && state.url.includes('/indicators/'), 'indicator workspace');

const returnedToDetail = await evaluate(`(() => {
  const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.includes('返回体系详情'));
  button?.click();
  return Boolean(button);
})()`);
if (!returnedToDetail) throw new Error('The workspace has no explicit return-to-detail action.');
const afterExplicitReturn = await waitFor((state) => state.systemDetailVisible && state.url === detail.url, 'explicit return to system detail');

const returnedToSystems = await evaluate(`(() => {
  const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.includes('返回列表'));
  button?.click();
  return Boolean(button);
})()`);
if (!returnedToSystems) throw new Error('The system detail has no explicit return-to-list action.');
const afterExplicitListReturn = await waitFor((state) => state.systemsVisible && new URL(state.url).pathname.endsWith('/systems'), 'explicit return to systems');
await evaluate('history.back()');
await waitFor((state) => state.systemDetailVisible && state.url === detail.url, 'browser back to detail after explicit list return');

const openedUsers = await evaluate(`(() => {
  const button = Array.from(document.querySelectorAll('.global-nav .nav-item')).find((item) => item.textContent?.includes('用户管理'));
  button?.click();
  return Boolean(button);
})()`);
if (!openedUsers) {
  const navigation = await evaluate(`Array.from(document.querySelectorAll('.global-nav .nav-item')).map((item) => item.textContent?.trim())`);
  throw new Error(`User management navigation is unavailable for the current account: ${JSON.stringify(navigation)}`);
}

const users = await waitFor((state) => state.usersVisible && new URL(state.url).pathname.endsWith('/users'), 'users page');
await evaluate('history.back()');
const usersBack = await waitFor((state) => state.systemDetailVisible && state.url === detail.url, 'browser back from users');

await waitFor(async () => Boolean(await evaluate(`Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.includes('进入研究'))`)), 'research entry after users back');
const reopenedWorkspace = await evaluate(`(() => {
  const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.includes('进入研究'));
  button?.click();
  return Boolean(button);
})()`);
if (!reopenedWorkspace) throw new Error('The research entry disappeared after returning from user management.');
await waitFor((state) => state.workspaceVisible && state.url === workspace.url, 'workspace before dirty guard');

const dirtyDraft = await evaluate(`(() => {
  const edit = Array.from(document.querySelectorAll('.module-actions button')).find((item) => item.textContent?.includes('编辑模块'));
  edit?.click();
  return Boolean(edit);
})()`);
if (!dirtyDraft) throw new Error('The current module cannot enter edit mode.');
await waitFor(async () => Boolean(await evaluate("document.querySelector('.module-form')")), 'module edit form');
await evaluate(`(() => {
  const input = document.querySelector('.module-form textarea, .module-form input:not([type="checkbox"]):not([readonly])');
  if (!input) return false;
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  setter?.call(input, (input.value || '') + ' 路由拦截验收草稿');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);

const beforeUnloadPrevented = await evaluate(`(() => {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
})()`);
if (!beforeUnloadPrevented) throw new Error('beforeunload did not protect the dirty draft.');

async function openUsersFromNavigation() {
  return evaluate(`(() => {
    const button = Array.from(document.querySelectorAll('.global-nav .nav-item')).find((item) => item.textContent?.includes('用户管理'));
    button?.click();
    return Boolean(button);
  })()`);
}

await openUsersFromNavigation();
await waitFor(async () => Boolean(await evaluate("document.querySelector('.el-message-box')")), 'dirty navigation dialog');
const dirtyDialog = await evaluate(`(() => ({
  title: document.querySelector('.el-message-box__title')?.textContent?.trim() || '',
  message: document.querySelector('.el-message-box__message')?.textContent?.trim() || '',
  buttons: Array.from(document.querySelectorAll('.el-message-box__btns button')).map((item) => item.textContent?.trim()),
}))()`);
await evaluate(`document.querySelector('.el-message-box__headerbtn')?.click()`);
const stayedOnDetail = await waitFor(async (state) => state.workspaceVisible && state.url === workspace.url && !Boolean(await evaluate("document.querySelector('.el-message-box')")), 'stay on dirty workspace');

await openUsersFromNavigation();
await waitFor(async () => Boolean(await evaluate("document.querySelector('.el-message-box')")), 'dirty navigation dialog again');
const discarded = await evaluate(`(() => {
  const button = Array.from(document.querySelectorAll('.el-message-box__btns button')).find((item) => item.textContent?.includes('放弃修改'));
  button?.click();
  return Boolean(button);
})()`);
if (!discarded) throw new Error('The discard action is unavailable.');
const afterDiscard = await waitFor((state) => state.usersVisible && new URL(state.url).pathname.endsWith('/users'), 'users after discarding draft');

const result = {
  systems,
  detail,
  afterBack,
  afterForward,
  afterReload,
  workspace,
  afterExplicitReturn,
  afterExplicitListReturn,
  users,
  usersBack,
  dirtyGuard: { beforeUnloadPrevented, dirtyDialog, stayedOnDetail, afterDiscard },
};
console.log(JSON.stringify(result, null, 2));
socket.close();
