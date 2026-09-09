import { ConflictException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';
import { PLATFORM_ADMIN_KEY } from './platform-role';

type Database = PrismaClient | Prisma.TransactionClient;
export type AuthorizationSource = { type: 'user' } | { type: 'role'; roleId: string; name: string };
export const isFoundationApplication = (clientId: string) => ['personal-center', 'files', process.env.IDENTITY_DESKTOP_CLIENT_ID || 'desktop-one'].includes(clientId);
export const tokenAudiences = ['token-one', 'token-one-console', 'token-one-docs'];
export function knownAudience(clientId: string, clients: Array<{ client_id: string }>) {
  return ['identity', 'personal-center', 'files', 'app-manager', 'office-one'].includes(clientId) || clients.some(c => c.client_id === clientId)
    || tokenAudiences.includes(clientId) && clients.some(c => c.client_id === 'token-one');
}
export function canInspectAudience(caller: string, target: string) {
  return caller === (process.env.IDENTITY_DESKTOP_CLIENT_ID || 'desktop-one') || caller === target
    || caller === 'token-one' && tokenAudiences.includes(target)
    || caller === 'files' && target === 'office-one';
}

/** 每次读取有效授权，不缓存；直授权撤销不抵消仍存在的角色来源。 */
export async function applicationAccess(db: Database, userId: string, clientId: string) {
  const [application, user, direct, memberships] = await Promise.all([
    db.application.findUnique({ where: { clientId } }),
    db.user.findUnique({ where: { id: userId }, select: { status: true } }),
    db.applicationUser.findUnique({ where: { clientId_userId: { clientId, userId } } }),
    db.userRole.findMany({ where: { userId, role: { applications: { some: { clientId, enabled: true } } } }, include: { role: true }, orderBy: { roleId: 'asc' } }),
  ]);
  const sources: AuthorizationSource[] = [
    ...(direct?.enabled ? [{ type: 'user' as const }] : []),
    ...memberships.map(m => ({ type: 'role' as const, roleId: m.roleId, name: m.role.name })),
  ];
  return { clientId, name: application?.name || clientId, enabled: Boolean(application?.enabled),
    direct: Boolean(direct?.enabled), localUserId: direct?.localUserId ?? null, sources,
    foundation: isFoundationApplication(clientId),
    effective: Boolean(application?.enabled && user?.status === 'active' && (sources.length || isFoundationApplication(clientId))) };
}

export async function effectiveApplications(db: Database, userId: string) {
  const applications = await db.application.findMany({ orderBy: { name: 'asc' } });
  return Promise.all(applications.map(a => applicationAccess(db, userId, a.clientId)));
}

// 所有授权写操作及管理员身份变更共用事务锁，避免并发撤销最后两份管理权限。
export async function lockAuthorization(db: Database) { await db.$queryRaw`SELECT pg_advisory_xact_lock(741028)::text`; }
export async function ensureIdentityAdministrator(db: Database) {
  const admins = await db.user.findMany({ where: { status: 'active', roles: { some: { role: { key: PLATFORM_ADMIN_KEY } } } }, select: { id: true } });
  for (const admin of admins) if ((await applicationAccess(db, admin.id, 'identity')).effective) return;
  throw new ConflictException('必须保留至少一位已获统一身份认证应用授权的启用平台管理员。请先为另一位平台管理员授权。');
}
