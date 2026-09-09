import { describe, expect, it } from 'vitest';
import { registry, allowsApiPath, publicApp } from './config';

describe('个人中心代理边界', () => {
  const app = registry.find(app => app.id === 'personal-center')!;
  it('复用身份授权，只开放本人资料和安全接口', () => {
    for (const path of ['/auth/me', '/auth/change-password', '/account-security', '/account-security/key/start']) expect(allowsApiPath(app, path)).toBe(true);
    for (const path of ['/users', '/applications', '/mail-settings', '/account-security/../users', '/account-security/%2e%2e/users', '/account-security/%252e%252e/users', '/account-security-extra']) expect(allowsApiPath(app, path)).toBe(false);
  });
  it('前端目录不包含服务端代理与授权配置', () => {
    expect(publicApp(app)).not.toHaveProperty('upstream');
    expect(publicApp(app)).not.toHaveProperty('authorizationAppId');
    expect(publicApp(app)).not.toHaveProperty('allowedApiPaths');
  });
});
