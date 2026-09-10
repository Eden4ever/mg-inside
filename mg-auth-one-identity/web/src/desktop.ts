import { defaultPlatformOrigin, createDesktopApplication } from '@mg-inside/frontend';
// 搜索/筛选不是草稿；弹窗由 SDK 保护，页面内配置表单显式上报编辑状态。
export const desktop = createDesktopApplication({ appId: 'identity', origin: import.meta.env.VITE_DESKTOP_ORIGIN || defaultPlatformOrigin(), formProtection: false });
// 非根路径构建用于桌面托管管理页；认证域名根路径继续保留完整登录与 MFA。
export const usesDesktopAuthentication = desktop.enabled || import.meta.env.BASE_URL !== '/';
