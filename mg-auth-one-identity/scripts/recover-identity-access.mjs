import { PLATFORM_ADMIN_KEY } from '../dist/platform-role.js';
import { PrismaClient } from '@prisma/client';
// 离线运维恢复工具；不会创建管理员、修改密码或向普通用户提权。
if (!process.env.DATABASE_URL || process.argv[2] !== '--grant-existing-admin' || !process.argv[3]) {
  throw new Error('请显式注入目标 DATABASE_URL，并使用 --grant-existing-admin <已启用管理员的用户名>');
}
const prisma = new PrismaClient();
try {
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(741028)::text`;
    const user = await tx.user.findUnique({ where: { username: process.argv[3] }, include: { roles: { include: { role: true } } } });
    if (!user || !user.roles.some(m => m.role.key === PLATFORM_ADMIN_KEY) || user.status !== 'active') throw new Error('仅可恢复现有启用平台管理员的统一身份应用访问');
    await tx.application.upsert({ where: { clientId: 'identity' }, create: { clientId: 'identity', name: '统一身份' }, update: { enabled: true } });
    await tx.applicationUser.upsert({ where: { clientId_userId: { clientId: 'identity', userId: user.id } }, create: { clientId: 'identity', userId: user.id, enabled: true }, update: { enabled: true } });
    await tx.auditLog.create({ data: { actorName: '离线运维恢复', actorRole: 'operator', action: 'identity.access_recovered', targetType: 'User', targetId: user.id, detail: { clientId: 'identity' } } });
  });
  console.log('已恢复该管理员的统一身份应用直接授权，恢复操作已记录审计。');
} finally { await prisma.$disconnect(); }
