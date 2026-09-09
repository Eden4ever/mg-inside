import { BadRequestException, CanActivate, ConflictException, ExecutionContext, ForbiddenException, Inject, Injectable, NotFoundException, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Prisma } from '@prisma/client';
import { actorFromRequest, requireRole, type Actor, type AuthenticatedRequest } from './auth';
import { PrismaService } from './prisma.service';

export const SYSTEM_PERMISSION = 'systemPermission';
export const SYSTEM_PERMISSION_KEYS = ['canView', 'canResearch', 'canManageCatalog', 'canReview', 'canPublish'] as const;
export type SystemPermissionKey = (typeof SYSTEM_PERMISSION_KEYS)[number];
export type SystemRole = 'creator' | 'manager' | 'editor' | 'viewer';
export type SystemPermissions = Record<SystemPermissionKey, boolean> & { systemRole?: SystemRole | null; canManageAccess?: boolean };
export const RequireSystemPermission = (...permissions: SystemPermissionKey[]) => SetMetadata(SYSTEM_PERMISSION, permissions);

const EMPTY_PERMISSIONS: SystemPermissions = { canView: false, canResearch: false, canManageCatalog: false, canReview: false, canPublish: false };
const FULL_PERMISSIONS: SystemPermissions = { canManageAccess: true, canView: true, canResearch: true, canManageCatalog: true, canReview: true, canPublish: true };

const PLATFORM_ROLE_LABELS: Record<string, string> = {
  system_admin: '系统管理员',
  catalog_manager: '指标管理员',
  researcher: '研究员',
  reviewer: '审核员',
  publisher: '发布员',
  reader: '普通用户',
  ai_service: 'AI 服务',
};

export function platformRoleLabel(role: string): string {
  return PLATFORM_ROLE_LABELS[role] ?? role;
}

