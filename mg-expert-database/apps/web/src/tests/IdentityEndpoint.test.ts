import { afterEach, expect, it, vi } from 'vitest';
import { identityEndpoint } from '@/api/identity';
afterEach(() => vi.unstubAllEnvs());
it('SSO 状态和跳转均使用生产反向代理子目录', () => {
  vi.stubEnv('BASE_URL', '/knowledge-base-inside/');
  vi.stubEnv('VITE_API_BASE_URL', '');
  expect(identityEndpoint('status')).toBe('/knowledge-base-inside/api/auth/sso/status');
  expect(identityEndpoint('start')).toBe('/knowledge-base-inside/api/auth/sso/start');
  vi.stubEnv('VITE_API_BASE_URL', '/explicit/api/');
  expect(identityEndpoint('start')).toBe('/explicit/api/auth/sso/start');
});
