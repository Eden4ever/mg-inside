<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { Search, Bell, Close, ArrowLeft, ArrowRight, Refresh } from '@element-plus/icons-vue';
import { DESKTOP_PROTOCOL, isDesktopMessage, safeAppPath, appAllowsPath, validateDialogDefinitions, isDialogParams, isDialogData, type DesktopDialogDefinition, type DesktopDialogResult, type DesktopApp, type DesktopSession, type DesktopWindow, type WindowMode, type Rect } from '../../../../mg-platform/packages/frontend/desktop-contracts/src/index';
import { useWindows } from './windows/store';
import AppIcon from './AppIcon.vue';
import DesktopFiles from './DesktopFiles.vue';
import enterpriseLogo from '../../../../mg-platform/packages/frontend/assets/enterprise-logo.svg';

const store = useWindows();
const session = ref<DesktopSession | null>(null), loading = ref(true), error = ref('');
const avatarFailed = ref(false);
const avatarUrl = computed(() => { try { const url = new URL(session.value?.user.avatarUrl || ''); return url.protocol === 'https:' ? url.href : ''; } catch { return ''; } });
watch(() => [session.value?.user.id, avatarUrl.value], () => { avatarFailed.value = false; });
const workArea = ref<HTMLElement>(), searchInput = ref<HTMLInputElement>();
const panel = ref<'' | 'launcher' | 'search' | 'system' | 'application' | 'windows'>('');
const isTopMenu = computed(() => ['system', 'application', 'windows'].includes(panel.value));
function hoverMenu(value: 'system' | 'application' | 'windows') { if (isTopMenu.value) panel.value = value; }
function showDesktop() { store.windows.forEach(minimize); panel.value = ''; }
function closeActive() { panel.value = ''; if (active.value) void closeWindow(active.value); }
function minimizeActive() { if (active.value) minimize(active.value); panel.value = ''; }
const query = ref(''), now = ref(new Date()), dragging = ref(false), logoutPending = ref(false);
const fullscreen = ref(!!document.fullscreenElement);
function fullscreenChanged() { fullscreen.value = !!document.fullscreenElement; }
async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch { notice('当前浏览器暂不支持全屏，请使用浏览器的全屏功能。'); }
  fullscreenChanged();
}
const prefs = reactive({ theme: 'system', wallpaper: 'dawn', wallpaperVersion: '', restore: true, pinned: [] as string[], applicationOrder: [] as string[] });
// 自定义壁纸带版本号取用户自己的图片，版本变化才回源，其余情况走浏览器长缓存。
const wallpaperStyle = computed(() => prefs.wallpaper === 'custom' && prefs.wallpaperVersion
  ? { '--wallpaper': `url("/api/preferences/wallpaper?v=${encodeURIComponent(prefs.wallpaperVersion)}")` } : undefined);
