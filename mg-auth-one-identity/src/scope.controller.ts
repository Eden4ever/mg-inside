import { Body, ConflictException, Controller, Get, Inject, NotFoundException, Param, Put, Req } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { actorFromRequest, requireRole, type AuthenticatedRequest } from './auth';
import { isFoundationApplication, lockAuthorization, ensureIdentityAdministrator } from './application-access';
import { ids, requireScope, scopeInclude, scopeMemberWhere } from './scope-access';
import { DIVISION_ADMIN_KEY, ORGANIZATION_ADMIN_KEY } from './platform-role';
import { kernelApplications, kernelApplication, applicationReference } from './kernel-applications';

@Controller('scopes')
export class ScopeController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  @Get() async list(@Req() req: AuthenticatedRequest) {
    const actor = actorFromRequest(req);
    const scopes = await this.prisma.managementScope.findMany({ include: scopeInclude });
    const result = [];
    const applications=await kernelApplications();
    for (const scope of scopes) {
      try { await requireScope(this.prisma, actor.userId, actor.role === 'system_admin', scope); } catch { continue; }
      result.push({...scope,applications:scope.applications.map(a=>({...a,application:applications.find(item=>item.id===a.clientId) || {id:a.clientId,name:a.clientId,enabled:false}}))});
    }
    return result;
  }
  @Put(':kind/:id') async configure(@Param('kind') kind: string, @Param('id') id: string, @Body() body: { clientIds?: unknown; administratorIds?: unknown }, @Req() req: AuthenticatedRequest) {
    const actor = actorFromRequest(req); requireRole(actor, ['system_admin']);
    if (!['division','organization'].includes(kind) || !body || Object.keys(body).some(k => !['clientIds','administratorIds'].includes(k))) throw new ConflictException('范围参数无效。');
    const clientIds = ids(body.clientIds), administratorIds = ids(body.administratorIds);
    return this.prisma.$transaction(async tx => {
      await lockAuthorization(tx); await tx.$queryRaw`SELECT pg_advisory_xact_lock(741029)::text`;
      const target = kind === 'division' ? await tx.division.findUnique({ where: { id } }) : await tx.organization.findUnique({ where: { id } });
      if (!target) throw new NotFoundException('管理范围不存在。');
      if (clientIds.some(isFoundationApplication)) throw new ConflictException('基础应用无需配置授权。');
      for(const clientId of clientIds)if((await applicationReference(tx,clientId)).kind==='default')throw new ConflictException('基础应用无需配置授权。');
      const key = kind === 'division' ? DIVISION_ADMIN_KEY : ORGANIZATION_ADMIN_KEY;
      if (await tx.user.count({ where: { id: { in: administratorIds }, status: 'active', roles: { some: { role: { key } } } } }) !== administratorIds.length) throw new ConflictException('管理员必须启用且已分配对应的默认角色。');
      const where = kind === 'division' ? { divisionId: id } : { organizationId: id };
      const previous = await tx.managementScope.findUnique({ where, include: scopeInclude });
      const scope = await tx.managementScope.upsert({ where, create: where, update: {} });
      await tx.scopeApplication.deleteMany({ where: { scopeId: scope.id, clientId: { notIn: clientIds } } });
      await tx.scopeApplication.createMany({ data: clientIds.map(clientId => ({ scopeId: scope.id, clientId })), skipDuplicates: true });
      await tx.scopeAdministrator.deleteMany({ where: { scopeId: scope.id } });
      await tx.scopeAdministrator.createMany({ data: administratorIds.map(userId => ({ scopeId: scope.id, userId })) });
      await ensureIdentityAdministrator(tx);
      await tx.auditLog.create({ data: { actorUserId: actor.userId, actorName: actor.name, actorRole: actor.role, action: 'scope.configured', targetType: 'ManagementScope', targetId: scope.id, detail: { before: { clientIds: previous?.applications.map(a => a.clientId) || [], administratorIds: previous?.administrators.map(a => a.userId) || [] }, after: {clientIds, administratorIds} } } });
      return tx.managementScope.findUniqueOrThrow({ where: { id: scope.id }, include: scopeInclude });
    });
  }
  @Get(':id/members') async members(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const actor = actorFromRequest(req), scope = await this.prisma.managementScope.findUnique({ where: { id }, include: scopeInclude });
    if (!scope) throw new NotFoundException('管理范围不存在。');
    await requireScope(this.prisma, actor.userId, actor.role === 'system_admin', scope);
    return this.prisma.user.findMany({ where: await scopeMemberWhere(this.prisma, scope), select: { id: true, displayName: true, username: true, status: true, scopeGrants: { where: { scopeId: id }, select: { clientId: true } } }, orderBy: { displayName: 'asc' } });
  }
  @Put(':id/applications/:clientId/users/:userId') async grant(@Param('id') id: string, @Param('clientId') clientId: string, @Param('userId') userId: string, @Body() body: { enabled?: unknown }, @Req() req: AuthenticatedRequest) {
    const actor = actorFromRequest(req);
    if (!body || typeof body.enabled !== 'boolean' || Object.keys(body).some(k => k !== 'enabled')) throw new ConflictException('授权参数无效。');
    return this.prisma.$transaction(async tx => {
      await lockAuthorization(tx); await tx.$queryRaw`SELECT pg_advisory_xact_lock(741029)::text`;
      const scope = await tx.managementScope.findUnique({ where: { id }, include: scopeInclude });
      if (!scope) throw new NotFoundException('管理范围不存在。');
      await requireScope(tx, actor.userId, actor.role === 'system_admin', scope);
      if (!(scope.division?.enabled ?? scope.organization?.enabled) || !scope.applications.some(a => a.clientId === clientId) || !(await kernelApplication(clientId))?.enabled) throw new ConflictException('应用不在当前范围的可配置清单内或范围已停用。');
      if (!await tx.user.count({ where: { id: userId, AND: await scopeMemberWhere(tx, scope) } })) throw new ConflictException('用户不属于当前管理范围。');
      const data = { scopeId: id, clientId, userId };
      if (body.enabled) {
        await tx.scopeGrant.upsert({ where: { scopeId_clientId_userId: data }, create: data, update: {} });
        await tx.applicationUser.createMany({ data: [{ clientId, userId, enabled: false }], skipDuplicates: true });
      } else await tx.scopeGrant.deleteMany({ where: data });
      await ensureIdentityAdministrator(tx);
      await tx.auditLog.create({ data: { actorUserId: actor.userId, actorName: actor.name, actorRole: actor.role, action: 'scope.application', targetType: 'ManagementScope', targetId: id, detail: { clientId, userId, enabled: Boolean(body.enabled) } } });
      return { ...data, enabled: body.enabled };
    });
  }
}
