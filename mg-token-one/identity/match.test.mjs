import test from 'node:test';
import assert from 'node:assert/strict';
import { preview } from './match.mjs';
const user = (extra = {}) => ({ id: 7, name: ' 张三 ', role: 'user', source: 'zentao', active: true, identities: [], ...extra });
const input = (extra = {}) => ({ corpId: 'corp', members: [{ userId: 'w1', name: '张三', active: true }], tokenUsers: [user()], expertUsers: [], revocations: [], ...extra });
test('唯一姓名仅生成候选，并保留原 ID、原对象', () => {
  const data = input(); const original = structuredClone(data);
  assert.equal(preview(data).rows[0].status, 'candidate');
  assert.equal(preview(data).rows[0].localUserId, '7'); assert.deepEqual(data, original);
});
test('通讯录同名、本地同名、身份重复均拒绝', () => {
  for (const extra of [
    { members: [{ userId: 'w1', name: '张三', active: true }, { userId: 'w2', name: '张三', active: true }] },
    { tokenUsers: [user(), user({ id: 8 })] },
    { members: [{ userId: 'w1', name: '张三', active: true }, { userId: 'w1', name: '李四', active: true }] },
  ]) assert.equal(preview(input(extra)).rows[0].status, 'conflict');
});
test('管理员及本地账号只能人工核实', () => {
  for (const extra of [{ role: 'admin' }, { role: 'system_admin' }, { source: 'local' }])
    assert.equal(preview(input({ tokenUsers: [user(extra)] })).rows[0].status, 'manual');
});
test('已绑定身份优先于改名；停用及撤销均阻断', () => {
  const bound = user({ name: '旧姓名', identities: [{ corpId: 'corp', userId: 'w1' }] });
  assert.equal(preview(input({ tokenUsers: [bound] })).rows[0].status, 'bound');
  assert.equal(preview(input({ tokenUsers: [{ ...bound, active: false }] })).rows[0].status, 'blocked');
  assert.equal(preview(input({ tokenUsers: [bound], revocations: [{ corpId: 'corp', userId: 'w1' }] })).rows[0].status, 'blocked');
});
test('跨企业身份不按姓名重绑；已有绑定不能被第二账号抢占', () => {
  assert.equal(preview(input({ tokenUsers: [user({ identities: [{ corpId: 'other', userId: 'w1' }] })] })).rows[0].status, 'conflict');
  const result = preview(input({ tokenUsers: [user(), user({ id: 8, name: '旧名', identities: [{ corpId: 'corp', userId: 'w1' }] })] }));
  assert.equal(result.rows[0].status, 'conflict');
});
test('无姓名或未匹配不建号；不接受不完整输入', () => {
  assert.equal(preview(input({ tokenUsers: [user({ name: '' })] })).rows[0].status, 'unmatched');
  assert.throws(() => preview({}), /缺少完整数据集/);
});
