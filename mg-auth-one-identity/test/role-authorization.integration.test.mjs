import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../dist/password.js';
import { applicationAccess } from '../dist/application-access.js';
import { ensurePlatformAdministratorRole, PLATFORM_ADMIN_KEY } from '../dist/platform-role.js';
const origin = 'http://127.0.0.1:14200';
const identityName = JSON.parse(await fs.readFile(new URL('../../mg-platform/packages/frontend/config/application-catalog.json', import.meta.url), 'utf8')).applications.identity.name;
const enabled = (() => { try { const u = new URL(process.env.DATABASE_URL); return u.hostname === '127.0.0.1' && u.searchParams.get('schema') === 'mg_desktop_local_identity'; } catch { return false; } })();

test('真实 API：多角色并集、逐来源撤销、独立 audience、同令牌 PKCE、CSRF 与管理边界', { skip: !enabled }, async t => {
  const db = new PrismaClient(), suffix = randomBytes(5).toString('hex'), password = randomBytes(24).toString('base64url');
  const userIds = [], roleIds = [];
  const futureAppId = `role-future-${suffix}`;
  async function browser(username) {
    const response = await fetch(`${origin}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ username, password }) });
    assert.equal(response.status, 200); const data = await response.json();
    const cookies = response.headers.getSetCookie().map(c => c.split(';')[0]);
    const cookie = cookies.join('; '), token = cookies.find(c => c.startsWith('mg_identity_session='))?.split('=')[1];
    assert.ok(token);
    return { token, cookie, csrf: data.csrfToken,
      async request(path, body, method = body === undefined ? 'GET' : 'POST', csrf = data.csrfToken) {
        return fetch(`${origin}${path}`, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: cookie, 'X-CSRF-Token': csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
      } };
  }
  const secrets = JSON.parse(await fs.readFile(process.env.IDENTITY_SECRETS_FILE, 'utf8'));
  async function machine(clientId) {
    const client = secrets.clients.find(c => c.client_id === clientId); assert.ok(client);
    const response = await fetch(`${origin}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: client.client_secret, scope: 'directory:read session:revoke' }) });
    assert.equal(response.status, 200); const data = await response.json();
    return { client, async request(path, body, method = 'POST') {
      return fetch(`${origin}${path}`, { method, headers: { Authorization: `Bearer ${data.access_token}`, 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body) });
    } };
  }
  try {
    for (const [key, role] of [['admin', 'system_admin'], ['member', 'member'], ['unrelated', 'member']]) {
      const user = await db.user.create({ data: { username: `role-${key}-${suffix}`, displayName: `授权验证${key === 'admin' ? '管理员' : key === 'member' ? '成员' : '无关成员'}-${suffix}`, role, passwordHash: await hashPassword(password) } }); userIds.push(user.id);
    }
    const [adminId, memberId, unrelatedId] = userIds;
    await db.application.create({data:{clientId:futureAppId,name:'后续应用验证'}});
    const platformRole = await ensurePlatformAdministratorRole(db);
    await db.userRole.create({ data: { userId: adminId, roleId: platformRole.id } });
    await db.applicationUser.create({ data: { clientId: 'identity', userId: adminId, enabled: true } });
    const admin = await browser(`role-admin-${suffix}`), member = await browser(`role-member-${suffix}`);
    const gateway = await machine('token-one'), desktop = await machine(process.env.IDENTITY_DESKTOP_CLIENT_ID || 'desktop-one');
    const inspect = async (appId, caller = gateway) => { const response = await caller.request('/api/unified/introspect', { token: member.token, app_id: appId }); assert.equal(response.status, 200); return response.json(); };
    const grant = async (roleId, clientId, allowed) => { const r = await admin.request(`/api/roles/${roleId}/applications/${clientId}`, { enabled: allowed }, 'PUT'); assert.equal(r.status, 200, await r.text()); };
    const addMember = async (roleId, allowed) => { const r = await admin.request(`/api/roles/${roleId}/members/${memberId}`, { enabled: allowed }, 'PUT'); assert.equal(r.status, 200, await r.text()); };
    await t.test('未授权用户仍可使用个人安全；管理 API 拒绝；CSRF 未削弱', async () => {
      assert.equal((await member.request('/api/auth/me')).status, 200);
      assert.equal((await member.request('/api/account-security')).status, 200);
      assert.equal((await member.request('/api/roles')).status, 403);
      assert.equal((await admin.request('/api/roles', { name: 'CSRF应拒绝' }, 'POST', '')).status, 403);
      assert.equal((await inspect('personal-center', desktop)).active, true);
      assert.equal((await inspect('files', desktop)).active, true);
      assert.equal((await inspect(process.env.IDENTITY_DESKTOP_CLIENT_ID || 'desktop-one', desktop)).active, true);
      assert.equal((await inspect('app-manager', desktop)).active, false);
      assert.equal((await inspect('identity', desktop)).active, false);
      assert.equal((await inspect('token-one')).active, false);
      assert.equal((await inspect('token-one-console')).active, false);
      assert.equal((await inspect('token-one-docs')).active, false);
    });
    for (const name of ['平台管理员', `研发协作-${suffix}`]) {
      const r = await admin.request('/api/roles', { name, description: '仅测试账号使用的授权角色' }); assert.equal(r.status, 201); roleIds.push((await r.json()).id);
    }
    const [first, second] = roleIds;
    await t.test('应用管理须显式授权，用户与角色来源全部撤销后同一令牌立即失效，个人中心保持默认可用', async () => {
      const list = await (await admin.request('/api/applications')).json();
      assert.equal(list.find(a => a.clientId === 'app-manager').foundation, false);
      assert.equal(list.find(a => a.clientId === 'personal-center').foundation, true);
      await addMember(first, true);
      await grant(first, 'app-manager', true);
      assert.equal((await inspect('app-manager', desktop)).active, true);
      const path = `/api/applications/app-manager/users/${memberId}`;
      assert.equal((await admin.request(path, { enabled: true }, 'PUT')).status, 200);
      assert.equal((await inspect('app-manager', desktop)).authorizationSources.length, 2);
      await grant(first, 'app-manager', false);
      assert.equal((await inspect('app-manager', desktop)).active, true);
      assert.equal((await admin.request(path, { enabled: false }, 'PUT')).status, 200);
      assert.equal((await inspect('app-manager', desktop)).active, false);
      const visible = await (await desktop.request('/api/unified/applications', { token: member.token })).json();
      assert.ok(!visible.applications.some(a => a.id === 'app-manager'));
      assert.equal((await inspect('personal-center', desktop)).active, true);
      assert.equal((await admin.request(`/api/applications/personal-center/users/${memberId}`, { enabled: true }, 'PUT')).status, 409);
      assert.equal((await admin.request(`/api/roles/${first}/applications/personal-center`, { enabled: true }, 'PUT')).status, 409);
      assert.equal((await admin.request(`/api/applications/files/users/${memberId}`, { enabled: true }, 'PUT')).status, 409);
      assert.equal((await admin.request(`/api/roles/${first}/applications/files`, { enabled: true }, 'PUT')).status, 409);
    });
    await t.test('同名普通角色与 identity 应用授权不获得平台管理能力', async () => {
      assert.equal((await admin.request(`/api/roles/users/${memberId}`, { roleIds }, 'PUT')).status, 200);
      await grant(first, 'identity', true);
      const me = await (await member.request('/api/auth/me')).json();
      assert.equal(me.user.role, 'member'); assert.equal(me.user.roles.length, 2); assert.equal(me.user.identityAuthorized, true);
      assert.equal((await member.request('/api/roles')).status, 403);
      assert.equal((await member.request('/api/users')).status, 403);
    });
    await t.test('内置平台管理员初始化幂等、不可删改或伪造 key；旧列不再授予管理能力', async () => {
      assert.equal((await ensurePlatformAdministratorRole(db)).id, platformRole.id);
      assert.equal((await ensurePlatformAdministratorRole(db)).id, platformRole.id);
      assert.equal(await db.role.count({ where: { key: PLATFORM_ADMIN_KEY } }), 1);
      assert.equal((await admin.request(`/api/roles/${platformRole.id}`, {}, 'DELETE')).status, 409);
      assert.equal((await admin.request(`/api/roles/${platformRole.id}`, { name: '普通成员' }, 'PATCH')).status, 409);
      assert.equal((await admin.request('/api/roles', { name: '伪造内置角色', key: PLATFORM_ADMIN_KEY })).status, 409);
      assert.equal((await admin.request(`/api/roles/${first}`, { name: '平台管理员', key: PLATFORM_ADMIN_KEY }, 'PATCH')).status, 409);
      await db.user.update({ where: { id: memberId }, data: { role: 'system_admin' } });
      await ensurePlatformAdministratorRole(db);
      assert.equal((await (await member.request('/api/auth/me')).json()).user.role, 'member');
      assert.equal((await member.request('/api/users')).status, 403);
      assert.equal((await admin.request(`/api/users/${memberId}`, { role: 'system_admin' }, 'PATCH')).status, 409);
    });
    await t.test('用户编辑角色多选为唯一平台身份来源，移除角色后同一会话立即撤管理权限', async () => {
      const path = `/api/users/${memberId}`;
      let response = await admin.request(path, { roleIds: [...roleIds, platformRole.id] }, 'PATCH');
      assert.equal(response.status, 200); assert.equal((await response.json()).role, 'system_admin');
      assert.equal((await member.request('/api/users')).status, 200);
      assert.equal((await applicationAccess(db, memberId, futureAppId)).effective, false);
      response = await admin.request(path, { roleIds }, 'PATCH');
      assert.equal(response.status, 200); assert.equal((await response.json()).role, 'member');
      assert.equal((await (await member.request('/api/auth/me')).json()).user.role, 'member');
      assert.equal((await member.request('/api/users')).status, 403);
      await addMember(first, true);
    });
    await grant(first, 'token-one-console', true); await grant(second, 'token-one-console', true);
    await t.test('用户直授权与两个角色来源并存，撤销任一来源不会误拒绝', async () => {
      const path = `/api/applications/token-one-console/users/${memberId}`;
      assert.equal((await admin.request(path, { enabled: true }, 'PUT')).status, 200);
      let profile = await inspect('token-one-console'); assert.equal(profile.active, true); assert.equal(profile.authorizationSources.length, 3);
      assert.equal(profile.aud, 'token-one-console'); assert.equal(profile.role, 'member');
      assert.equal((await inspect('token-one')).active, false); assert.equal((await inspect('token-one-docs')).active, false);
      assert.equal((await admin.request(path, { enabled: false }, 'PUT')).status, 200);
      assert.equal((await inspect('token-one-console')).authorizationSources.length, 2);
      await grant(first, 'token-one-console', false);
      profile = await inspect('token-one-console'); assert.equal(profile.active, true); assert.equal(profile.authorizationSources.length, 1);
      const view = await (await admin.request(`/api/applications/users/${memberId}`)).json();
      assert.equal(view.find(a => a.clientId === 'token-one-console').sources[0].roleId, second);
      await addMember(second, false); assert.equal((await inspect('token-one-console')).active, false);
      const visible = await (await desktop.request('/api/unified/applications', { token: member.token })).json();
      assert.ok(!visible.applications.some(a => a.id === 'token-one-console'));
      await addMember(second, true); assert.equal((await inspect('token-one-console')).active, true);
    });
    await t.test('机器调用者只允许固定 audience 家族，历史账号映射不授予门户权限', async () => {
      assert.equal((await gateway.request('/api/unified/introspect', { token: member.token, app_id: 'expert-database' })).status, 403);
      await db.applicationUser.upsert({ where: { clientId_userId: { clientId: 'token-one', userId: memberId } }, create: { clientId: 'token-one', userId: memberId, localUserId: `old-${suffix}`, enabled: false }, update: { localUserId: `old-${suffix}` } });
      assert.equal((await inspect('token-one-console')).localUserId, `old-${suffix}`);
      assert.equal((await inspect('token-one')).active, false);
      const aliases = await gateway.request('/api/unified/introspect', { token: member.token, targetAppId: 'token-one-console' }); assert.equal((await aliases.json()).aud, 'token-one-console');
    });
    await t.test('角色撤销的业务目录仍返回停用记录，不暴露无关名录', async () => {
      await grant(second, 'token-one', true);
      let directory = await (await gateway.request('/api/directory/users', undefined, 'GET')).json();
      assert.equal(directory.users.find(u => u.subject === memberId).active, true);
      await grant(second, 'token-one', false);
      directory = await (await gateway.request('/api/directory/users', undefined, 'GET')).json();
      assert.equal(directory.users.find(u => u.subject === memberId).active, false);
      assert.ok(!directory.users.some(u => u.subject === unrelatedId));
    });
    await t.test('PKCE 登录交换仍返回同一枚 T，错误 verifier 与重放被拒绝', async () => {
      const verifier = randomBytes(48).toString('base64url'), redirect = desktop.client.redirect_uris[0];
      const qs = new URLSearchParams({ client_id: desktop.client.client_id, redirect_uri: redirect, state: randomBytes(24).toString('base64url'), code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
      const response = await member.request(`/api/unified/authorize?${qs}`); assert.equal(response.status, 303);
      const code = new URL(response.headers.get('location')).searchParams.get('code');
      const payload = { code, code_verifier: verifier, redirect_uri: redirect };
      assert.equal((await desktop.request('/api/unified/exchange', { ...payload, code_verifier: randomBytes(48).toString('base64url') })).status, 400);
      const exchanged = await desktop.request('/api/unified/exchange', payload); assert.equal(exchanged.status, 200); assert.equal((await exchanged.json()).access_token, member.token);
      assert.equal((await desktop.request('/api/unified/exchange', payload)).status, 400);
    });
    if (process.env.ROLE_GUI_VERIFY === '1') {
      await t.test('浏览器用户授权与角色管理布局截图', async () => {
        const { chromium } = await import('../../mg-desktop-one/node_modules/playwright-core/index.mjs');
        const browser = await chromium.launch({ channel: 'chrome', headless: true });
        try {
          const context = await browser.newContext({ viewport: { width: 1440, height: 940 } });
          await context.addCookies([{ name: 'mg_identity_session', value: admin.token, url: origin, httpOnly: true, sameSite: 'Lax' }]);
          const page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
          await fs.mkdir(new URL('../.runtime/roles-verification/', import.meta.url), { recursive: true });
          await page.goto(`${origin}/applications?user=${memberId}`); await page.getByRole('heading', { name: '应用授权', exact: true }).waitFor();
          await page.getByText(`授权验证成员-${suffix} 的角色：`, { exact: false }).waitFor();
          assert.equal(await page.title(), `应用授权 · ${identityName}`);
          await page.getByText('角色：', { exact: false }).first().waitFor();
          await page.getByRole('row').filter({ hasText: 'app-manager' }).waitFor();
          assert.equal(await page.getByRole('row').filter({ hasText: 'app-manager' }).count(), 1);
          assert.equal(await page.getByRole('row').filter({ hasText: 'personal-center' }).count(), 0);
          assert.equal(await page.getByRole('row').filter({ hasText: /^文件\s+files/ }).count(), 0);
          await page.screenshot({ path: new URL('../.runtime/roles-verification/user-authorization.png', import.meta.url).pathname.replace(/^\//, ''), fullPage: true, animations: 'disabled' });
          await page.goto(`${origin}/roles`); await page.getByRole('heading', { name: '角色管理', exact: true }).waitFor();
          await page.getByText(`研发协作-${suffix}`, { exact: true }).waitFor();
          const builtInRow = page.getByRole('row').filter({ hasText: '内置角色' });
          assert.equal(await builtInRow.getByRole('button', { name: '删除', exact: true }).isDisabled(), true);
          await page.screenshot({ path: new URL('../.runtime/roles-verification/role-management.png', import.meta.url).pathname.replace(/^\//, ''), fullPage: true, animations: 'disabled' });
          await page.goto(`${origin}/applications?role=${second}`);
          await page.getByText(`研发协作-${suffix} · 1 位成员`, { exact: false }).waitFor();
          assert.equal(await page.locator('input[type="radio"][value="role"]').isChecked(), true);
          await page.getByRole('row').filter({ hasText: 'app-manager' }).waitFor();
          assert.equal(await page.getByRole('row').filter({ hasText: 'app-manager' }).count(), 1);
          assert.equal(await page.getByRole('row').filter({ hasText: 'personal-center' }).count(), 0);
          assert.equal(await page.getByRole('row').filter({ hasText: /^文件\s+files/ }).count(), 0);
          await page.screenshot({ path: new URL('../.runtime/roles-verification/role-authorization.png', import.meta.url).pathname.replace(/^\//, ''), fullPage: true, animations: 'disabled' });
          await page.goto(`${origin}/admin`);
          await page.getByPlaceholder('搜索姓名、账号或部门').fill(`role-member-${suffix}`);
          const memberRow = page.getByRole('row').filter({ hasText: `role-member-${suffix}` });
          await memberRow.getByRole('button', { name: '编辑', exact: true }).click();
          await page.getByRole('dialog').getByRole('combobox', { name: '用户角色' }).waitFor();
          assert.equal(await page.getByText('系统身份', { exact: true }).count(), 0);
          await page.screenshot({ path: new URL('../.runtime/roles-verification/user-role-editor.png', import.meta.url).pathname.replace(/^\//, ''), fullPage: true, animations: 'disabled' });
          await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
          await page.goto(`${origin}/`); await page.getByRole('heading', { name: '管理概览', exact: true }).waitFor();
          await page.locator('.el-loading-mask').waitFor({ state: 'detached' });
          assert.equal(await page.getByText('我的应用', { exact: true }).count(), 0);
          assert.equal(await page.locator('.user-trigger').count(), 0);
          await page.screenshot({ path: new URL('../.runtime/roles-verification/management-overview.png', import.meta.url).pathname.replace(/^\//, ''), fullPage: true, animations: 'disabled' });
          const anonymous = await browser.newContext({ viewport: { width: 1440, height: 940 } });
          const loginPage = await anonymous.newPage(); await loginPage.goto(`${origin}/login`);
          await loginPage.getByRole('heading', { name: identityName, exact: true }).waitFor();
          assert.equal(await loginPage.title(), `统一登录 · ${identityName}`);
          assert.deepEqual(errors, []);
        } finally { await browser.close(); }
      });
    }
    await t.test('角色删除保护及所有来源撤销后立即拒绝 identity', async () => {
      assert.equal((await admin.request(`/api/roles/${first}`, {}, 'DELETE')).status, 409);
      await grant(first, 'identity', false); assert.equal((await inspect('identity', desktop)).active, false);
      assert.equal((await member.request('/api/auth/me')).status, 200); assert.equal((await member.request('/api/applications')).status, 403);
      await addMember(first, false);
      assert.equal((await admin.request(`/api/roles/${first}`, {}, 'DELETE')).status, 200);
    });
    await t.test('console-only 用户可用指定 audience 退出同一会话', async () => {
      assert.equal((await inspect('token-one')).active, false); assert.equal((await inspect('token-one-console')).active, true);
      assert.equal((await gateway.request('/api/unified/revoke', { token: member.token, app_id: 'token-one-console' })).status, 200);
      assert.equal((await inspect('personal-center', desktop)).active, false);
    });
  } finally {
    await db.userRole.deleteMany({ where: { userId: { in: userIds } } });
    await db.roleApplication.deleteMany({ where: { roleId: { in: roleIds } } });
    await db.role.deleteMany({ where: { id: { in: roleIds } } });
    await db.applicationUser.deleteMany({ where: { userId: { in: userIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.application.deleteMany({where:{clientId:futureAppId}});
    await db.$disconnect();
  }
});

