import { defineStore } from 'pinia';
import { ref } from 'vue';
import { safeAppPath, appAllowsPath, type DesktopApp, type DesktopWindow, type DesktopDialogDefinition, type WindowMode, type Rect } from '../../../../../mg-platform/packages/frontend/desktop-contracts/src/index';
import { cascadeRect, clampRect, floatingRect, modeRect, windowBounds, type WorkArea } from './geometry';
export const useWindows = defineStore('windows', () => {
  const windows = ref<DesktopWindow[]>([]);
  const activeId = ref('');
  const order = ref<string[]>([]);
  const area = ref<WorkArea>({ width: 1280, height: 740 });
  const dockHeight = ref(92);
  function floatingArea() { return windowBounds('normal', area.value, dockHeight.value); }
  function focus(id: string) {
    const win = windows.value.find(w => w.id === id); if (!win) return;
    // 只调整层级，不移动 iframe DOM，防止浏览器销毁并重载窗口内容。
    win.minimized = false; order.value = [...order.value.filter(value => value !== id), id]; activeId.value = id;
  }
  function open(app: DesktopApp, path = app.defaultPath) {
    let win = windows.value.find(w => w.appId === app.id && !w.dialog);
    if (win) { focus(win.id); return win; }
    const rect = clampRect({ x: 90 + windows.value.length * 32, y: 44 + windows.value.length * 30,
      width: area.value.width * .8, height: area.value.height * .82 }, floatingArea(), { width: app.minWidth, height: app.minHeight });
    win = { id: crypto.randomUUID(), appId: app.id, title: app.name, path: appAllowsPath(app, path) ? safeAppPath(path) : app.defaultPath,
      rect, restoreRect: { ...rect }, mode: app.defaultMaximized ? 'maximized' : 'normal', minimized: false,
      ready: false, dirty: false, busy: false, error: '' };
    windows.value.push(win); focus(win.id); return windows.value.find(w => w.id === win!.id)!;
  }
  function openDialog(parent: DesktopWindow, definition: DesktopDialogDefinition, requestId: string, params: Record<string, unknown>) {
    const parentRect = displayRect(parent);
    const rect = clampRect({ x: parentRect.x + 48, y: parentRect.y + 42, width: definition.width || 640, height: definition.height || 480 }, floatingArea(), { width: 320, height: 240 });
    const win: DesktopWindow = { id: crypto.randomUUID(), appId: parent.appId, title: definition.title, path: definition.path,
      rect, restoreRect: { ...rect }, mode: 'normal', minimized: false, ready: false, dirty: false, busy: false, error: '',
      dialog: { parentWindowId: parent.id, requestId, dialogId: definition.id, params } };
    windows.value.push(win); focus(win.id); return windows.value.find(item => item.id === win.id)!;
  }
  function visibleTop() { return [...order.value].reverse().find(id => windows.value.some(w => w.id === id && !w.minimized)) || ''; }
  function minimize(id: string) { const win = windows.value.find(w => w.id === id); if (!win) return; win.minimized = true; activeId.value = visibleTop(); }
  function remove(id: string) { windows.value = windows.value.filter(w => w.id !== id); order.value = order.value.filter(value => value !== id); activeId.value = visibleTop(); }
  function setMode(id: string, mode: WindowMode) {
    const win = windows.value.find(w => w.id === id); if (!win) return;
    if (win.mode === 'normal') win.restoreRect = { ...win.rect };
    win.mode = mode; if (mode === 'normal') win.rect = clampRect(win.restoreRect, floatingArea()); focus(id);
  }
  function displayRect(win: DesktopWindow) { return modeRect(win.mode, win.rect, area.value, dockHeight.value); }
  function move(id: string, rect: Rect, app: DesktopApp) { const win = windows.value.find(w => w.id === id); if (!win) return;
    const placed = displayRect(win);
    win.rect = floatingRect(rect, floatingArea(), { width: Math.min(win.dialog ? 320 : app.minWidth, placed.width), height: Math.min(win.dialog ? 240 : app.minHeight, placed.height) });
    win.mode = 'normal'; win.restoreRect = { ...win.rect }; }
  function reset() { windows.value = []; order.value = []; activeId.value = ''; }
  function snapshot() { return windows.value.filter(win => !win.dialog).sort((a,b) => order.value.indexOf(a.id)-order.value.indexOf(b.id)).map(({ appId, path, rect, mode, minimized }) => ({ appId, path: safeAppPath(path), rect, mode, minimized })); }
  function restore(value: unknown, apps: DesktopApp[]) {
    if (!Array.isArray(value)) return;
    const seen = new Set<string>();
    const entries = value.slice(0, 40).filter(item => { const app = apps.find(a => a.id === item?.appId); if (!app || seen.has(app.id) || !appAllowsPath(app, item.path)) return false; seen.add(app.id); return true; });
    const visibleCount = entries.filter(item => item.minimized !== true).length;
    const minimum = entries.reduce((size, item) => { const app = apps.find(app => app.id === item.appId)!; return { width: Math.max(size.width, app.minWidth), height: Math.max(size.height, app.minHeight) }; }, { width: 680, height: 480 });
    let visibleIndex = 0;
    for (const item of entries) {
      const app = apps.find(a => a.id === item.appId)!;
      const win = open(app, safeAppPath(item.path));
      win.rect = cascadeRect(item.minimized === true ? 0 : visibleIndex++, visibleCount, area.value, minimum); win.restoreRect = { ...win.rect };
      win.mode = visibleCount > 1 ? 'normal' : ['normal', 'maximized', 'left', 'right'].includes(item.mode) ? item.mode : 'normal';
      win.minimized = item.minimized === true;
    }
    activeId.value = visibleTop();
  }
  return { windows, activeId, order, area, dockHeight, focus, open, openDialog, minimize, remove, setMode, displayRect, move, reset, snapshot, restore };
});
