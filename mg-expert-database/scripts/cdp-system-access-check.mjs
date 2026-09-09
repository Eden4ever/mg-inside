const cdpBase = process.env.CDP_BASE_URL || 'http://127.0.0.1:9223';
const appBase = (process.env.APP_BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
const target = await fetch(`${cdpBase}/json/new?${encodeURIComponent(`${appBase}/systems`)}`, { method: 'PUT' }).then((response) => response.json());
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

async function waitFor(expression, label, timeout = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    const value = await evaluate(expression);
    if (value) return value;
    await wait(150);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function clickRowPublishAndSave() {
  return evaluate(`(() => {
    const rows = Array.from(document.querySelectorAll('.el-dialog .el-table__body-wrapper tbody tr'));
    const row = rows.find((item) => {
      const boxes = item.querySelectorAll('input[type="checkbox"]');
      return boxes.length === 5 && boxes[0].checked && !Array.from(boxes).some((box) => box.disabled);
    });
    if (!row) return null;
    const boxes = Array.from(row.querySelectorAll('input[type="checkbox"]'));
    const publish = boxes[4];
    const before = boxes.map((box) => box.checked);
    publish.click();
    const save = Array.from(row.querySelectorAll('button')).find((button) => button.textContent?.includes('保存'));
    save?.click();
    return { user: row.querySelector('strong')?.textContent?.trim() || '', before, toggled: publish.checked, saved: Boolean(save) };
  })()`);
}

try {
  await command('Page.enable');
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await waitFor(`document.readyState === 'complete' && (document.querySelector('.systems-page') || document.querySelector('input[autocomplete="username"]'))`, 'systems page');
  if (await evaluate(`Boolean(document.querySelector('input[autocomplete="username"]'))`)) throw new Error('The CDP browser session is not authenticated.');

  const opened = await evaluate(`(() => {
    const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.trim() === '权限');
    button?.click();
    return Boolean(button);
  })()`);
  if (!opened) throw new Error('No system access action is available for the current account.');
  await waitFor(`document.querySelector('.el-dialog') && document.querySelectorAll('.el-dialog .el-table__body-wrapper tbody tr').length > 1`, 'system access dialog');

  const first = await clickRowPublishAndSave();
  if (!first?.saved) throw new Error('No editable non-admin access row is available.');
  await waitFor(`Array.from(document.querySelectorAll('.el-message--success')).some((item) => item.textContent?.includes('体系权限'))`, 'first access save');
  await wait(250);

  const restored = await clickRowPublishAndSave();
  if (!restored?.saved || restored.user !== first.user || restored.toggled !== first.before[4]) throw new Error('Failed to restore the original publish permission.');
  await waitFor(`Array.from(document.querySelectorAll('.el-message--success')).filter((item) => item.textContent?.includes('体系权限')).length >= 1`, 'restored access save');
  await wait(300);

  const finalState = await evaluate(`(() => {
    const rows = Array.from(document.querySelectorAll('.el-dialog .el-table__body-wrapper tbody tr'));
    const row = rows.find((item) => item.querySelector('strong')?.textContent?.trim() === ${JSON.stringify(first.user)});
    const boxes = row ? Array.from(row.querySelectorAll('input[type="checkbox"]')) : [];
    return { user: ${JSON.stringify(first.user)}, permissions: boxes.map((box) => box.checked), allEditable: boxes.length === 5 && boxes.every((box) => !box.disabled) };
  })()`);
  if (JSON.stringify(finalState.permissions) !== JSON.stringify(first.before)) throw new Error('The original system permissions were not restored.');
  console.log(JSON.stringify({ first, restored, finalState }, null, 2));
} finally {
  socket.close();
  await fetch(`${cdpBase}/json/close/${target.id}`).catch(() => undefined);
}
