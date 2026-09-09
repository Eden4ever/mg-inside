import { defaultPlatformOrigin, createDesktopApplication, createPlatformSession } from '@mg-inside/frontend';
import { application } from './application';
export const desktop = createDesktopApplication({ appId: application.appId, origin: import.meta.env.VITE_DESKTOP_ORIGIN || defaultPlatformOrigin(), formProtection: false });
export const platformSession = createPlatformSession({ origin: desktop.origin, onExpired: () => desktop.login() });
let leaveGuard: () => boolean = () => true;
let pendingChanges: () => boolean = () => false;
export function setLeaveGuard(guard: () => boolean, pending: () => boolean = () => false) {
  leaveGuard = guard;
  pendingChanges = pending;
  return () => { if (leaveGuard === guard) { leaveGuard = () => true; pendingChanges = () => false; desktop.setState({ dirty: false }); } };
}
window.addEventListener('beforeunload', event => {
  if (pendingChanges() || [...document.querySelectorAll('.el-dialog')].some(el => el.getClientRects().length)) { event.preventDefault(); event.returnValue = ''; }
});
export function canLeave() {
  if ([...document.querySelectorAll('.el-dialog')].some(el => el.getClientRects().length)) {
    desktop.notify('请先完成或取消当前安全设置，再关闭窗口。');
    return false;
  }
  return leaveGuard();
}
