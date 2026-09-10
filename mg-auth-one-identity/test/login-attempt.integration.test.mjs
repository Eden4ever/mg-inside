import { ensurePlatformAdministratorRole } from '../dist/platform-role.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../dist/password.js';
const origin = process.env.IDENTITY_TEST_ORIGIN ?? 'http://127.0.0.1:4200';
if (!process.env.DATABASE_URL?.includes('127.0.0.1:15439/identity_test')) throw new Error('仅允许本地专用测试库');

test('登录历史：成功与失败都落库，锁定可区分，查询仅限平台管理员', async () => {
  const db = new PrismaClient(); const jar = new Map(); const users = []; const names = [];
  const suffix = randomBytes(6).toString('hex'); const password = randomBytes(24).toString('base64url');
  async function browser(path, body, method = body === undefined ? 'GET' : 'POST', csrf = '') {
    const response = await fetch(new URL(path, origin), { method, redirect: 'manual', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const cookie of response.headers.getSetCookie()) { const pair = cookie.split(';')[0]; const i = pair.indexOf('='); jar.set(pair.slice(0, i), pair.slice(i + 1)); }
    return response;
  }
  const attempts = username => db.loginAttempt.findMany({ where: { username }, orderBy: { at: 'asc' } });
  try {
    const adminName = `sec-admin-${suffix}`; names.push(adminName);
    const admin = await db.user.create({ data: { username: adminName, displayName: `安全中心管理-${suffix}`, role: 'system_admin', passwordHash: await hashPassword(password) } });
    users.push(admin.id);
    const platformRole = await ensurePlatformAdministratorRole(db);
    await db.userRole.create({ data: { userId: admin.id, roleId: platformRole.id } });
    await db.applicationUser.create({ data: { userId: admin.id, clientId: 'identity', enabled: true } });

    // 成功登录：记录与会话同事务提交，必须带上会话标识。
    const login = await browser('/api/auth/login', { username: adminName, password });
    assert.equal(login.status, 200);
    const csrf = (await login.json()).csrfToken;
    const afterSuccess = await attempts(adminName);
    assert.equal(afterSuccess.length, 1);
    assert.equal(afterSuccess[0].result, 'success');
    assert.equal(afterSuccess[0].source, 'local');
    assert.equal(afterSuccess[0].userId, admin.id);
    assert.ok(afterSuccess[0].sessionId, '成功记录必须关联会话');
    assert.ok(afterSuccess[0].ipAddress, '成功记录必须留下来源地址');

    // 账号不存在：仍要留下账号本身，便于发现针对未知账号的尝试。
    const unknown = `sec-ghost-${suffix}`; names.push(unknown);
    assert.equal((await browser('/api/auth/login', { username: unknown, password })).status, 401);
    const ghost = await attempts(unknown);
    assert.equal(ghost.length, 1);
    assert.deepEqual([ghost[0].result, ghost[0].reason, ghost[0].userId], ['failure', 'invalid_credentials', null]);

    // 密码错误累计到阈值后转为锁定，两种原因必须能区分。
    const victimName = `sec-victim-${suffix}`; names.push(victimName);
    const victim = await db.user.create({ data: { username: victimName, displayName: `安全中心受试-${suffix}`, role: 'member', passwordHash: await hashPassword(password) } });
    users.push(victim.id);
    for (let i = 0; i < 5; i++) assert.equal((await browser('/api/auth/login', { username: victimName, password: 'WrongPassword!2026' })).status, 401);
    assert.equal((await browser('/api/auth/login', { username: victimName, password })).status, 429);
    const victimRows = await attempts(victimName);
    assert.equal(victimRows.length, 6);
    assert.deepEqual(victimRows.map(row => row.reason), ['invalid_credentials', 'invalid_credentials', 'invalid_credentials', 'invalid_credentials', 'invalid_credentials', 'locked']);
    assert.ok(victimRows.every(row => row.result === 'failure' && row.userId === victim.id));

    // 查询接口：结果与账号筛选、分页，且仅平台管理员可读。
    const listed = await browser(`/api/login-attempts?username=${victimName}&result=failure&pageSize=3`);
    assert.equal(listed.status, 200);
    const page = await listed.json();
    assert.equal(page.total, 6);
    assert.equal(page.items.length, 3);
    assert.equal(page.items[0].username, victimName);
    assert.ok(page.items[0].at >= page.items[1].at, '默认按时间倒序');
    assert.equal((await browser('/api/login-attempts?result=nonsense')).status, 400);

    jar.clear();
    const victimLogin = await browser('/api/auth/login', { username: victimName, password });
    assert.ok([200, 429].includes(victimLogin.status));
    if (victimLogin.status === 200) assert.equal((await browser('/api/login-attempts')).status, 403, '普通成员不能读取全平台登录历史');
    assert.ok(csrf);
  } finally {
    await db.loginAttempt.deleteMany({ where: { username: { in: names } } });
    for (const id of users) await db.user.delete({ where: { id } }).catch(() => {});
    await db.$disconnect();
  }
});
