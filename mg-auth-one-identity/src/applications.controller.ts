import { Body, Controller, Get, Inject, Param, Put, Req, ConflictException } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { actorFromRequest, requireRole, FoundationIdentity, type AuthenticatedRequest } from './auth';
import { effectiveApplications, applicationAccess, ensureIdentityAdministrator, isFoundationApplication, lockAuthorization } from './application-access';

@Controller('applications')
export class ApplicationsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  @FoundationIdentity() @Get('mine')
  async mine(@Req() req: AuthenticatedRequest) {
    const actor = actorFromRequest(req);
    const links: Record<string, string> = { 'token-one': 'https://token.meta-gravity.com', 'expert-database': 'https://yshj.meta-gravity.com/knowledge-base-inside' };
    const rows = await effectiveApplications(this.prisma, actor.userId);
    return rows.filter(row => row.effective).map(row => ({ ...row, url: process.env.NODE_ENV === 'production' ? links[row.clientId] || null : null }));
  }
  @Get('users/:userId')
  async forUser(@Param('userId') userId: string, @Req() req: AuthenticatedRequest) {
    requireRole(actorFromRequest(req), ['system_admin']);
    if (!await this.prisma.user.findUnique({ where: { id: userId } })) throw new ConflictException('用户不存在。');
    return effectiveApplications(this.prisma, userId);
  }
  @Get()
  async list(@Req() req: AuthenticatedRequest) {
    requireRole(actorFromRequest(req), ['system_admin']);
    const applications = await this.prisma.application.findMany({ include: { memberships: { select: { userId: true, localUserId: true, enabled: true } } } });
    return applications.map(app => ({ ...app, foundation: isFoundationApplication(app.clientId) }));
  }
  @Put(':clientId/users/:userId')
  async grant(@Param('clientId') clientId: string, @Param('userId') userId: string,
    @Body() body: { localUserId?: string | null; enabled?: boolean }, @Req() req: AuthenticatedRequest) {
    const actor = actorFromRequest(req); requireRole(actor, ['system_admin']);
    if (!body || isFoundationApplication(clientId) || (body.localUserId != null && (typeof body.localUserId !== 'string' || body.localUserId.length > 128)) || typeof body.enabled !== 'boolean')
      throw new ConflictException('应用授权参数无效');
    const localUserId = body.localUserId?.trim() || null;
    return this.prisma.$transaction(async tx => {
      await lockAuthorization(tx);
      const app = await tx.application.findUnique({ where: { clientId } });
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!app || !user) throw new ConflictException('应用或用户不存在');
      const existing = await tx.applicationUser.findUnique({ where: { clientId_userId: { clientId, userId } } });
      if (existing && body.localUserId !== undefined && existing.localUserId !== localUserId) throw new ConflictException('不允许覆盖原账号映射，请先核实并单独迁移');
      const result = await tx.applicationUser.upsert({ where: { clientId_userId: { clientId, userId } },
        create: { clientId, userId, localUserId, enabled: body.enabled }, update: { enabled: body.enabled } });
      await ensureIdentityAdministrator(tx);
      await tx.auditLog.create({ data: { actorUserId: actor.userId, actorName: actor.name, actorRole: actor.role,
        action: 'application.membership', targetType: 'Application', targetId: clientId, detail: { userId, localUserId: body.localUserId, enabled: body.enabled } } });
      return { ...result, ...(await applicationAccess(tx, userId, clientId)) };
    });
  }
}
