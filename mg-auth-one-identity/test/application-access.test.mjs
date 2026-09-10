import test from 'node:test';
import assert from 'node:assert/strict';
import { compatibilityRole, PLATFORM_ADMIN_KEY } from '../dist/platform-role.js';
import { applicationAccess, effectiveApplications, ensureIdentityAdministrator, canInspectAudience, isFoundationApplication } from '../dist/application-access.js';
import {kernelFixture} from './kernel-fixture.mjs';

test('最后一个有效管理员可由角色授权保留，所有来源消失必须拒绝', async t => {
  const kernel=await kernelFixture([{id:'identity',name:'统一身份'}]);t.after(kernel.close);
  const state = { direct: false, role: true };
  const db = {
    scopeGrant: { findMany: async () => [] },
    application: { findUnique: async () => ({ name: '统一身份', enabled: true }) },
    user: { findUnique: async () => ({ status: 'active' }), findMany: async ({where}) => { assert.equal(where.roles.some.role.key, PLATFORM_ADMIN_KEY); assert.equal(where.role, undefined); return [{ id: 'admin' }]; } },
    applicationUser: { findUnique: async () => ({ enabled: state.direct, localUserId: null }) },
    userRole: { findMany: async () => state.role ? [{ roleId: 'r', role: { name: '管理协作' } }] : [] },
  };
  await ensureIdentityAdministrator(db);
  state.role = false;
  await assert.rejects(() => ensureIdentityAdministrator(db), error => error.getStatus() === 409);
  state.direct = true;
  await ensureIdentityAdministrator(db);
});

test('停用用户或应用会覆盖全部授权来源，基础入口也不能绕过账号停用', async t => {
  const kernel=await kernelFixture([{id:'personal-center',name:'个人中心'},{id:'token-one',name:'Token One'}]);t.after(kernel.close);
  let status = 'disabled', enabled = true;
  const db = {
    scopeGrant: { findMany: async () => [] },
    application: { findUnique: async () => ({ name: '应用', enabled }) },
    user: { findUnique: async () => ({ status }) },
    applicationUser: { findUnique: async () => ({ enabled: true, localUserId: null }) },
    userRole: { findMany: async () => [] },
  };
  assert.equal((await applicationAccess(db, 'u', 'personal-center')).effective, false);
  status = 'active'; enabled = false;
  kernel.applications.get('token-one').enabled=false;
  assert.equal((await applicationAccess(db, 'u', 'token-one')).effective, false);
  enabled = true;
  kernel.applications.get('token-one').enabled=true;
  assert.equal((await applicationAccess(db, 'u', 'token-one')).effective, true);
});

test('固定基础入口与服务家族不把 identity 或控制台误认为免授权应用', () => {
  assert.equal(isFoundationApplication('identity'), false);
  assert.equal(isFoundationApplication('token-one-console'), false);
  assert.equal(isFoundationApplication('personal-center'), true);
  assert.equal(isFoundationApplication('app-manager'), false);
  assert.equal(isFoundationApplication(process.env.IDENTITY_DESKTOP_CLIENT_ID || 'desktop-one'), true);
  assert.equal(canInspectAudience('token-one', 'token-one-console'), true);
  assert.equal(canInspectAudience('token-one', 'expert-database'), false);
  assert.equal(canInspectAudience('expert-database', 'token-one'), false);
});

test('统一桌面是平台登录客户端，不要求应用登记且不进入应用列表', async t => {
  const kernel=await kernelFixture([{id:'document-one',name:'在线文档'}]);t.after(kernel.close);
  const db = {
    scopeGrant: { findMany: async () => [] },
    user: { findUnique: async () => ({ status: 'active' }) },
    applicationUser: { findUnique: async () => null },
    userRole: { findMany: async () => [] },
  };
  const desktop=await applicationAccess(db,'u',process.env.IDENTITY_DESKTOP_CLIENT_ID || 'desktop-one');
  assert.deepEqual({name:desktop.name,enabled:desktop.enabled,effective:desktop.effective},{name:'统一桌面',enabled:true,effective:true});
  assert.deepEqual((await effectiveApplications(db,'u')).map(item=>item.clientId),['document-one']);
});

test('平台管理员权限只由角色稳定 key 派生，显示名和废弃系统身份不参与判定', () => {
  assert.equal(compatibilityRole([{name:'平台管理员',key:null}]), 'member');
  assert.equal(compatibilityRole([{name:'任何显示名',key:PLATFORM_ADMIN_KEY}]), 'system_admin');
  assert.equal(compatibilityRole([]), 'member');
});
