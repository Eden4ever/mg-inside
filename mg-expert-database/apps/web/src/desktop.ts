import { defaultPlatformOrigin, createDesktopApplication } from '@mg-inside/frontend';
const baseMeta = document.createElement('meta'); baseMeta.name = 'application-base'; baseMeta.content = import.meta.env.BASE_URL; document.head.append(baseMeta);
export const desktop = createDesktopApplication({ appId: 'expert-database', origin: import.meta.env.VITE_DESKTOP_ORIGIN || defaultPlatformOrigin(), formProtection: false });
export const unifiedDesktop = import.meta.env.VITE_IDENTITY_TOKEN_MODE !== 'legacy';
