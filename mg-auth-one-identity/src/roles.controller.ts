import { Body, ConflictException, Controller, Delete, Get, Inject, Param, Patch, Post, Put, Req } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { actorFromRequest, requireRole, type Actor, type AuthenticatedRequest } from './auth';
import { ensureIdentityAdministrator, isFoundationApplication, lockAuthorization } from './application-access';
import { PLATFORM_ADMIN_KEY, replaceUserRoles, validateRoleIds } from './platform-role';

@Controller('roles')
export class RolesController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  private actor(req: AuthenticatedRequest) { const actor = actorFromRequest(req); requireRole(actor, ['system_admin']); return actor; }
  private async audit(tx: Prisma.TransactionClient, actor: Actor, action: string, targetId: string, detail: Prisma.InputJsonObject) {
    await tx.auditLog.create({ data: { actorUserId: actor.userId, actorName: actor.name, actorRole: actor.role, action, targetType: 'Role', targetId, detail } });
  }
  private details(body: { name?: unknown; description?: unknown }) {
    if (body && 'key' in body) throw new ConflictException('内置角色标识不可由接口设置。');
    if (typeof body?.name !== 'string' || !body.name.trim() || body.name.trim().length > 80
      || body.description !== undefined && (typeof body.description !== 'string' || body.description.length > 500)) throw new ConflictException('角色名称为 1–80 个字符，说明最多 500 个字符。');
    return { name: body.name.trim(), description: typeof body.description === 'string' ? body.description.trim() : '' };
  }
  @Get() async list(@Req() req: AuthenticatedRequest) {
    this.actor(req);
    return this.prisma.role.findMany({ orderBy: { name: 'asc' }, include: {
      members: { select: { userId: true } }, applications: { select: { clientId: true, enabled: true } },
    } });
  }
  @Post() async create(@Body() body: { name?: unknown; description?: unknown }, @Req() req: AuthenticatedRequest) {
    const actor = this.actor(req), data = this.details(body);
    try { return await this.prisma.$transaction(async tx => {
      const role = await tx.role.create({ data }); await this.audit(tx, actor, 'role.created', role.id, data); return role;
    }); } catch (e) { if ((e as { code?: string }).code === 'P2002') throw new ConflictException('角色名称已存在。'); throw e; }
  }
  @Put('users/:userId') async assignUserRoles(@Param('userId') userId: string, @Body() body: { roleIds?: unknown }, @Req() req: AuthenticatedRequest) {
    const actor = this.actor(req), ids = validateRoleIds(body?.roleIds);
    return this.prisma.$transaction(async tx => {
      await lockAuthorization(tx);
      if (!await tx.user.findUnique({ where: { id: userId } }) || await tx.role.count({ where: { id: { in: ids } } }) !== ids.length) throw new ConflictException('用户或角色不存在。');
      await replaceUserRoles(tx, userId, ids);
      await ensureIdentityAdministrator(tx);
      await this.audit(tx, actor, 'user.roles', userId, { roleIds: ids }); return { userId, roleIds: ids };
    });
  }
  @Patch(':roleId') async update(@Param('roleId') roleId: string, @Body() body: { name?: unknown; description?: unknown }, @Req() req: AuthenticatedRequest) {
    const actor = this.actor(req), data = this.details(body);
    try { return await this.prisma.$transaction(async tx => {
      await lockAuthorization(tx);
      const existing = await tx.role.findUnique({ where: { id: roleId } });
      if (!existing) throw new ConflictException('角色不存在。');
      if (existing.key === PLATFORM_ADMIN_KEY && data.name !== existing.name) throw new ConflictException('内置平台管理员角色不可更名。');
      const role = await tx.role.update({ where: { id: roleId }, data }); await this.audit(tx, actor, 'role.updated', roleId, data); return role;
    }); } catch (e) { if ((e as { code?: string }).code === 'P2002') throw new ConflictException('角色名称已存在。'); throw e; }
  }
  @Delete(':roleId') async remove(@Param('roleId') roleId: string, @Req() req: AuthenticatedRequest) {
    const actor = this.actor(req);
    return this.prisma.$transaction(async tx => {
      await lockAuthorization(tx);
      const role = await tx.role.findUnique({ where: { id: roleId }, include: { _count: { select: { members: true, applications: { where: { enabled: true } } } } } });
      if (!role) throw new ConflictException('角色不存在。');
      if (role.key === PLATFORM_ADMIN_KEY) throw new ConflictException('平台管理员是内置角色，不可删除。');
      if (role._count.members || role._count.applications) throw new ConflictException('请先移除全部成员并撤销角色的应用授权，再删除角色。');
      await tx.roleApplication.deleteMany({ where: { roleId } });
      await tx.role.delete({ where: { id: roleId } });
      await this.audit(tx, actor, 'role.deleted', roleId, { name: role.name }); return { deleted: true };
    });
  }
  @Put(':roleId/members/:userId') async member(@Param('roleId') roleId: string, @Param('userId') userId: string,
    @Body() body: { enabled?: unknown }, @Req() req: AuthenticatedRequest) {
    const actor = this.actor(req); if (typeof body?.enabled !== 'boolean') throw new ConflictException('成员参数无效。');
    return this.prisma.$transaction(async tx => {
      await lockAuthorization(tx);
      if (!await tx.role.findUnique({ where: { id: roleId } }) || !await tx.user.findUnique({ where: { id: userId } })) throw new ConflictException('角色或用户不存在。');
      if (body.enabled) await tx.userRole.upsert({ where: { userId_roleId: { userId, roleId } }, create: { userId, roleId }, update: {} });
      else await tx.userRole.deleteMany({ where: { userId, roleId } });
      if (body.enabled) {
        const grants = await tx.roleApplication.findMany({ where: { roleId, enabled: true } });
        await tx.applicationUser.createMany({ data: grants.map(g => ({ clientId: g.clientId, userId, enabled: false })), skipDuplicates: true });
      }
      await ensureIdentityAdministrator(tx);
      await this.audit(tx, actor, 'role.member', roleId, { userId, enabled: Boolean(body.enabled) }); return { userId, roleId, enabled: Boolean(body.enabled) };
    });
  }
  @Put(':roleId/applications/:clientId') async grant(@Param('roleId') roleId: string, @Param('clientId') clientId: string,
    @Body() body: { enabled?: unknown }, @Req() req: AuthenticatedRequest) {
    const actor = this.actor(req); if (typeof body?.enabled !== 'boolean' || isFoundationApplication(clientId)) throw new ConflictException('应用授权参数无效，基础应用无需分配授权。');
    return this.prisma.$transaction(async tx => {
      await lockAuthorization(tx);
      if (!await tx.role.findUnique({ where: { id: roleId } }) || !await tx.application.findUnique({ where: { clientId } })) throw new ConflictException('角色或应用不存在。');
      const result = await tx.roleApplication.upsert({ where: { roleId_clientId: { roleId, clientId } }, create: { roleId, clientId, enabled: Boolean(body.enabled) }, update: { enabled: Boolean(body.enabled) } });
      if (body.enabled) {
        const members = await tx.userRole.findMany({ where: { roleId } });
        await tx.applicationUser.createMany({ data: members.map(m => ({ clientId, userId: m.userId, enabled: false })), skipDuplicates: true });
      }
      await ensureIdentityAdministrator(tx);
      await this.audit(tx, actor, 'role.application', roleId, { clientId, enabled: Boolean(body.enabled) }); return result;
    });
  }
}