@Injectable()
export class SystemAccessService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async requireForSystem(systemId: string, actor: Actor, permissions: SystemPermissionKey[]): Promise<void> {
    if (actor.role === 'system_admin') return;
    const access = await this.prisma.indicatorSystemAccess.findUnique({ where: { systemId_userId: { systemId, userId: actor.userId } } });
    const effective = this.permissions(access, actor);
    if (!permissions.some((permission) => effective[permission])) throw new ForbiddenException('你没有当前指标体系的相应权限。');
  }

  async requireForVersion(versionId: string, actor: Actor, permissions: SystemPermissionKey[]): Promise<void> {
    const effective = await this.permissionsForVersion(versionId, actor);
    if (!permissions.some((permission) => effective[permission])) throw new ForbiddenException('你没有当前指标体系的相应权限。');
  }

  async permissionsForVersion(versionId: string, actor: Actor): Promise<SystemPermissions> {
    if (actor.role === 'system_admin') return { ...FULL_PERMISSIONS };
    const version = await this.prisma.indicatorVersion.findUnique({ where: { id: versionId }, select: { systemId: true } });
    if (!version) throw new NotFoundException('指标体系版本不存在。');
    const access = await this.prisma.indicatorSystemAccess.findUnique({ where: { systemId_userId: { systemId: version.systemId, userId: actor.userId } } });
    return this.permissions(access);
  }

  async accessMap(actor: Actor): Promise<Map<string, SystemPermissions> | null> {
    if (actor.role === 'system_admin') return null;
    const accesses = await this.prisma.indicatorSystemAccess.findMany({ where: { userId: actor.userId, canView: true } });
    return new Map(accesses.map((access) => [access.systemId, this.permissions(access, actor)]));
  }

  permissions(access: (Partial<Omit<SystemPermissions, 'systemRole'>> & { systemRole?: string | null }) | null | undefined, actor?: Actor): SystemPermissions {
    if (actor?.role === 'system_admin') return { ...FULL_PERMISSIONS, ...(access?.systemRole === 'creator' ? { systemRole: 'creator' as const } : {}) };
    if (access?.systemRole) {
      const role = access.systemRole as SystemRole;
      return { ...EMPTY_PERMISSIONS, canView: true, canResearch: role !== 'viewer', canManageCatalog: role === 'creator' || role === 'manager', canManageAccess: role === 'creator', systemRole: role };
    }
    return Object.fromEntries(SYSTEM_PERMISSION_KEYS.map((key) => [key, Boolean(access?.[key])])) as unknown as SystemPermissions;
  }

  async list(systemId: string, actor: Actor) {
    await this.requireManageAccess(systemId, actor);
    const system = await this.prisma.indicatorSystem.findUnique({ where: { id: systemId }, select: { id: true, creatorUserId: true } });
    if (!system) throw new NotFoundException('指标体系不存在。');
    const users = await this.prisma.user.findMany({ where: { status: 'active', role: { not: 'ai_service' } }, include: { systemAccesses: { where: { systemId } } }, orderBy: [{ role: 'asc' }, { displayName: 'asc' }] });
    return users.map((user) => {
      const globalAdmin = user.role === 'system_admin';
      const permissions = globalAdmin
        ? { ...FULL_PERMISSIONS }
        : this.permissions(user.systemAccesses[0]);
      return {
        userId: user.id,
        displayName: user.displayName,
        username: user.username,
        departmentName: user.departmentName,
        role: user.role,
        globalAdmin,
        isCreator: user.id === system.creatorUserId,
        systemRole: user.id === system.creatorUserId ? 'creator' : user.systemAccesses[0]?.systemRole ?? null,
        platformRoleLabel: platformRoleLabel(user.role),
        permissions,
      };
    });
  }

  async update(systemId: string, userId: string, input: Partial<SystemPermissions>, actor: Actor) {
    await this.requireManageAccess(systemId, actor);
    const [system, user] = await Promise.all([
      this.prisma.indicatorSystem.findUnique({ where: { id: systemId }, select: { id: true, creatorUserId: true } }),
      this.prisma.user.findUnique({ where: { id: userId } }),
    ]);
    if (!system) throw new NotFoundException('指标体系不存在。');
    if (!user || user.status !== 'active') throw new NotFoundException('启用中的用户不存在。');
    if (userId === system.creatorUserId) throw new ConflictException('创建者权限不能降级或移除。');
    if (user.role === 'system_admin') throw new ConflictException('系统管理员默认拥有全部指标体系权限，无需单独授权。');
    for (const key of SYSTEM_PERMISSION_KEYS) {
      if (input[key] !== undefined && typeof input[key] !== 'boolean') throw new BadRequestException(`权限 ${key} 必须是布尔值。`);
    }
    if (input.systemRole !== undefined && !['manager', 'editor', 'viewer'].includes(input.systemRole ?? '')) throw new BadRequestException('只能授予管理者、编辑者或查看者角色。');
    if (input.canManageAccess) throw new BadRequestException('权限管理能力不能单独授予。');
    // 旧接口仅允许系统管理员使用，防止创建者通过旧权限位绕过角色约束。
    if (actor.role !== 'system_admin' && input.systemRole === undefined) throw new BadRequestException('请选择体系角色。');
    const permissions = this.permissions(input);
    if (SYSTEM_PERMISSION_KEYS.slice(1).some((key) => permissions[key])) permissions.canView = true;
    const storedPermissions = Object.fromEntries(SYSTEM_PERMISSION_KEYS.map(key => [key, permissions[key]])) as Record<SystemPermissionKey, boolean>;
    const roleData = { ...storedPermissions, systemRole: input.systemRole ?? null };
    if (!permissions.canView) return this.remove(systemId, userId, actor);
    const access = await this.prisma.indicatorSystemAccess.upsert({
      where: { systemId_userId: { systemId, userId } },
      update: { ...roleData, grantedByUserId: actor.userId },
      create: { systemId, userId, ...roleData, grantedByUserId: actor.userId },
    });
    await this.audit(actor, 'system_access.updated', systemId, userId, permissions);
    const granted = this.permissions(access);
    return { userId, permissions: granted };
  }

  async remove(systemId: string, userId: string, actor: Actor) {
    await this.requireManageAccess(systemId, actor);
    const system = await this.prisma.indicatorSystem.findUnique({ where: { id: systemId } });
    if (!system) throw new NotFoundException('指标体系不存在。');
    if (system.creatorUserId === userId) throw new ConflictException('创建者权限不能移除。');
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user?.role === 'system_admin') throw new ConflictException('不能移除系统管理员权限。');
    await this.prisma.indicatorSystemAccess.deleteMany({ where: { systemId, userId } });
    await this.audit(actor, 'system_access.removed', systemId, userId, EMPTY_PERMISSIONS);
    return { userId, permissions: { ...EMPTY_PERMISSIONS } };
  }

  async listResearchCandidates(systemId: string, actor: Actor) {
    await this.requireForSystem(systemId, actor, ['canManageCatalog', 'canReview']);
    const accesses = await this.prisma.indicatorSystemAccess.findMany({
      where: {
        systemId,
        canView: true,
        canResearch: true,
        user: { status: 'active', role: { notIn: ['system_admin', 'ai_service'] } },
      },
      include: { user: true },
      orderBy: { user: { displayName: 'asc' } },
    });
    return accesses.map(({ user }) => ({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      departmentName: user.departmentName,
      role: user.role,
      status: user.status,
      authSource: user.authSource,
      wecomBound: false,
      wecomIdentities: [],
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    }));
  }

  private async requireManageAccess(systemId: string, actor: Actor) {
    if (actor.role === 'system_admin') return;
    const system = await this.prisma.indicatorSystem.findUnique({ where: { id: systemId }, select: { creatorUserId: true } });
    if (!system) throw new NotFoundException('指标体系不存在。');
    if (system.creatorUserId !== actor.userId) throw new ForbiddenException('只有体系创建者或系统管理员可以维护用户权限。');
  }

  private async audit(actor: Actor, action: string, systemId: string, userId: string, permissions: SystemPermissions) {
    await this.prisma.auditLog.create({ data: { actorUserId: actor.userId, actorName: actor.name, actorRole: actor.role, action, targetType: 'IndicatorSystemAccess', targetId: `${systemId}:${userId}`, detail: { systemId, userId, permissions } as Prisma.InputJsonValue } });
  }
}

@Injectable()
export class SystemPermissionGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector, @Inject(SystemAccessService) private readonly access: SystemAccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const permissions = this.reflector.getAllAndOverride<SystemPermissionKey[]>(SYSTEM_PERMISSION, [context.getHandler(), context.getClass()]);
    if (!permissions?.length) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest & { params?: Record<string, string> }>();
    const actor = actorFromRequest(request);
    const params = request.params ?? {};
    if (params.systemId) await this.access.requireForSystem(params.systemId, actor, permissions);
    else if (params.versionId) await this.access.requireForVersion(params.versionId, actor, permissions);
    else throw new ForbiddenException('当前接口缺少指标体系权限上下文。');
    return true;
  }
}
