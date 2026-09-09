import { applicationPresentation } from '@mg-inside/frontend';
const identity = applicationPresentation('identity');
if (!identity) throw new Error('平台应用配置缺少 identity');
export const identityPresentation = identity;
