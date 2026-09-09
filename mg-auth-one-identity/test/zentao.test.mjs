import test from 'node:test';
import assert from 'node:assert/strict';
import { ZentaoAuthService } from '../dist/zentao-auth.js';

test('禅道认证只接受已绑定账号并保留中心角色与 MFA 流程', async t => {
  const old = { enabled: process.env.ZENTAO_ENABLED, url: process.env.ZENTAO_BASE_URL };
  process.env.ZENTAO_ENABLED = 'true'; process.env.ZENTAO_BASE_URL = 'https://zentao.test';
  try {
    const user = { id: 'existing-user', status: 'active', role: 'member', mfaEnabled: true, failedLoginCount: 0 };
    let bound = true; let calls = 0; let passed;
    const tx = { $queryRaw: async () => [], user: { findUniqueOrThrow: async () => user, update: async () => user } };
    const prisma = { zentaoIdentity: { findUnique: async () => bound ? { userId: user.id, user } : null }, $transaction: cb => cb(tx) };
    t.mock.method(globalThis, 'fetch', async url => { calls++; return Response.json(url.endsWith('/tokens') ? { token: 'test-only' } : { profile: { account: 'existing-account', role: 'admin' } }); });
    const service = new ZentaoAuthService(prisma, { beginAuthentication: async (...args) => { passed = args; return { state: 'mfa_required' }; } });
    assert.deepEqual(await service.login('existing-account', 'test-password', {}), { state: 'mfa_required' });
    assert.equal(passed[0].id, 'existing-user'); assert.equal(passed[0].role, 'member'); assert.equal(passed[2], 'zentao');
    bound = false;
    await assert.rejects(service.login('unknown', 'test-password', {})); assert.equal(calls, 2);
    bound = true;
    t.mock.method(globalThis, 'fetch', async url => Response.json(url.endsWith('/tokens') ? { token: 'test-only' } : { profile: { account: 'different-account' } }));
    await assert.rejects(service.login('existing-account', 'test-password', {}));
  } finally {
    if (old.enabled === undefined) delete process.env.ZENTAO_ENABLED; else process.env.ZENTAO_ENABLED = old.enabled;
    if (old.url === undefined) delete process.env.ZENTAO_BASE_URL; else process.env.ZENTAO_BASE_URL = old.url;
  }
});
