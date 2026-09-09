import { compatibilityRole, userRoles } from '../dist/platform-role.js';
import fs from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';

// 一次性空中心导入：只创建中心身份和经审核的原账号映射，不连接业务数据库。
const prisma = new PrismaClient({ log: [] });
try {
  if (process.env.IDENTITY_IMPORT_REVIEWED !== 'true') throw new Error('必须明确指定已核对清单');
  const plan = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
  if (!plan.review || !Array.isArray(plan.users) || !plan.users.length) throw new Error('缺少审核记录');
  const names = new Set(), identities = new Set(), memberships = new Set(), zentao = new Set();
  for (const user of plan.users) {
    if (!user.displayName?.trim() || user.displayName !== user.displayName.trim() || names.has(user.displayName)) throw new Error('姓名不唯一');
    names.add(user.displayName);
    if (user.corpId !== process.env.WECOM_CORP_ID || !user.externalUserId || identities.has(user.externalUserId)) throw new Error('企微身份不唯一或企业不符');
    identities.add(user.externalUserId);
    if (!Array.isArray(user.memberships) || !user.memberships.length) throw new Error('缺少原应用账号');
    const apps = new Set();
    for (const membership of user.memberships) {
      const key = JSON.stringify([membership.clientId, membership.localUserId]);
      if (!membership.clientId || typeof membership.localUserId !== 'string' || !membership.localUserId || memberships.has(key) || apps.has(membership.clientId)) throw new Error('原应用映射冲突');
      memberships.add(key); apps.add(membership.clientId);
    }
    for (const account of user.zentaoAccounts || []) {
      if (typeof account !== 'string' || !account || zentao.has(account)) throw new Error('禅道账号冲突');
      zentao.add(account);
    }
    if ((user.zentaoAccounts || []).length > 1) throw new Error('一个身份只能绑定一个禅道账号');
  }
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`LOCK TABLE "User", "ApplicationUser", "WeComIdentity", "ZentaoIdentity" IN EXCLUSIVE MODE`;
    const admin = await tx.user.findUnique({ where: { username: process.argv[3] || 'identity-admin' } });
    if (!admin || compatibilityRole(await userRoles(tx, admin.id)) !== 'system_admin' || admin.status !== 'active' || await tx.user.count() !== 1 || await tx.applicationUser.count()) throw new Error('仅允许刚初始化且无业务身份的中心导入');
    for (const input of plan.users) {
      const user = await tx.user.create({ data: {
        displayName: input.displayName, role: 'member', authSource: 'wecom', departmentName: input.departmentName || null,
        wecomIdentities: { create: { corpId: input.corpId, externalUserId: input.externalUserId } },
        applications: { create: input.memberships.map(m => ({ ...m, enabled: true })) },
        zentaoIdentities: { create: (input.zentaoAccounts || []).map(account => ({ server: process.env.ZENTAO_BASE_URL, account })) },
      } });
      await tx.auditLog.create({ data: { actorUserId: admin.id, actorName: admin.displayName, actorRole: compatibilityRole(await userRoles(tx, admin.id)),
        action: 'identity.reviewed_import', targetType: 'User', targetId: user.id,
        detail: { review: plan.review, reviewedAt: plan.reviewedAt, memberships: input.memberships } } });
    }
  }, { timeout: 30000 });
  console.log(JSON.stringify({ importedUsers: names.size, applicationMappings: memberships.size, zentaoBindings: zentao.size }));
} catch {
  console.error('导入未完成：请核对清单、空库条件和唯一约束；事务失败不会部分写入。');
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }
