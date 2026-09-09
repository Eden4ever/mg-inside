import { DESKTOP_PROTOCOL, isDesktopMessage, safeAppPath, validateDialogDefinitions, isDialogParams, isDialogResult, isDialogData, type DesktopDialogDefinition, type DesktopDialogContext, type DesktopDialogResult } from '../../desktop-contracts/src/index';

export interface BridgeOptions {
  appId: string; allowedOrigins: string[];
  onClose?: () => boolean | Promise<boolean>;
  onNavigate?: (path: string) => void | Promise<void>;
  onVisibility?: (visible: boolean) => void;
  onTheme?: (theme: 'light' | 'dark') => void;
}
export function connectDesktop(options: BridgeOptions) {
  const query = new URLSearchParams(location.search);
  const frameContext = window.name.split('|');
  const namedFrame = frameContext.length === 3 && frameContext[0] === DESKTOP_PROTOCOL;
  const origin = query.get('desktopOrigin') || (namedFrame ? frameContext[1] : '') || '';
  const windowId = query.get('desktopWindow') || (namedFrame ? frameContext[2] : '') || '';
  const enabled = window.parent !== window && (query.get('embed') === 'desktop' || namedFrame)
    && options.allowedOrigins.includes(origin) && /^[A-Za-z0-9_-]{1,100}$/.test(windowId);
  let dirty = false, busy = false, title = document.title;
  let closing = false;
  let dialogs: DesktopDialogDefinition[] = [], context: DesktopDialogContext | undefined, registeredDialogs = false;
  const pendingDialogs = new Map<string, (result: DesktopDialogResult) => void>();
  const contextWaiters = new Set<{ resolve: (value: DesktopDialogContext) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  function send(type: string, payload?: Record<string, unknown>, requestId?: string) {
    if (enabled) window.parent.postMessage({ protocol: DESKTOP_PROTOCOL, windowId, type, payload, requestId }, origin);
  }
  function announce() { send('ready', { appId: options.appId }); send('title-change', { title }); send('dirty-change', { dirty, busy }); if (registeredDialogs) send('register-dialogs', { dialogs }); }
  function focus() { send('focus'); }
  async function message(event: MessageEvent) {
    if (!enabled || event.origin !== origin || event.source !== window.parent || !isDesktopMessage(event.data) || event.data.windowId !== windowId) return;
    const { type, requestId, payload = {} } = event.data;
    if (type === 'hello') announce();
    else if (type === 'request-close' && requestId) {
      if (closing) { send('close-result', { allow: false }, requestId); return; }
      closing = true;
      try { send('close-result', { allow: options.onClose ? await options.onClose() : !dirty && !busy }, requestId); }
      catch { send('close-result', { allow: false }, requestId); }
      finally { closing = false; }
    } else if (type === 'navigate' && typeof payload.path === 'string') { try { await options.onNavigate?.(safeAppPath(payload.path)); } catch { send('notification', { text: '页面切换未完成，当前窗口已保留。' }); } }
    else if (type === 'visibility-change' && typeof payload.visible === 'boolean') options.onVisibility?.(payload.visible);
    else if (type === 'theme-change' && (payload.theme === 'light' || payload.theme === 'dark')) options.onTheme?.(payload.theme);
    else if (type === 'dialog-context' && typeof payload.dialogId === 'string' && payload.dialogId === query.get('platformDialog') && isDialogParams(payload.params)) {
      if (!context) { context = { dialogId: payload.dialogId, params: JSON.parse(JSON.stringify(payload.params)) }; contextWaiters.forEach(waiter => { clearTimeout(waiter.timer); waiter.resolve(context!); }); contextWaiters.clear(); }
    } else if (type === 'dialog-result' && requestId && isDialogResult(payload)) { pendingDialogs.get(requestId)?.(payload); pendingDialogs.delete(requestId); }
  }
  function keyboard(event: KeyboardEvent) { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); send('search'); } }
  if (enabled) { window.addEventListener('message', message); window.addEventListener('pointerdown', focus, true); window.addEventListener('focusin', focus); window.addEventListener('keydown', keyboard); announce(); }
  return {
    enabled,
    setTitle(value: string) { title = value.slice(0, 120); send('title-change', { title }); },
    setState(state: { dirty: boolean; busy?: boolean }) { dirty = state.dirty; busy = !!state.busy; send('dirty-change', { dirty, busy }); },
    routeChanged(path: string) { send('route-change', { path: safeAppPath(path) }); },
    authRequired() { send('auth-required'); },
    setAppearance(value: { backgroundColor: string; backgroundImage: string; color: string }) { send('appearance-change', value); },
    openApplication(appId: string, path?: string) { send('open-application', { appId, ...(path ? { path: safeAppPath(path) } : {}) }); },
    notify(text: string) { send('notification', { text: text.slice(0, 200) }); },
    preferencesChanged() { send('preferences-change'); },
    applicationsChanged() { send('applications-change'); },
    registerDialogs(value: DesktopDialogDefinition[]) { dialogs = validateDialogDefinitions(value); registeredDialogs = true; send('register-dialogs', { dialogs }); },
    openDialog(dialogId: string, params: Record<string, unknown> = {}): Promise<DesktopDialogResult> {
      if (!enabled || !dialogs.some(item => item.id === dialogId)) return Promise.resolve({ outcome: 'cancelled' });
      if (!isDialogParams(params)) return Promise.reject(new Error('弹窗参数必须是 16KiB 以内、深度不超过 8 层的 JSON 对象'));
      if (pendingDialogs.size >= 16) return Promise.reject(new Error('同时打开的弹窗过多，请先完成已有操作'));
      const requestId = crypto.randomUUID();
      return new Promise(resolve => { pendingDialogs.set(requestId, resolve); send('open-dialog', { dialogId, params: JSON.parse(JSON.stringify(params)) }, requestId); });
    },
    waitForDialogContext(): Promise<DesktopDialogContext> {
      if (context) return Promise.resolve(context);
      if (!enabled || !query.get('platformDialog')) return Promise.reject(new Error('当前页面不是桌面注册弹窗'));
      return new Promise((resolve, reject) => { const waiter = { resolve, reject, timer: setTimeout(() => { contextWaiters.delete(waiter); reject(new Error('桌面未提供弹窗上下文，请关闭后重试')); }, 15000) }; contextWaiters.add(waiter); });
    },
    completeDialog(value?: unknown) { if (value !== undefined && !isDialogData(value)) throw new Error('弹窗返回结果超过允许的数据范围'); send('dialog-complete', value === undefined ? {} : { value: JSON.parse(JSON.stringify(value)) }); },
    cancelDialog() { send('dialog-cancel'); },
    requestLogout() { send('request-logout'); },
    dispose() { pendingDialogs.forEach(resolve => resolve({ outcome: 'cancelled' })); pendingDialogs.clear(); contextWaiters.forEach(waiter => { clearTimeout(waiter.timer); waiter.reject(new Error('弹窗已关闭')); }); contextWaiters.clear(); window.removeEventListener('message', message); window.removeEventListener('pointerdown', focus, true); window.removeEventListener('focusin', focus); window.removeEventListener('keydown', keyboard); },
  };
}

