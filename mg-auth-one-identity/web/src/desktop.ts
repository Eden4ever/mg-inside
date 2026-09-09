import { defaultPlatformOrigin, createDesktopApplication } from '@mg-inside/frontend';
export const desktop = createDesktopApplication({ appId: 'identity', origin: import.meta.env.VITE_DESKTOP_ORIGIN || defaultPlatformOrigin() });
// 非根路径构建用于桌面托管管理页；认证域名根路径继续保留完整登录与 MFA。
export const usesDesktopAuthentication = desktop.enabled || import.meta.env.BASE_URL !== '/';
