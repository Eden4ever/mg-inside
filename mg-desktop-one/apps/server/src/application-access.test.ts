import { afterEach, expect, it, vi } from 'vitest';
import { hasRequiredRole } from './application-access';
import { registry } from './config';
afterEach(() => vi.unstubAllGlobals());
it('统一身份认证读取自身返回的用户角色，控制台不依赖业务admin', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ user: { role: 'system_admin' } }), { status: 200 }));
  vi.stubGlobal('fetch', fetcher);
  expect(await hasRequiredRole(registry.find(app => app.id === 'identity')!, 'test-token')).toBe(true);
  fetcher.mockResolvedValue(new Response(JSON.stringify({ user: { role: 'member' } }), { status: 200 }));
  expect(await hasRequiredRole(registry.find(app => app.id === 'identity')!, 'test-token')).toBe(false);
  const called = fetcher.mock.calls.length;
  expect(await hasRequiredRole(registry.find(app => app.id === 'token-one-console')!, 'test-token')).toBe(true);
  expect(fetcher.mock.calls.length).toBe(called);
});
