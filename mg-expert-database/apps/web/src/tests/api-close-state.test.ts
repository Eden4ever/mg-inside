import { afterEach, expect, it, vi } from 'vitest';
const end = vi.hoisted(() => vi.fn());
vi.mock('@/desktop', () => ({ unifiedDesktop: false, desktop: { beginRequest: () => end, login: vi.fn() } }));
import { api } from '@/api/client';

afterEach(() => { vi.unstubAllGlobals(); end.mockClear(); });

it('写请求收到响应头后仍保持忙态，直到完整读取响应体', async () => {
  let deliver: (value: unknown) => void = () => {};
  const body = new Promise(resolve => { deliver = resolve; });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: () => body }));
  const request = api.saveMailSettings({ enabled: false, host: '', port: 465, security: 'tls', username: '', fromAddress: '', fromName: '', revision: 0 });
  await Promise.resolve(); await Promise.resolve();
  expect(end).not.toHaveBeenCalled();
  deliver({ hasPassword: false });
  await request;
  expect(end).toHaveBeenCalledTimes(1);
});
