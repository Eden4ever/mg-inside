import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';
import { DIVISION_ADMIN_KEY, ORGANIZATION_ADMIN_KEY } from './platform-role';
type Database = PrismaClient | Prisma.TransactionClient;
export const scopeInclude = { division: true, organization: true, administrators: { select: { userId: true } }, applications: { include: { application: true } } } as const;
export type Scope = Prisma.ManagementScopeGetPayload<{ include: typeof scopeInclude }>;
export function ids(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100 || value.some(id => typeof id !== 'string' || !id || id.length > 100) || new Set(value).size !== value.length) throw new BadRequestException('关联列表无效，最多 100 项且不能重复。');
  return value;
}
export async function scopeMemberWhere(db: Database, scope: { divisionId: string | null; organizationId: string | null }): Promise<Prisma.UserWhereInput> {
  if (scope.organizationId) return { organizations: { some: { organizationId: scope.organizationId, organization: { enabled: true } } } };
  const rows = await db.division.findMany({ select: { id: true, parentId: true, enabled: true } });
  const root = rows.find(d => d.id === scope.divisionId && d.enabled);
  const selected = root ? [root.id] : [];
  for (let i = 0; i < selected.length; i++) for (const row of rows) if (row.enabled && row.parentId === selected[i] && !selected.includes(row.id)) selected.push(row.id);
  return { organizations: { some: { organization: { enabled: true, divisionId: { in: selected } } } } };
}
export async function requireScope(db: Database, userId: string, platform: boolean, scope: Scope) {
  if (platform) return;
  const key = scope.divisionId ? DIVISION_ADMIN_KEY : ORGANIZATION_ADMIN_KEY;
  if (!(scope.division?.enabled ?? scope.organization?.enabled) || !scope.administrators.some(a => a.userId === userId)
    || !await db.userRole.count({ where: { userId, role: { key } } })) throw new ForbiddenException('无此区划或机构的管理权限。');
}
export async function replaceOrganizations(tx: Prisma.TransactionClient, userId: string, value: unknown) {
  if (!Array.isArray(value) || value.length > 100) throw new BadRequestException('所属机构列表无效。');
  const memberships = value.map(item => {
    if (!item || typeof item !== 'object' || Object.keys(item).some(k => !['organizationId','isPrimary'].includes(k)) || typeof item.organizationId !== 'string' || typeof item.isPrimary !== 'boolean') throw new BadRequestException('所属机构参数无效。');
    return { userId, organizationId: item.organizationId as string, isPrimary: item.isPrimary as boolean };
  });
  ids(memberships.map(m => m.organizationId));
  if (memberships.length && memberships.filter(m => m.isPrimary).length !== 1) throw new BadRequestException('请选择且仅选择一个主机构。');
  const previous = await tx.userOrganization.findMany({ where: { userId } });
  const organizations = await tx.organization.findMany({ where: { id: { in: memberships.map(m => m.organizationId) } } });
  if (organizations.length !== memberships.length || organizations.some(o => !o.enabled && !previous.some(m => m.organizationId === o.id))) throw new ConflictException('机构不存在或已停用，不能新增关联。');
  await tx.userOrganization.deleteMany({ where: { userId } });
  if (memberships.length) await tx.userOrganization.createMany({ data: memberships });
  // 归属改变后移除旧范围授权，重新加入机构也不会恢复旧权限。
  const grants = await tx.scopeGrant.findMany({ where: { userId }, include: { scopeApplication: { include: { scope: true } } } });
  for (const grant of grants) if (!await tx.user.count({ where: { id: userId, AND: await scopeMemberWhere(tx, grant.scopeApplication.scope) } })) {
    await tx.scopeGrant.delete({ where: { scopeId_clientId_userId: { scopeId: grant.scopeId, clientId: grant.clientId, userId } } });
  }
  return { before: previous.map(({organizationId,isPrimary}) => ({organizationId,isPrimary})), after: memberships.map(({organizationId,isPrimary}) => ({organizationId,isPrimary})) };
}
