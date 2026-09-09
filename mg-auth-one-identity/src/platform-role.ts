import { ConflictException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';

type Database = PrismaClient | Prisma.TransactionClient;
export const PLATFORM_ADMIN_KEY = 'platform-admin';
export type RoleSummary = { id: string; key: string | null; name: string };
export const roleSelection = { id: true, key: true, name: true } as const;
export const compatibilityRole = (roles: Array<{ key?: string | null }>): 'system_admin' | 'member' =>
  roles.some(role => role.key === PLATFORM_ADMIN_KEY) ? 'system_admin' : 'member';

/** 只初始化角色，不从废弃列重复导入成员，也不自动授予应用访问。 */
export async function ensurePlatformAdministratorRole(db: Database) {
  return db.role.upsert({ where: { key: PLATFORM_ADMIN_KEY },
    create: { key: PLATFORM_ADMIN_KEY, name: '平台管理员', description: '管理平台用户、角色、应用授权和认证配置；应用访问仍需显式授权。' }, update: {} });
}
export async function userRoles(db: Database, userId: string): Promise<RoleSummary[]> {
  return (await db.userRole.findMany({ where: { userId }, include: { role: { select: roleSelection } }, orderBy: { roleId: 'asc' } })).map(m => m.role);
}
export function validateRoleIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100 || value.some(id => typeof id !== 'string') || new Set(value).size !== value.length) throw new ConflictException('角色列表无效。');
  return value;
}
/** 调用者须持有授权事务锁，并在写入完成后检查最后管理员。 */
export async function replaceUserRoles(db: Database, userId: string, roleIds: string[]) {
  if (await db.role.count({ where: { id: { in: roleIds } } }) !== roleIds.length) throw new ConflictException('角色不存在。');
  await db.userRole.deleteMany({ where: { userId, roleId: { notIn: roleIds } } });
  await db.userRole.createMany({ data: roleIds.map(roleId => ({ userId, roleId })), skipDuplicates: true });
  const grants = await db.roleApplication.findMany({ where: { roleId: { in: roleIds }, enabled: true } });
  await db.applicationUser.createMany({ data: grants.map(g => ({ clientId: g.clientId, userId, enabled: false })), skipDuplicates: true });
}
