import { ensurePlatformAdministratorRole } from '../dist/platform-role.js';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../dist/password.js';
import { applicationReference } from '../dist/kernel-applications.js';
const prisma = new PrismaClient();
try {
  const username = process.env.IDENTITY_BOOTSTRAP_USERNAME || '';
  const password = process.env.IDENTITY_BOOTSTRAP_PASSWORD || '';
  const displayName = process.env.IDENTITY_BOOTSTRAP_NAME || '平台管理员';
  if (!/^[a-z0-9._-]{3,50}$/.test(username) || password.length < 15 || password.length > 128) throw new Error('请注入初始化管理员账号和至少 15 位密码');
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`LOCK TABLE "User" IN EXCLUSIVE MODE`;
    if (await tx.user.count()) throw new Error('已有用户，禁止重复初始化');
    const user = await tx.user.create({ data: { username, displayName, passwordHash: await hashPassword(password) } });
    const role = await ensurePlatformAdministratorRole(tx);
    await tx.userRole.create({ data: { userId: user.id, roleId: role.id } });
    await applicationReference(tx,'identity');
    await tx.applicationUser.create({ data: { clientId: 'identity', userId: user.id, enabled: true } });
    await tx.auditLog.create({ data: { actorUserId: user.id, actorName: displayName, actorRole: 'system_admin', action: 'identity.bootstrap', targetType: 'User', targetId: user.id, detail: {} } });
  });
  console.log('初始化管理员已创建；请从运行配置移除初始化密码');
} catch { console.error('初始化失败：请检查注入配置，且仅允许空身份数据库'); process.exitCode = 1; }
finally { await prisma.$disconnect(); }
