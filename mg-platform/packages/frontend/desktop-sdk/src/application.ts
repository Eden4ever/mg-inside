import { connectDesktop } from './index';
import { safeAppPath } from '../../desktop-contracts/src/index';
import { configurePlatformOrigin } from '../../auth/platform-origin';

export function createDesktopApplication(options: { appId: string; origin: string; formProtection?: boolean }) {
  const origin = new URL(options.origin).origin;
  configurePlatformOrigin(origin);
  let closeHandler: (() => boolean | Promise<boolean>) | undefined;
  let navigateHandler: ((path: string) => void | Promise<void>) | undefined;
  let dirty = false, edits = false, busy = 0, taskBusy = false, dialogOpen = false;
  const bridge = connectDesktop({ appId: options.appId, allowedOrigins: [origin],
    onClose: async () => {
      if (busy > 0) { bridge.notify('请求尚未完成，请稍后关闭窗口。'); return false; }
      if (closeHandler && !await closeHandler()) return false;
      return !(edits || (!closeHandler && (dirty || taskBusy))) || window.confirm('窗口内可能有未保存的编辑，关闭会丢失这些内容。确定关闭吗？');
    },
    onNavigate: path => navigateHandler?.(path),
  });
  function state() { bridge.setState({ dirty: dirty || edits || dialogOpen, busy: busy > 0 || taskBusy }); }
  if (bridge.enabled) {
    document.documentElement.classList.add('desktop-embedded');
    let lastAppearance = '';
    function appearance() {
      const chrome = document.querySelector<HTMLElement>('.app-shell, .workspace-shell, .docs-shell, .mg-dialog-window');
      if (!chrome) return;
      const style = getComputedStyle(chrome);
      const value = { backgroundColor: style.getPropertyValue('--inside-window-surface').trim() || style.backgroundColor, backgroundImage: style.backgroundImage, color: style.color };
      const signature = JSON.stringify(value);
      if (lastAppearance !== signature) { lastAppearance = signature; bridge.setAppearance(value); }
    }
    const appearanceTimer = setInterval(appearance, 1000);
    window.addEventListener('pagehide', () => clearInterval(appearanceTimer), { once: true });
    requestAnimationFrame(appearance);
    // 弹窗包括传送到 body 的安全设置；即使应用自行管理表单，也不能漏报可见弹窗。
    function checkDialogs() {
      const visible = [...document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"], .el-dialog')]
        .some(el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[aria-hidden="true"]'));
      if (visible !== dialogOpen) { dialogOpen = visible; state(); }
    }
    const dialogs = new MutationObserver(checkDialogs);
    dialogs.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'] });
    window.addEventListener('pagehide', () => dialogs.disconnect(), { once: true });
    checkDialogs();
    function edited(event: Event) {
      const el = event.target as HTMLElement;
      if (el.closest('input,textarea,select,[contenteditable="true"],[role="switch"],[role="checkbox"],[role="option"]') && !el.closest('[data-desktop-search]')) { edits = true; state(); }
    }
    if (options.formProtection !== false) { document.addEventListener('input', edited, true); document.addEventListener('change', edited, true); document.addEventListener('click', event => { if ((event.target as HTMLElement).closest('[role="switch"],[role="checkbox"],[role="option"]')) edited(event); }, true); }
  }
  return {
    ...bridge, origin, apiBase: `${origin}/api/apps/${options.appId}`,
    openPersonalCenter(path = '/profile') {
      const target = ['/profile', '/security', '/preferences', '/notifications'].includes(path) ? path : '/profile';
      if (bridge.enabled) bridge.openApplication('personal-center', target);
      else window.open(`${origin}/auth/start?app=personal-center&path=${encodeURIComponent(target)}&display=standalone`, '_blank', 'noopener,noreferrer');
    },
    login(path = location.pathname) {
      if (bridge.enabled) { bridge.authRequired(); return; }
      const base = document.querySelector('meta[name="application-base"]')?.getAttribute('content')?.replace(/\/$/, '') || '';
      const appPath = base && path.startsWith(base + '/') ? path.slice(base.length) : path;
      location.assign(`${origin}/auth/start?app=${encodeURIComponent(options.appId)}&path=${encodeURIComponent(safeAppPath(appPath))}&display=standalone`);
    },
    configure(handlers: { onClose?: () => boolean | Promise<boolean>; onNavigate?: (path: string) => void | Promise<void> }) { closeHandler = handlers.onClose; navigateHandler = handlers.onNavigate; },
    setState(value: { dirty: boolean; busy?: boolean }) { dirty = value.dirty; taskBusy = !!value.busy; state(); },
    beginRequest() { busy++; state(); let ended = false; return () => { if (!ended) { ended = true; busy--; state(); } }; },
    clearEdits() { edits = false; state(); },
  };
}
