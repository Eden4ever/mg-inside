import test from 'node:test';
import assert from 'node:assert/strict';
import { RolesController } from '../dist/roles.controller.js';
import { AuthService } from '../dist/auth.js';

// 模拟只有一名可管理平台的账号，执行真实事务处理器；不临时停用本地演示账号。
function lastAdministratorDatabase() {
  let state = { member: true, status: 'active' };
  const role = { id: 'builtin', key: 'platform-admin', name: '平台管理员' };
  const tx = {
    $queryRaw: async () => [],
    role: { count: async ({ where }) => where.id.in.length, findUnique: async () => role },
    user: {
      findUnique: async () => ({ id: 'last-admin', displayName: '最后管理员', status: state.status, role: 'member' }),
      findMany: async ({ where }) => { assert.equal(where.roles.some.role.key, role.key); return state.member && state.status === 'active' ? [{ id: 'last-admin' }] : []; },
      update: async ({ data }) => { state.status = data.status; return { id: 'last-admin', ...data }; },
    },
    userRole: {
      findMany: async () => state.member ? [{ roleId: role.id, role }] : [],
      deleteMany: async () => { state.member = false; },
      createMany: async ({ data }) => { state.member = data.some(m => m.roleId === role.id); },
    },
    roleApplication: { findMany: async () => [] },
    applicationUser: { createMany: async () => {} },
  };
  return { ...tx, state: () => state, $transaction: async callback => {
    const before = { ...state };
    try { return await callback(tx); } catch (error) { state = before; throw error; }
  } };
}

test('角色成员移除、角色多选清空和账号停用均保护最后一位平台管理员并回滚', async () => {
  const db = lastAdministratorDatabase(), controller = new RolesController(db);
  const request = { user: { userId: 'another-admin', name: '管理操作', role: 'system_admin' }, headers: {} };
  const denied = error => error.getStatus() === 409 && error.message.includes('平台管理员');
  await assert.rejects(() => controller.member('builtin', 'last-admin', { enabled: false }, request), denied);
  assert.deepEqual(db.state(), { member: true, status: 'active' });
  await assert.rejects(() => controller.assignUserRoles('last-admin', { roleIds: [] }, request), denied);
  assert.deepEqual(db.state(), { member: true, status: 'active' });
  const auth = new AuthService(db, {}, {});
  await assert.rejects(() => auth.updateUser('last-admin', { status: 'disabled' }, request.user), denied);
  assert.deepEqual(db.state(), { member: true, status: 'active' });
});
