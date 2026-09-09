// 仅生成候选关联，不修改任何身份或业务账号。
export function preview(input) {
  for (const key of ['members', 'tokenUsers', 'expertUsers', 'revocations']) {
    if (!Array.isArray(input[key])) throw new Error(`缺少完整数据集：${key}`)
  }
  if (!input.corpId) throw new Error('缺少企业身份范围')
  const normalize = value => String(value || '').trim();
  const members = input.members;
  const apps = { token: input.tokenUsers, expert: input.expertUsers };
  const groups = new Map();
  for (const member of members) {
    const name = normalize(member.name);
    groups.set(name, [...(groups.get(name) || []), member]);
  }
  const rows = [];
  for (const [app, users] of Object.entries(apps)) {
    const ids = users.map(u => String(u.id));
    if (new Set(ids).size !== ids.length) throw new Error(`${app} 数据集包含重复账号 ID`);
    const claims = new Map();
    for (const user of users) for (const identity of user.identities || []) {
      const key = JSON.stringify([identity.corpId, identity.userId]);
      claims.set(key, [...(claims.get(key) || []), String(user.id)]);
    }
    for (const user of users) {
      const name = normalize(user.name);
      const row = { app, localUserId: String(user.id), name, role: user.role, status: '', reason: '' };
      const reject = (status, reason) => Object.assign(row, { status, reason });
      const identities = user.identities || [];
      const localNames = users.filter(u => normalize(u.name) === name);
      const candidates = groups.get(name) || [];
      if (!user.active) reject('blocked', '本地账号已停用');
      else if (identities.length) {
        if (identities.length !== 1 || identities[0].corpId !== input.corpId) {
          reject('conflict', '企业范围不一致或存在多个身份，人工核实');
        } else {
          const identity = identities[0];
          const found = members.filter(m => m.userId === identity.userId);
          if (claims.get(JSON.stringify([identity.corpId, identity.userId])).length !== 1) reject('conflict', '同一企微身份绑定多个本地账号');
          else if (input.revocations.some(r => r.corpId === identity.corpId && r.userId === identity.userId)) reject('blocked', '企微身份存在撤销记录');
          else if (found.length !== 1 || !found[0].active) reject('blocked', '绑定成员缺失、停用或目录身份重复');
          else Object.assign(row, { status: 'bound', reason: '沿用既有稳定身份，不按姓名重新认领', corpId: input.corpId, wecomUserId: identity.userId });
        }
      } else if (!name) reject('unmatched', '姓名为空');
      else if (localNames.length > 1 || candidates.length > 1) reject('conflict', '本地或企微通讯录同名，不自动认领');
      else if (candidates.length !== 1) reject('unmatched', '通讯录无同名成员');
      else {
        const member = candidates[0];
        const key = JSON.stringify([input.corpId, member.userId]);
        if (!member.active || !member.userId) reject('blocked', '成员未启用或缺少稳定身份');
        else if (members.filter(m => m.userId === member.userId).length !== 1) reject('conflict', '目录身份重复');
        else if (claims.has(key)) reject('conflict', '该企微身份已关联其他本地账号');
        else if (input.revocations.some(r => r.corpId === input.corpId && r.userId === member.userId)) reject('blocked', '身份已撤销，不能凭姓名重新关联');
        else Object.assign(row, {
          status: user.role === 'admin' || user.role === 'system_admin' || user.source === 'local' ? 'manual' : 'candidate',
          reason: '姓名唯一匹配，仅供核实；不代表同一人或获得访问授权',
          corpId: input.corpId, wecomUserId: member.userId,
        });
      }
      rows.push(row);
    }
  }
  // 同一应用的多个候选不能认领同一身份，即使名称表示存在差异。
  for (const row of rows.filter(r => r.status === 'candidate' || r.status === 'manual')) {
    if (rows.filter(r => r.app === row.app && r.wecomUserId === row.wecomUserId).length > 1) {
      row.status = 'conflict'; row.reason = '同一应用多个账号争用同一身份';
    }
  }
  const totals = {};
  for (const row of rows) totals[row.status] = (totals[row.status] || 0) + 1;
  return { schemaVersion: 1, generatedAt: new Date().toISOString(), readOnly: true,
    scope: input.scope || '未标明来源，不可用于生产迁移', totals, rows,
    unassignedMembers: members.filter(m => !rows.some(r => r.wecomUserId === m.userId)).map(m => ({ userId: m.userId, name: m.name })),
    notice: '所有候选均须核实后另行执行绑定；无匹配账号不创建，不修改权限、额度和历史数据。' };
}
