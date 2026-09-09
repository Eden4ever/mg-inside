import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlatformSession } from '../packages/frontend/auth/session.ts';

test('并发写操作共用一次会话读取，凭据只通过 Cookie 发送', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(url, 'https://desktop.example/api/session');
    assert.equal(init.credentials, 'include');
    assert.equal(init.headers, undefined);
    return Response.json({ csrfToken: 'csrf-value' });
  };
  try {
    const session = createPlatformSession({ origin: 'https://desktop.example', onExpired() {} });
    assert.deepEqual(await Promise.all([session.csrf(), session.csrf(), session.csrf()]), Array(3).fill('csrf-value'));
    assert.equal(calls, 1);
    session.clear();
    await session.csrf();
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});

test('退出时未完成的旧请求不能重新填入旧会话', async () => {
  const original = globalThis.fetch;
  let resolveResponse;
  globalThis.fetch = () => new Promise(resolve => { resolveResponse = resolve; });
  try {
    const session = createPlatformSession({ origin: 'https://desktop.example', onExpired() {} });
    const pending = session.csrf();
    session.clear();
    resolveResponse(Response.json({ csrfToken: 'old-csrf' }));
    await assert.rejects(pending, /登录状态已更新/);
  } finally { globalThis.fetch = original; }
});

test('会话过期通知统一登录，网络错误不冒充过期', async () => {
  const original = globalThis.fetch;
  let expired = 0;
  try {
    const session = createPlatformSession({ origin: 'https://desktop.example', onExpired() { expired++; } });
    globalThis.fetch = async () => new Response('', { status: 503 });
    await assert.rejects(session.csrf()); assert.equal(expired, 0);
    globalThis.fetch = async () => new Response('', { status: 401 });
    await assert.rejects(session.csrf()); assert.equal(expired, 1);
  } finally { globalThis.fetch = original; }
});
