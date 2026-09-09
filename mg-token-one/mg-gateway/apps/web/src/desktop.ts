import { defaultPlatformOrigin, createDesktopApplication, applicationPresentation } from '@mg-inside/frontend';
export function tokenApplicationForPath(path: string) {
  path = path.split(/[?#]/, 1)[0];
  if (/^\/admin(?:\/|$)/.test(path)) return 'token-one-console';
  if (/^\/docs(?:\/|$)/.test(path)) return 'token-one-docs';
  return 'token-one';
}
// 每个窗口保留首次入口身份；跨应用跳转交给桌面创建或激活对应窗口。
export const tokenApplicationId = tokenApplicationForPath(location.pathname);
const presentation = applicationPresentation(tokenApplicationId);
if (!presentation) throw new Error('公共应用目录缺少当前 Token One 入口');
export const tokenPresentation = presentation;
export const desktop = createDesktopApplication({ appId: tokenApplicationId, origin: import.meta.env.VITE_DESKTOP_ORIGIN || defaultPlatformOrigin() });
export const unifiedDesktop = import.meta.env.VITE_IDENTITY_TOKEN_MODE !== 'legacy';

export function openTokenApplication(path: string) {
  if (desktop.enabled) desktop.openApplication(tokenApplicationForPath(path), path);
  else location.assign(path);
}

export function openPersonalCenter() {
  if (desktop.enabled) desktop.openApplication('personal-center', '/profile');
  else location.assign(`${desktop.origin}/auth/start?app=personal-center&path=%2Fprofile&display=standalone`);
}