const notices = ref<Array<{ id: string; text: string; appId: string; read: boolean }>>([]);
let notificationTimer: ReturnType<typeof setInterval> | undefined;
async function refreshNotifications() {
  if (!session.value) return;
  try { const data = await api<{ items: typeof notices.value }>('/api/notifications'); notices.value = data.items; } catch { /* 网络恢复后重试，避免递归生成通知。 */ }
}
const closeWaiters = new Map<string, { resolve: (allow: boolean) => void; timer: ReturnType<typeof setTimeout>; windowId: string }>();
const closePrompt = ref<{ windowId: string; resolve: (allow: boolean) => void; delegated: boolean; message: string } | null>(null);
const frameTimers = new Map<string, ReturnType<typeof setTimeout>>();
const dialogDefinitions = new Map<string, DesktopDialogDefinition[]>();
const apps = computed(() => {
  const items = session.value?.apps || [], order = Array.isArray(prefs.applicationOrder) ? prefs.applicationOrder : [];
  return [...items].sort((a, b) => { const left = order.indexOf(a.id), right = order.indexOf(b.id); return (left < 0 ? order.length : left) - (right < 0 ? order.length : right); });
});
const desktopName = computed(() => session.value?.desktop?.name || '桌面');
const filesApp = computed(() => apps.value.find(app => app.id === 'files'));
const desktopFiles = ref<InstanceType<typeof DesktopFiles>>();
const trashCount = ref(0);
const desktopContext = ref<{ x: number; y: number; item?: { id: string; name: string; kind: 'file' | 'folder'; version?: number } }>();
function openDesktopFile(path: string) { if (filesApp.value) openApp(filesApp.value, path); }
function showDesktopContext(event: MouseEvent, item?: { id: string; name: string; kind: 'file' | 'folder'; version?: number }) {
  event.preventDefault(); panel.value = ''; appMenu.value = null;
  desktopContext.value = { x: Math.max(4, Math.min(event.clientX, innerWidth - 224)), y: Math.max(4, Math.min(event.clientY, innerHeight - 285)), item };
}
async function desktopAction(action: string) {
  const item = desktopContext.value?.item; desktopContext.value = undefined;
  if (action === 'refresh') { await desktopFiles.value?.refresh(); return; }
  if (action === 'folder') { openDesktopFile('/my-files/desktop'); return; }
  if (action === 'new-folder' || action === 'upload') { openDesktopFile(`/my-files/desktop?intent=${action}`); return; }
  if (!item) return;
  if (action === 'open') { openDesktopFile(item.kind === 'folder' ? `/my-files/${encodeURIComponent(item.id)}` : `/my-files?open=${encodeURIComponent(item.id)}`); return; }
  if (action === 'rename' || action === 'move') { openDesktopFile(`/my-files?open=${encodeURIComponent(item.id)}&intent=${action}`); return; }
  if (action === 'delete') {
    if (!window.confirm(`将「${item.name}」移到回收站？`)) return;
    try { await api(`/api/apps/files/entries/${encodeURIComponent(item.id)}`, { method: 'DELETE', body: JSON.stringify({ version: item.version }) }); await desktopFiles.value?.refresh(); }
    catch (error) { notice((error as Error).message, 'files'); }
  }
}
watch(desktopName, name => { document.title = name; }, { immediate: true });
const active = computed(() => store.windows.find(w => w.id === store.activeId));
const dockApps = computed(() => [...new Set([...prefs.pinned, ...store.windows.map(w => w.appId)])].filter(id => id !== 'files').map(id => apps.value.find(a => a.id === id)).filter((app): app is DesktopApp => !!app));
const draggedApp = ref<{ id: string; fromDock: boolean; fromGrid?: boolean } | null>(null);
const dragPosition = ref<{ x: number; y: number } | null>(null), gridDropBefore = ref<string | null>(null), gridDragOver = ref(false);
const dragApplication = computed(() => apps.value.find(app => app.id === draggedApp.value?.id));
let suppressAppClickUntil = 0, cancelAppPointerDrag: (() => void) | undefined;
const dockDropBefore = ref<string | null>(null), dockDragOver = ref(false);
const appMenu = ref<{ id: string; x: number; y: number } | null>(null);
const dragHint = computed(() => !draggedApp.value ? '' : dockDragOver.value ? '松开以固定到 Dock' : gridDragOver.value ? '松开以调整应用顺序' : draggedApp.value.fromDock ? '松开以从 Dock 移除' : '拖到 Dock 可固定应用');
function endAppDrag() { draggedApp.value = null; dragPosition.value = null; dockDragOver.value = false; dockDropBefore.value = null; gridDragOver.value = false; gridDropBefore.value = null; }
function beginPointerDrag(event: PointerEvent, app: DesktopApp, source: 'grid' | 'dock') {
  if (app.id === 'files') return;
  if (event.button !== 0 || !event.isPrimary) return;
  cancelAppPointerDrag?.();
  const handle = event.currentTarget as HTMLElement, startX = event.clientX, startY = event.clientY;
  let started = false;
  handle.setPointerCapture(event.pointerId);
  function targetAt(x: number, y: number) {
    dragPosition.value = { x, y }; dockDragOver.value = false; gridDragOver.value = false; dockDropBefore.value = null; gridDropBefore.value = null;
    const dock = document.querySelector<HTMLElement>('.dock'), box = dock?.getBoundingClientRect();
    if (box && x >= box.left - 16 && x <= box.right + 16 && y >= box.top - 16 && y <= box.bottom + 16) {
      dockDragOver.value = true;
      const buttons = [...dock!.querySelectorAll<HTMLElement>('[data-app-id]')];
      dockDropBefore.value = buttons.find(button => x < button.getBoundingClientRect().left + button.getBoundingClientRect().width / 2)?.dataset.appId || null; return;
    }
    const grid = document.querySelector<HTMLElement>('.application-grid'), gridBox = grid?.getBoundingClientRect();
    if (source === 'grid' && gridBox && x >= gridBox.left && x <= gridBox.right && y >= gridBox.top && y <= gridBox.bottom) {
      gridDragOver.value = true;
      const buttons = [...grid!.querySelectorAll<HTMLElement>('.grid-app-launch')];
      const next = buttons.find(button => { const rect = button.getBoundingClientRect(); return y < rect.top || y <= rect.bottom && x < rect.left + rect.width / 2; });
      gridDropBefore.value = next?.dataset.appId || null;
    }
  }
  function move(e: PointerEvent) {
    if (!started && Math.hypot(e.clientX - startX, e.clientY - startY) < 7) return;
    e.preventDefault();
    if (!started) { started = true; appMenu.value = null; draggedApp.value = { id: app.id, fromDock: source === 'dock', fromGrid: source === 'grid' }; }
    targetAt(e.clientX, e.clientY);
  }
  function finish(e?: PointerEvent) {
    handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', finish); handle.removeEventListener('pointercancel', cancel);
    window.removeEventListener('blur', cancel); cancelAppPointerDrag = undefined;
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    if (started) {
      suppressAppClickUntil = Date.now() + 350;
      if (e) {
        targetAt(e.clientX, e.clientY);
        if (dockDragOver.value) dropOnDock();
        else if (gridDragOver.value) {
          const order = apps.value.map(app => app.id).filter(id => id !== app.id), before = gridDropBefore.value;
          if (before !== app.id) { const at = before ? order.indexOf(before) : order.length; order.splice(at < 0 ? order.length : at, 0, app.id); prefs.applicationOrder = order; }
        } else if (source === 'dock') prefs.pinned = prefs.pinned.filter(id => id !== app.id);
      }
    }
    endAppDrag();
  }
  function cancel() { finish(); }
  cancelAppPointerDrag = cancel;
  handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', finish); handle.addEventListener('pointercancel', cancel); window.addEventListener('blur', cancel);
}
function dropOnDock() {
  if (!draggedApp.value) return;
  const id = draggedApp.value.id;
  if (!apps.value.some(app => app.id === id)) { endAppDrag(); return; }
  if (dockDropBefore.value !== id) {
    const pins = prefs.pinned.filter(value => value !== id && apps.value.some(app => app.id === value));
    const before = dockDropBefore.value;
    const at = before && pins.includes(before) ? pins.indexOf(before) : pins.length;
    pins.splice(at, 0, id); prefs.pinned = pins;
  } else if (!prefs.pinned.includes(id)) prefs.pinned = [...prefs.pinned, id];
  panel.value = ''; endAppDrag();
}
function showAppMenu(event: MouseEvent, app: DesktopApp) {
  event.preventDefault(); event.stopPropagation();
  if (app.id === 'files') return;
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const x = event.clientX || box.x, y = event.clientY || box.y;
  appMenu.value = { id: app.id, x: Math.max(8, Math.min(x, innerWidth - 210)), y: Math.max(8, Math.min(y, innerHeight - 190)) };
}
function movePinned(id: string, delta: number) {
  if (id === 'files') return;
  const pins = [...prefs.pinned], index = pins.indexOf(id), next = index + delta;
  if (index < 0 || next < 0 || next >= pins.length) return;
  [pins[index], pins[next]] = [pins[next]!, pins[index]!]; prefs.pinned = pins;
}
const filteredApps = computed(() => apps.value.filter(a => a.id !== 'files' && `${a.name} ${a.description}`.toLowerCase().includes(query.value.trim().toLowerCase())));
const themeMedia = window.matchMedia('(prefers-color-scheme: dark)');
const systemDark = ref(themeMedia.matches);
const dark = computed(() => prefs.theme === 'dark' || prefs.theme === 'system' && systemDark.value);
const clock = computed(() => now.value.toLocaleString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' }));
const layoutKey = computed(() => session.value ? `mg-desktop-layout:${session.value.user.id}` : '');
let observer: ResizeObserver | undefined, clockTimer: ReturnType<typeof setInterval> | undefined, sessionTimer: ReturnType<typeof setInterval> | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let preferencesRequest: Promise<void> | undefined, readingPreferences = false;
let preferencesPending = false, preferencesSaving = false, preferencesVersion = 0;
const preferencesKey = () => `mg-desktop-preferences:${session.value?.user.id || ''}`;
function cachePreferences() { try { localStorage.setItem(preferencesKey(), JSON.stringify({ value: prefs, pending: preferencesPending })); } catch {} }
async function syncPreferences() {
  if (!session.value || !preferencesPending || preferencesSaving || !navigator.onLine) return;
  const version = preferencesVersion; preferencesSaving = true;
  try {
    await api('/api/preferences', { method: 'PUT', body: JSON.stringify(prefs) });
    if (version === preferencesVersion) { preferencesPending = false; cachePreferences(); }
  } catch { /* 本地偏好已保存，联网后重试，不阻塞桌面操作。 */ }
  finally { preferencesSaving = false; if (preferencesPending && version !== preferencesVersion) void syncPreferences(); }
}
function online() { void syncPreferences(); void refreshNotifications(); refreshPreferences(); }
function refreshPreferences() {
  if (!session.value || loading.value || preferencesRequest) return;
  if (preferencesPending) { void syncPreferences(); return; }
  preferencesRequest = (async () => {
    try { const value = await api<Record<string, unknown>>('/api/preferences'); if (!preferencesPending) { readingPreferences = true; Object.assign(prefs, value); cachePreferences(); } }
    catch { /* 读取失败时继续使用本地偏好。 */ }
    finally { readingPreferences = false; preferencesRequest = undefined; }
  })();
}
function documentVisible() { if (document.visibilityState === 'visible') refreshPreferences(); }

function appFor(win: DesktopWindow) { return apps.value.find(a => a.id === win.appId)!; }
function windowName(win: DesktopWindow) { return win.dialog ? win.title : appFor(win)?.name; }
function frame(win: DesktopWindow) { return document.getElementById(`frame-${win.id}`) as HTMLIFrameElement | null; }
function frameName(win: DesktopWindow) { return appFor(win)?.kind === 'external' ? '' : `${DESKTOP_PROTOCOL}|${location.origin}|${win.id}`; }
function openInBrowser(win: DesktopWindow) {
  const app = appFor(win);
  if (!app) return;
  if (app.kind === 'external') { window.open(app.entryUrl, '_blank', 'noopener,noreferrer'); return; }
  const path = safeAppPath(win.path, app.defaultPath);
  const target = new URL(app.entryUrl.replace(/\/$/, '') + (appAllowsPath(app, path) ? path : app.defaultPath));
  window.open(target.href, '_blank', 'noopener,noreferrer');
}
// 初始 URL 固定到该窗口，内部路由变化不会重新挂载 iframe。
const frameUrls = reactive<Record<string, string>>({});
function initialUrl(win: DesktopWindow) {
  if (!frameUrls[win.id]) {
    if (appFor(win)?.kind === 'external') return frameUrls[win.id] = appFor(win).entryUrl;
    const app = appFor(win), base = app.entryUrl.replace(/\/$/, ''), url = new URL(base + win.path);
    url.searchParams.set('embed', 'desktop'); url.searchParams.set('desktopOrigin', location.origin); url.searchParams.set('desktopWindow', win.id);
    if (win.dialog) url.searchParams.set('platformDialog', win.dialog.dialogId);
    frameUrls[win.id] = url.href;
  }
  return frameUrls[win.id]!;
}
function send(win: DesktopWindow, type: string, payload?: Record<string, unknown>, requestId?: string) {
  if (!appFor(win) || appFor(win).kind === 'external') return;
  frame(win)?.contentWindow?.postMessage({ protocol: DESKTOP_PROTOCOL, windowId: win.id, type, payload, requestId }, new URL(appFor(win).entryUrl).origin);
}
function notice(text: string, appId = '') {
  notices.value.unshift({ id: crypto.randomUUID(), text, appId, read: false });
  notices.value = notices.value.slice(0, 100);
  if (session.value) void api<{ items: typeof notices.value }>('/api/notifications', { method: 'POST', body: JSON.stringify({ text: text.slice(0, 500), appId }) }).then(data => { notices.value = data.items; }).catch(() => {});
}
function showPanel(value: typeof panel.value) { panel.value = panel.value === value ? '' : value; query.value = ''; if (value === 'search' || value === 'launcher') setTimeout(() => searchInput.value?.focus(), 0); if (isTopMenu.value) setTimeout(() => document.querySelector<HTMLButtonElement>('.top-menu-panel button')?.focus(), 0); }
function openApp(app: DesktopApp, path?: string) {
  if (Date.now() < suppressAppClickUntil) return;
  appMenu.value = null;
  if (app.launchMode === 'tab') {
    window.open(app.entryUrl.replace(/\/$/, '') + (path && appAllowsPath(app, path) ? path : app.defaultPath), '_blank', 'noopener,noreferrer');
    panel.value = ''; return;
  }
  const existing = store.windows.find(w => w.appId === app.id && !w.dialog);
  const win = store.open(app, path);
  if (existing && path && appAllowsPath(app, path)) send(win, 'navigate', { path: safeAppPath(path) });
  send(win, 'visibility-change', { visible: true }); panel.value = '';
}
function openAccount(path = '/profile') { const app = apps.value.find(a => a.id === 'personal-center'); if (app) openApp(app, path); }
function frameLoaded(win: DesktopWindow) {
  if (appFor(win)?.kind === 'external') { win.ready = true; win.error = ''; return; }
  send(win, 'hello'); clearTimeout(frameTimers.get(win.id));
  if (!win.ready) frameTimers.set(win.id, setTimeout(() => { if (!win.ready) win.error = '应用尚未完成桌面接入，或服务暂时不可用。'; }, 12000));
}
function focus(win: DesktopWindow) { store.focus(win.id); send(win, 'visibility-change', { visible: true }); }
function minimize(win: DesktopWindow) { store.minimize(win.id); send(win, 'visibility-change', { visible: false }); }
function mode(win: DesktopWindow, next: WindowMode) { store.setMode(win.id, next); }
function maximize(win: DesktopWindow) { mode(win, win.mode === 'maximized' ? 'normal' : 'maximized'); }
function rectStyle(win: DesktopWindow) { const r = store.displayRect(win); const look = win.appearance; return { left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px`, zIndex: store.order.indexOf(win.id) + 1,
  backgroundColor: `color-mix(in srgb, ${look?.backgroundColor || '#fff'} 65%, transparent)`, backgroundImage: 'none', color: look?.color || '#303133', '--window-ink': look?.color || '#303133' }; }
async function requestAppClose(win: DesktopWindow): Promise<boolean> {
  if (!win.ready) return false;
  if ([...closeWaiters.values()].some(w => w.windowId === win.id)) return false;
  const requestId = crypto.randomUUID();
  return new Promise(resolve => {
    const timer = setTimeout(() => { closeWaiters.delete(requestId); resolve(false); }, 8000);
    closeWaiters.set(requestId, { resolve, timer, windowId: win.id }); send(win, 'request-close', undefined, requestId);
  });
}
function mayClose(win: DesktopWindow): Promise<boolean> {
  // 窗口操作只读本地桥接状态，不等待网络或未加载应用的握手。
  if (!win.dirty && !win.busy) return Promise.resolve(true);
  if (closePrompt.value) return Promise.resolve(false);
  return new Promise(resolve => { closePrompt.value = { windowId: win.id, resolve, delegated: false,
    message: win.dirty ? '这个窗口有未保存的内容。直接关闭会丢失这些修改。' : '这个窗口有进行中的请求或任务。直接关闭会中断当前页面，已提交的服务器任务可能继续执行。' }; });
}
function cycleCloseFocus(event: KeyboardEvent) { const buttons = [...document.querySelectorAll<HTMLButtonElement>('.close-prompt button')]; const at = buttons.indexOf(document.activeElement as HTMLButtonElement); buttons[(at + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus(); }
watch(() => closePrompt.value && !closePrompt.value.delegated, visible => { if (visible) setTimeout(() => document.querySelector<HTMLButtonElement>('.close-prompt button')?.focus(), 0); });
function finishClose(allow: boolean) { const prompt = closePrompt.value; closePrompt.value = null; prompt?.resolve(allow); }
async function handleCloseInApp() {
  const prompt = closePrompt.value, win = store.windows.find(item => item.id === prompt?.windowId);
  if (!prompt || !win) { finishClose(false); return; }
  prompt.delegated = true;
  if (await requestAppClose(win)) { if (closePrompt.value === prompt) finishClose(true); }
  else if (closePrompt.value === prompt) { prompt.delegated = false; prompt.message = '应用未完成关闭处理，窗口与内容仍保留。你可以继续编辑，或直接关闭。'; }
}
function remove(win: DesktopWindow, result: DesktopDialogResult = { outcome: 'cancelled' }) {
  for (const child of [...store.windows].filter(child => child.dialog?.parentWindowId === win.id)) remove(child);
  if (win.dialog) { const parent = store.windows.find(parent => parent.id === win.dialog!.parentWindowId); if (parent) send(parent, 'dialog-result', result as unknown as Record<string, unknown>, win.dialog.requestId); }
  dialogDefinitions.delete(win.id);
  for (const [id, waiter] of closeWaiters) if (waiter.windowId === win.id) { clearTimeout(waiter.timer); closeWaiters.delete(id); waiter.resolve(false); }
  clearTimeout(frameTimers.get(win.id)); frameTimers.delete(win.id); delete frameUrls[win.id]; store.remove(win.id);
}
async function mayCloseFamily(win: DesktopWindow): Promise<boolean> {
  for (const child of [...store.windows].filter(child => child.dialog?.parentWindowId === win.id)) if (!await mayCloseFamily(child)) return false;
  return mayClose(win);
}
async function closeWindow(win: DesktopWindow) { if (closePrompt.value?.windowId === win.id) { closePrompt.value.delegated = false; return; } if (await mayCloseFamily(win)) remove(win); }
function forceClose(win: DesktopWindow) { if (window.confirm('强制关闭会丢失这个窗口内未保存的内容，确定继续吗？')) remove(win); }
async function retryWindow(win: DesktopWindow) {
  if ((win.dirty || win.busy) && !await mayClose(win)) return;
  win.ready = false; win.error = ''; delete frameUrls[win.id];
  const el = frame(win); if (el) el.src = initialUrl(win);
}
function startPointer(event: PointerEvent, win: DesktopWindow, edge = '') {
  if (event.button !== 0 || (!edge && (event.target as Element).closest('button')) || store.area.width < 1024) return;
  event.preventDefault(); focus(win); dragging.value = true;
  const handle = event.currentTarget as HTMLElement, start = { ...store.displayRect(win) }, x = event.clientX, y = event.clientY;
  handle.setPointerCapture(event.pointerId);
  function move(e: PointerEvent) {
    const dx = e.clientX - x, dy = e.clientY - y;
    if (Math.abs(dx) + Math.abs(dy) < 3) return;
    const r: Rect = { ...start };
    if (!edge) { r.x += dx; r.y += dy; }
    else { if (edge.includes('e')) r.width += dx; if (edge.includes('s')) r.height += dy;
      if (edge.includes('w')) { r.x += dx; r.width -= dx; } if (edge.includes('n')) { r.y += dy; r.height -= dy; } }
    store.move(win.id, r, appFor(win));
  }
  function end() { dragging.value = false; handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', end); handle.removeEventListener('pointercancel', end);
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId); }
  handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
}
function resizeKey(event: KeyboardEvent, win: DesktopWindow) {
  const diff: Record<string, [number, number]> = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] };
  const delta = diff[event.key]; if (!delta) return; event.preventDefault();
  const rect = store.displayRect(win);
  store.move(win.id, { ...rect, width: rect.width + delta[0], height: rect.height + delta[1] }, appFor(win));
}
function receive(event: MessageEvent) {
  if (!isDesktopMessage(event.data)) return;
  const win = store.windows.find(w => w.id === event.data.windowId); if (!win) return;
  const app = appFor(win); if (!app || app.kind === 'external' || event.origin !== new URL(app.entryUrl).origin || event.source !== frame(win)?.contentWindow) return;
  const { type, payload = {}, requestId } = event.data;
  if (type === 'ready' && payload.appId === app.id) { win.ready = true; win.error = ''; clearTimeout(frameTimers.get(win.id)); send(win, 'theme-change', { theme: dark.value ? 'dark' : 'light' }); send(win, 'visibility-change', { visible: !win.minimized }); if (win.dialog) send(win, 'dialog-context', { dialogId: win.dialog.dialogId, params: JSON.parse(JSON.stringify(win.dialog.params)) }); }
  else if (type === 'register-dialogs') {
    try { const definitions = validateDialogDefinitions(payload.dialogs); if (definitions.every(definition => appAllowsPath(app, definition.path))) dialogDefinitions.set(win.id, definitions); } catch { /* 不接受越界注册或非法配置。 */ }
  }
  else if (type === 'open-dialog' && requestId && /^[A-Za-z0-9_-]{1,100}$/.test(requestId)) {
    const definition = dialogDefinitions.get(win.id)?.find(item => item.id === payload.dialogId);
    const existing = store.windows.find(child => child.dialog?.parentWindowId === win.id && child.dialog.requestId === requestId);
    if (existing) { focus(existing); return; }
    if (!definition || !isDialogParams(payload.params) || store.windows.filter(win => win.dialog).length >= 12) {
      send(win, 'dialog-result', { outcome: 'cancelled', message: '弹窗未注册、参数无效或已达到窗口数量限制' }, requestId); return;
    }
    store.openDialog(win, definition, requestId, JSON.parse(JSON.stringify(payload.params)));
  }
  else if (type === 'dialog-complete' && win.dialog && (payload.value === undefined || isDialogData(payload.value))) remove(win, { outcome: 'completed', ...(payload.value === undefined ? {} : { value: payload.value }) });
  else if (type === 'dialog-cancel' && win.dialog) remove(win, { outcome: 'cancelled' });
  else if (type === 'focus') store.focus(win.id);
  else if (type === 'search') showPanel('search');
  else if (type === 'preferences-change') refreshPreferences();
  else if (type === 'applications-change' && app.id === 'app-manager') void checkSession();
  else if (type === 'request-logout' && app.id === 'personal-center') void logout();
  else if (type === 'appearance-change') {
    const { backgroundColor, backgroundImage, color } = payload;
    if (typeof backgroundColor === 'string' && typeof color === 'string' && typeof backgroundImage === 'string' && backgroundImage.length < 8192
      && !/url|image-set|var\(|[;{}<>]/i.test(backgroundImage) && CSS.supports('background-image', backgroundImage)
      && /^(rgba?|color|oklch|oklab|lab|lch)\([^;{}<>]+\)$|^#[\da-f]{3,8}$/i.test(backgroundColor)
      && /^(rgba?|color|oklch|oklab|lab|lch)\([^;{}<>]+\)$|^#[\da-f]{3,8}$/i.test(color)) win.appearance = { backgroundColor, backgroundImage, color };
  }
  else if (type === 'open-application' && typeof payload.appId === 'string') { const target = apps.value.find(a => a.id === payload.appId); if (target && (!payload.path || typeof payload.path === 'string' && appAllowsPath(target, payload.path))) openApp(target, typeof payload.path === 'string' ? payload.path : undefined); }
  else if (type === 'title-change' && typeof payload.title === 'string') win.title = payload.title.slice(0, 120) || app.name;
  else if (type === 'dirty-change' && typeof payload.dirty === 'boolean') { win.dirty = payload.dirty; win.busy = payload.busy === true; }
  else if (type === 'route-change' && typeof payload.path === 'string' && appAllowsPath(app, payload.path)) win.path = safeAppPath(payload.path);
  else if (type === 'close-result' && requestId) { const waiter = closeWaiters.get(requestId); if (waiter?.windowId === win.id) { clearTimeout(waiter.timer); closeWaiters.delete(requestId); waiter.resolve(payload.allow === true); } }
  // 子窗口认证失败时只显示可操作错误，避免失败接口触发会话检查和子窗口重载循环。
  else if (type === 'auth-required') { win.error = '登录或应用访问授权已失效，请点击“重试”重新认证。'; }
  else if (type === 'notification' && typeof payload.text === 'string') notice(payload.text.slice(0, 200), app.id);
}
async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const accountId = session.value?.user.id;
  const response = await fetch(path, { ...options, signal: options.signal || AbortSignal.timeout(8000), credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.value?.csrfToken || '', ...(path === '/api/preferences' && accountId ? { 'X-Desktop-Account': accountId } : {}), ...options.headers } });
  if (response.status === 401) throw Object.assign(new Error('登录已失效'), { status: 401 });
  const data = await response.json();
  if (data.code === 'ACCOUNT_CHANGED' || accountId && accountId !== session.value?.user.id) {
    reloadForAccountChange(); throw new Error('账户已切换，正在重新加载个人数据');
  }
  if (!response.ok) throw new Error(data.message || '请求未完成'); return data;
}
function login() { const requested = new URL(location.href), target = new URL('/auth/start', location.origin); const app = requested.searchParams.get('app') || active.value?.appId; if (app) { target.searchParams.set('app', app); target.searchParams.set('path', safeAppPath(requested.searchParams.get('path') || active.value?.path)); } location.assign(target.href); }
function reloadPage() { location.reload(); }
function reloadForAccountChange() {
  // 保留旧账户的本地偏好；新页面只读取新账户的数据。
  loading.value = true; preferencesPending = false; clearTimeout(saveTimer);
  location.reload();
}
async function checkSession() {
  try {
    const fresh = await api<DesktopSession>('/api/session');
    if (session.value && fresh.user.id !== session.value.user.id) { reloadForAccountChange(); return; }
    const previousApps = session.value?.apps || [];
    session.value = fresh;
    for (const win of [...store.windows]) {
      const app = fresh.apps.find(a => a.id === win.appId), previous = previousApps.find(a => a.id === win.appId);
      if (!app) { notice('应用已移除或访问授权已撤销'); remove(win); }
      else {
        if (win.title === previous?.name || app.kind === 'external') win.title = app.name;
        if (previous && previous.entryUrl !== app.entryUrl) { delete frameUrls[win.id]; win.ready = false; }
      }
    }
    prefs.pinned = prefs.pinned.filter(id => fresh.apps.some(app => app.id === id));
  } catch (e) { if ((e as { status?: number }).status === 401) { error.value = '登录已失效，请通过统一认证重新登录。'; } else notice((e as Error).message); }
}
async function logout() {
  if (logoutPending.value) return; logoutPending.value = true;
  try {
    for (const win of store.windows) if (!await mayClose(win)) return;
    await api('/auth/logout', { method: 'POST', body: '{}' }); localStorage.removeItem(layoutKey.value); store.reset(); session.value = null; notices.value = []; login();
  } catch (e) { notice((e as Error).message); window.alert('退出登录未完成：' + (e as Error).message); } finally { logoutPending.value = false; }
}
function togglePin(id: string) { if (id !== 'files') prefs.pinned = prefs.pinned.includes(id) ? prefs.pinned.filter(p => p !== id) : [...prefs.pinned, id]; }
function beforeUnload(event: BeforeUnloadEvent) { if (store.windows.some(w => w.dirty || w.busy)) { event.preventDefault(); event.returnValue = ''; } }
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') desktopContext.value = undefined;
  if (event.key === 'Escape' && cancelAppPointerDrag) { event.preventDefault(); cancelAppPointerDrag(); return; }
  if (isTopMenu.value && ['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
    event.preventDefault(); const buttons = [...document.querySelectorAll<HTMLButtonElement>('.top-menu-panel button:not(:disabled)')];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (at + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
    buttons[next]?.focus(); return;
  }
  if (isTopMenu.value && ['ArrowLeft','ArrowRight'].includes(event.key)) {
    event.preventDefault(); const menus = ['system','application','windows'] as const; const index = menus.indexOf(panel.value as typeof menus[number]);
    panel.value = menus[(index + (event.key === 'ArrowLeft' ? -1 : 1) + menus.length) % menus.length]!;
    void nextTick(() => document.querySelector<HTMLButtonElement>('.top-menu-panel button')?.focus()); return;
  }
  if (event.key === 'Escape' && isTopMenu.value) document.querySelector<HTMLButtonElement>('.menu-bar button[aria-expanded="true"]')?.focus();
 if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); showPanel('search'); } if (event.key === 'Escape') { panel.value = ''; appMenu.value = null; if (closePrompt.value && !closePrompt.value.delegated) finishClose(false); } }
function mediaChanged() { systemDark.value = themeMedia.matches; }
watch(dark, () => store.windows.forEach(win => send(win, 'theme-change', { theme: dark.value ? 'dark' : 'light' })));
watch(() => store.snapshot(), value => { if (layoutKey.value && prefs.restore) { try { localStorage.setItem(layoutKey.value, JSON.stringify(value)); } catch {} } }, { deep: true });
watch(prefs, () => { if (!session.value || loading.value || readingPreferences) return; preferencesPending = true; preferencesVersion++; cachePreferences(); clearTimeout(saveTimer); saveTimer = setTimeout(() => { void syncPreferences(); }, 400); }, { deep: true, flush: 'sync' });
watch(() => prefs.restore, value => { if (!value && layoutKey.value) localStorage.removeItem(layoutKey.value); });
onMounted(async () => {
  document.addEventListener('fullscreenchange', fullscreenChanged);
  window.addEventListener('online', online);
  window.addEventListener('focus', refreshPreferences); document.addEventListener('visibilitychange', documentVisible);
  window.addEventListener('message', receive); window.addEventListener('beforeunload', beforeUnload); window.addEventListener('keydown', keydown); themeMedia.addEventListener('change', mediaChanged);
  clockTimer = setInterval(() => now.value = new Date(), 1000);
  try {
    session.value = await api<DesktopSession>('/api/session');
    void refreshNotifications(); notificationTimer = setInterval(() => { if (document.visibilityState === 'visible') void refreshNotifications(); }, 15000);
    Object.assign(prefs, { pinned: apps.value.map(a => a.id) });
    try { const cached = JSON.parse(localStorage.getItem(preferencesKey()) || 'null'); if (cached?.value) { Object.assign(prefs, cached.value); preferencesPending = cached.pending === true; } } catch {}
    await nextTick();
    if (workArea.value) {
      const bounds = workArea.value.getBoundingClientRect(); store.area = { width: bounds.width, height: bounds.height }; store.dockHeight = document.querySelector('.dock-area')?.getBoundingClientRect().height || 0;
      observer = new ResizeObserver(([entry]) => { if (entry) { store.area = { width: entry.contentRect.width, height: entry.contentRect.height }; store.dockHeight = document.querySelector('.dock-area')?.getBoundingClientRect().height || 0; } }); observer.observe(workArea.value);
    }
    if (prefs.restore) { try { store.restore(JSON.parse(localStorage.getItem(layoutKey.value) || '[]'), apps.value); } catch {} }
    const requested = new URL(location.href), app = apps.value.find(a => a.id === requested.searchParams.get('app'));
    if (app) openApp(app, safeAppPath(requested.searchParams.get('path'), app.defaultPath));
    history.replaceState({}, '', '/');
    sessionTimer = setInterval(() => { void checkSession(); if (session.value && session.value.expiresAt * 1000 - Date.now() < 3600000) void api<{ expiresAt: number }>('/auth/renew', { method: 'POST', body: '{}' }).then(r => { if (session.value) session.value.expiresAt = r.expiresAt; }).catch(e => notice(e.message)); }, 60000);
  } catch (e) { if ((e as { status?: number }).status === 401) login(); else error.value = (e as Error).message; }
  finally { loading.value = false; refreshPreferences(); }
});
onUnmounted(() => { cancelAppPointerDrag?.(); observer?.disconnect(); clearInterval(notificationTimer); clearInterval(clockTimer); clearInterval(sessionTimer); clearTimeout(saveTimer); frameTimers.forEach(clearTimeout);
  document.removeEventListener('fullscreenchange', fullscreenChanged);
  window.removeEventListener('online', online);
  window.removeEventListener('focus', refreshPreferences); document.removeEventListener('visibilitychange', documentVisible);
  closeWaiters.forEach(w => { clearTimeout(w.timer); w.resolve(false); }); window.removeEventListener('message', receive); window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('keydown', keydown); themeMedia.removeEventListener('change', mediaChanged); });
</script>

<template>
  <main class="desktop" :class="[{ dark }, prefs.wallpaper]" :style="wallpaperStyle">
    <header class="menu-bar">
      <button class="brand" aria-label="桌面菜单" aria-haspopup="menu" :aria-expanded="panel === 'system'" @mouseenter="hoverMenu('system')" @click="showPanel('system')"><img :src="enterpriseLogo" alt="元引" draggable="false" /></button>
      <button class="active-app" aria-label="当前应用菜单" aria-haspopup="menu" :aria-expanded="panel === 'application'" @mouseenter="hoverMenu('application')" @click="showPanel('application')">{{ active && !active.minimized ? appFor(active)?.name : desktopName }}</button>
      <button class="menu-text" aria-haspopup="menu" :aria-expanded="panel === 'windows'" @mouseenter="hoverMenu('windows')" @click="showPanel('windows')">窗口</button>
      <div class="menu-spacer"/>
      <button aria-label="搜索应用" @click="showPanel('search')"><Search/></button>
      <button aria-label="通知中心" class="notice-trigger" @click="openAccount('/notifications')"><Bell/><span v-if="notices.some(item => !item.read)" class="notice-dot"/></button>
      <button :aria-label="fullscreen ? '退出全屏' : '进入全屏'" :title="fullscreen ? '退出全屏（Esc）' : '全屏显示桌面'" :aria-pressed="fullscreen" @click="toggleFullscreen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path v-if="!fullscreen" d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"/><path v-else d="M3 9h6V3m6 0v6h6M9 21v-6H3m12 6v-6h6"/></svg></button>
      <span class="clock">{{ clock }}</span>
      <button class="user-menu" aria-label="个人账号" title="个人中心" @click="openAccount()"><img v-if="avatarUrl && !avatarFailed" :src="avatarUrl" alt="" referrerpolicy="no-referrer" @error="avatarFailed = true"/><span v-else>{{ session?.user.name.slice(0, 1) || 'M' }}</span></button>
    </header>
    <div ref="workArea" class="work-area" @pointerdown.self="panel = ''" @contextmenu.self.prevent="showDesktopContext($event)">
      <DesktopFiles v-if="session" ref="desktopFiles" :key="session.user.id" :enabled="!!filesApp" :shortcuts="apps" @open="openDesktopFile" @launch="openApp" @context="showDesktopContext" @shortcut-context="showAppMenu" @trash-count="trashCount = $event" />
      <section v-for="win in store.windows" v-show="!win.minimized" :key="win.id" class="app-window" :class="{ active: active?.id === win.id, busy: win.busy, integrated: appFor(win)?.kind !== 'external' && (win.ready || !!win.appearance), maximized: win.mode === 'maximized' || store.area.width < 1024 }" :style="rectStyle(win)" :aria-label="`${windowName(win)}窗口`" @pointerdown="focus(win)" @focusin="focus(win)">
        <header class="window-title" @pointerdown="startPointer($event, win)" @dblclick="maximize(win)">
          <div class="window-tools">
          <button class="snap-button" aria-label="窗口左侧贴靠" @click.stop="mode(win, 'left')" @dblclick.stop><ArrowLeft/></button><button class="snap-button" aria-label="窗口右侧贴靠" @click.stop="mode(win, 'right')" @dblclick.stop><ArrowRight/></button>
          </div>
          <span class="window-caption">{{ win.dialog ? win.title : appFor(win)?.name }}<span v-if="win.dirty" class="dirty-mark" aria-label="有未保存内容"> ·</span></span>
          <span v-if="win.busy" class="window-state">处理中</span>
          <div class="window-controls">
          <button v-if="!win.dialog" class="browser-button" :aria-label="`在浏览器中打开${appFor(win)?.name}`" title="在浏览器中打开当前页面" @pointerdown.stop @click.stop="openInBrowser(win)" @dblclick.stop><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M10 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
            <button class="window-minimize" :aria-label="`最小化${windowName(win)}`" title="最小化" @click.stop="minimize(win)" @dblclick.stop><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1 6.5h10" /></svg></button>
            <button class="window-maximize" :aria-label="`最大化或还原${windowName(win)}`" :title="win.mode === 'maximized' ? '还原' : '最大化'" @click.stop="maximize(win)" @dblclick.stop><svg v-if="win.mode === 'maximized'" viewBox="0 0 12 12" aria-hidden="true"><path d="M3.5 3V1.5h7v7H9"/><path d="M1.5 3.5h7v7h-7z"/></svg><svg v-else viewBox="0 0 12 12" aria-hidden="true"><path d="M1.5 1.5h9v9h-9z"/></svg></button>
            <button class="window-close" :aria-label="`关闭${windowName(win)}`" title="关闭" @click.stop="closeWindow(win)" @dblclick.stop><svg viewBox="0 0 12 12" aria-hidden="true"><path d="m1.5 1.5 9 9m0-9-9 9"/></svg></button>
          </div>
        </header>
        <iframe :id="`frame-${win.id}`" :name="frameName(win)" :src="initialUrl(win)" :title="windowName(win)" referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-modals allow-forms allow-downloads allow-popups allow-popups-to-escape-sandbox" allow="clipboard-write" @load="frameLoaded(win)"/>
        <div v-if="dragging" class="frame-capture"/>
        <div v-if="win.error" class="window-error" role="alert"><p>{{ win.error }}</p><div><button @click="retryWindow(win)"><Refresh/>重试</button><button @click="forceClose(win)">强制关闭</button></div></div>
        <button v-for="edge in ['n','ne','e','se','s','sw','w','nw']" :key="edge" class="resize-handle" :class="edge" :aria-label="`调整${appFor(win)?.name}窗口大小 ${edge}`" @pointerdown="startPointer($event, win, edge)" @keydown="resizeKey($event, win)"/>
      </section>
    </div>
    <footer v-if="session" class="dock-area" :class="{ 'dock-raised': !!draggedApp || panel === 'launcher' }"><nav class="dock" :style="{ '--dock-items': dockApps.length + 1 + (filesApp ? 2 : 0) }" :class="{ 'drag-over': dockDragOver, 'drop-at-end': dockDragOver && !dockDropBefore }" aria-label="应用 Dock">
      <button v-if="filesApp" class="fixed-files-app" aria-label="打开文件" title="文件" draggable="false" :class="{ running: store.windows.some(w => w.appId === 'files'), selected: active?.appId === 'files' }" @dragstart.prevent @contextmenu.prevent @click="openApp(filesApp)"><AppIcon :app="filesApp"/><span class="dock-name">文件</span><span class="running-dot"/></button>
      <button aria-label="所有应用" @click="showPanel('launcher')"><AppIcon :app="{ id: 'launcher', icon: 'personal' }"/><span class="dock-name">所有应用</span><span class="running-dot"/></button>
      <span class="dock-divider"/>
      <button v-for="app in dockApps" :key="app.id" draggable="false" :data-app-id="app.id" :aria-label="`打开${app.name}`" :class="{ running: store.windows.some(w => w.appId === app.id), selected: active?.appId === app.id, 'drop-before': dockDragOver && dockDropBefore === app.id }" @dragstart.prevent @pointerdown="beginPointerDrag($event, app, 'dock')" @contextmenu="showAppMenu($event, app)" @keydown.shift.f10.prevent="showAppMenu($event as unknown as MouseEvent, app)" @click="openApp(app)"><AppIcon :app="app" /><span class="dock-name">{{ app.name }}</span><span class="running-dot"/></button>
      <span v-if="filesApp" class="dock-divider"/>
      <button v-if="filesApp" class="fixed-trash-app" aria-label="打开回收站" title="回收站" draggable="false" @dragstart.prevent @contextmenu.prevent @click="openApp(filesApp, '/trash')"><AppIcon :app="{ id: trashCount > 0 ? 'trash-full' : 'trash', icon: 'personal' }"/><span class="dock-name">回收站</span></button>
    </nav></footer>
    <div v-if="loading || error" class="session-cover" role="status"><div class="session-card"><span class="brand-mark">M</span><h1>{{ loading ? '正在准备你的桌面' : '桌面暂时未就绪' }}</h1><p>{{ error || '正在检查统一认证状态…' }}</p><button v-if="error" @click="login">前往统一认证</button><button v-if="error" @click="reloadPage">重新加载</button></div></div>
    <div v-if="panel && session" class="panel-backdrop" :class="{ 'launcher-backdrop': panel === 'launcher', 'top-menu-backdrop': isTopMenu }" @click.self="panel = ''">
      <section class="system-panel" :class="[panel, { 'top-menu-panel': isTopMenu }]" :role="isTopMenu ? 'menu' : undefined" aria-label="桌面菜单">
        <header v-if="!isTopMenu"><h2>{{ ({ launcher:'所有应用', search:'搜索应用', system:'桌面', application:'应用', windows:'窗口管理' })[panel] }}</h2><button aria-label="关闭菜单" @click="panel = ''"><Close/></button></header>
        <template v-if="panel === 'system'"><button class="panel-action" role="menuitem" @click="showPanel('launcher')">所有应用</button><button class="panel-action" role="menuitem" @click="showDesktop">显示桌面</button><hr /><button class="panel-action" role="menuitem" @click="openAccount()">个人中心</button></template>
        <template v-if="panel === 'application'"><template v-if="active && !active.minimized"><span class="menu-application-name">{{ appFor(active)?.name }}</span><button class="panel-action" role="menuitem" @click="openInBrowser(active); panel = ''">在浏览器中打开</button><hr /><button class="panel-action" role="menuitem" @click="minimizeActive">最小化</button><button class="panel-action" role="menuitem" @click="closeActive">关闭窗口</button></template><template v-else><button class="panel-action" role="menuitem" @click="showPanel('launcher')">打开应用</button><button class="panel-action" role="menuitem" @click="openAccount()">个人中心</button></template></template>
        <template v-if="panel === 'launcher' || panel === 'search'">
          <label class="search-field"><Search/><input ref="searchInput" v-model="query" placeholder="查找应用" aria-label="查找应用"/></label>
          <div v-if="panel === 'launcher'" class="application-grid" aria-label="所有应用网格">
            <article v-for="app in filteredApps" :key="app.id" class="application-tile" :class="{ 'grid-drop-before': gridDragOver && gridDropBefore === app.id, 'app-drag-source': draggedApp?.id === app.id }">
              <button class="grid-app-launch" :aria-label="`启动${app.name}`" draggable="false" :data-app-id="app.id" @dragstart.prevent @pointerdown="beginPointerDrag($event, app, 'grid')" @contextmenu="showAppMenu($event, app)" @click="openApp(app)"><AppIcon :app="app" /><span>{{ app.name }}</span></button>
              <button class="application-options" :aria-label="`${app.name}选项`" title="应用选项" @click="showAppMenu($event, app)">•••</button>
            </article>
          </div>
          <div v-else class="application-list"><article v-for="app in filteredApps" :key="app.id"><button class="app-launch" @click="openApp(app)"><AppIcon :app="app" /><span><strong>{{ app.name }}</strong><small>{{ app.description }}</small></span></button><button class="pin-control" :aria-pressed="prefs.pinned.includes(app.id)" @click="togglePin(app.id)">{{ prefs.pinned.includes(app.id) ? '已固定' : '固定' }}</button></article></div>
          <p v-if="!filteredApps.length" class="empty-message">没有匹配的授权应用</p>
        </template>
        <template v-if="panel === 'windows'"><button role="menuitem" class="panel-action" @click="store.windows.forEach(minimize); panel = ''">显示桌面</button><button v-for="win in store.windows" :key="win.id" role="menuitem" class="panel-action" @click="focus(win); panel = ''">{{ windowName(win) }}{{ win.minimized ? ' · 已最小化' : '' }}{{ win.dirty ? ' · 未保存' : '' }}</button><p v-if="!store.windows.length" class="muted">还没有打开的窗口</p></template>
      </section>
    </div>
    <div v-if="draggedApp" class="application-drag-canvas"><span class="application-drag-hint" role="status">{{ dragHint }}</span></div>
    <div v-if="dragApplication && dragPosition" class="application-drag-ghost" :style="{ left: dragPosition.x + 'px', top: dragPosition.y + 'px' }"><AppIcon :app="dragApplication"/><span>{{ dragApplication.name }}</span></div>
    <template v-if="desktopContext">
      <div class="app-menu-backdrop" @click="desktopContext = undefined" @contextmenu.prevent="desktopContext = undefined" />
      <div class="application-menu" role="menu" aria-label="桌面选项" :style="{ left: desktopContext.x + 'px', top: desktopContext.y + 'px' }">
        <template v-if="desktopContext.item"><button role="menuitem" @click="desktopAction('open')">打开</button><button role="menuitem" @click="desktopAction('rename')">重命名</button><button role="menuitem" @click="desktopAction('move')">移动到…</button><button role="menuitem" @click="desktopAction('delete')">移到回收站</button></template>
        <template v-else><button role="menuitem" @click="desktopAction('new-folder')">新建文件夹</button><button role="menuitem" @click="desktopAction('upload')">上传文件…</button></template>
        <button role="menuitem" @click="desktopAction('folder')">在文件中打开桌面</button><button role="menuitem" @click="desktopAction('refresh')">刷新</button>
      </div>
    </template>
    <template v-if="appMenu">
      <div class="app-menu-backdrop" @click="appMenu = null" @contextmenu.prevent="appMenu = null" />
      <div class="application-menu" role="menu" aria-label="应用选项" :style="{ left: appMenu.x + 'px', top: appMenu.y + 'px' }">
        <button role="menuitem" @click="openApp(apps.find(app => app.id === appMenu!.id)!)">打开应用</button>
        <button role="menuitem" @click="togglePin(appMenu.id); appMenu = null">{{ prefs.pinned.includes(appMenu.id) ? '从 Dock 移除' : '保留在 Dock 中' }}</button>
        <template v-if="prefs.pinned.includes(appMenu.id)"><button role="menuitem" :disabled="prefs.pinned.indexOf(appMenu.id) === 0" @click="movePinned(appMenu.id, -1)">向左移动</button><button role="menuitem" :disabled="prefs.pinned.indexOf(appMenu.id) === prefs.pinned.length - 1" @click="movePinned(appMenu.id, 1)">向右移动</button></template>
      </div>
    </template>
    <div v-if="closePrompt && !closePrompt.delegated" class="close-prompt-backdrop" @keydown.tab.prevent="cycleCloseFocus($event)">
      <section class="close-prompt" role="alertdialog" aria-modal="true" aria-labelledby="close-prompt-title" aria-describedby="close-prompt-message">
        <h2 id="close-prompt-title">关闭窗口？</h2><p id="close-prompt-message">{{ closePrompt.message }}</p>
        <div><button autofocus @click="finishClose(false)">继续使用</button><button @click="handleCloseInApp">在应用中处理</button><button class="discard-close" @click="finishClose(true)">直接关闭</button></div>
      </section>
    </div>
  </main>
</template>
