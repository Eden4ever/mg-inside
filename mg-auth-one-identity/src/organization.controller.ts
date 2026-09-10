import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Inject, NotFoundException, Param, Patch, Post, Put, Req } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { actorFromRequest, requireRole, type Actor, type AuthenticatedRequest } from './auth';
import { lockAuthorization, ensureIdentityAdministrator } from './application-access';
import { replaceOrganizations } from './scope-access';

const divisionTypes = ['province', 'city', 'county', 'district', 'town', 'street', 'village', 'functional_zone'];
const organizationTypes = ['government', 'institution', 'enterprise', 'social', 'supervision', 'other'];
const divisionInclude = { managedDivisions: { select: { officialId: true } }, _count: { select: { children: true, organizations: true, hostingZones: true } } } as const;
const organizationInclude = { division: true, plaques: { orderBy: { name: 'asc' as const } }, _count: { select: { members: true } } } as const;
type Input = Record<string, unknown>;
function input(body: unknown, keys: string[]): Input {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !keys.includes(key))) throw new BadRequestException('请求包含无效字段。');
  return body as Input;
}
function text(value: unknown, label: string, max: number) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new BadRequestException(`${label}须为 1 至 ${max} 个字符。`);
  return value.trim();
}
function flag(value: unknown) { if (typeof value !== 'boolean') throw new BadRequestException('状态参数必须为布尔值。'); return value; }
function reference(value: unknown) { if (value === null || value === undefined || value === '') return null; return text(value, '关联标识', 100); }
function strings(value: unknown, label: string, maxLength: number) {
  if (!Array.isArray(value) || value.length > 100) throw new BadRequestException(`${label}最多 100 项。`);
  const result = value.map(item => text(item, label, maxLength));
  if (new Set(result).size !== result.length) throw new BadRequestException(`${label}不能重复。`);
  return result;
}

@Controller()
export class OrganizationController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  private actor(req: AuthenticatedRequest) { const actor = actorFromRequest(req); requireRole(actor, ['system_admin']); return actor; }
  // 树移动、启停、引用建立和删除共用事务锁，避免并发产生环或悬空引用。
  private async write<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
    try { return await this.prisma.$transaction(async tx => { await lockAuthorization(tx); await tx.$queryRaw`SELECT pg_advisory_xact_lock(741029)::text`; const result = await work(tx); await ensureIdentityAdministrator(tx); return result; }); }
    catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'P2002') throw new ConflictException('区划编码、信用代码或挂牌名称重复。');
      if (code === 'P2003') throw new ConflictException('记录仍被引用，请先处理关联数据。');
      throw error;
    }
  }
  private audit(tx: Prisma.TransactionClient, actor: Actor, action: string, targetId: string, detail: Prisma.InputJsonObject) {
    return tx.auditLog.create({ data: { actorUserId: actor.userId, actorName: actor.name, actorRole: actor.role, action,
      targetType: action.startsWith('division.') ? 'Division' : 'Organization', targetId, detail } });
  }
  @Get('divisions') listDivisions(@Req() req: AuthenticatedRequest) {
    this.actor(req); return this.prisma.division.findMany({ orderBy: { code: 'asc' }, include: divisionInclude });
  }
  @Post('divisions') createDivision(@Body() body: unknown, @Req() req: AuthenticatedRequest) { return this.saveDivision(null, body, this.actor(req)); }
  @Patch('divisions/:id') updateDivision(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthenticatedRequest) { return this.saveDivision(id, body, this.actor(req)); }
  private saveDivision(id: string | null, body: unknown, actor: Actor) {
    const patch = input(body, ['name', 'code', 'type', 'standard', 'enabled', 'parentId', 'officialIds']);
    return this.write(async tx => {
      const previous = id ? await tx.division.findUnique({ where: { id }, include: divisionInclude }) : null;
      if (id && !previous) throw new NotFoundException('行政区划不存在。');
      const merged: Input = { type: 'province', standard: true, enabled: true, parentId: null, ...previous, ...patch };
      const name = text(merged.name, '区划名称', 100), code = text(merged.code, '区划编码', 32), type = text(merged.type, '区划类型', 30);
      const standard = flag(merged.standard), enabled = flag(merged.enabled), parentId = reference(merged.parentId);
      if (!divisionTypes.includes(type)) throw new BadRequestException('区划类型无效。');
      if (type === 'functional_zone' && standard) throw new BadRequestException('功能区只能使用自定义扩展编码。');
      if (!(standard ? /^(?:\d{6}|\d{9}|\d{12})$/ : /^[A-Za-z0-9][A-Za-z0-9-]{1,31}$/).test(code)) throw new BadRequestException('标准编码须为 6、9 或 12 位数字，扩展编码支持字母、数字和短横线。');
      const all = await tx.division.findMany(), byId = new Map(all.map(row => [row.id, row]));
      const parent = parentId ? byId.get(parentId) : undefined;
      if (parentId && !parent) throw new ConflictException('上级区划不存在。');
      const visited = new Set<string>(id ? [id] : []);
      let cursor = parent;
      while (cursor) {
        if (visited.has(cursor.id)) throw new ConflictException('不能将区划移动至自身或下级。');
        visited.add(cursor.id);
        if (enabled && !cursor.enabled) throw new ConflictException('请先启用上级区划。');
        cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
      }
      const level = (parent?.level || 0) + 1;
      const descendants = all.filter(row => row.parentId === id && id !== null);
      for (let index = 0; index < descendants.length; index++) descendants.push(...all.filter(row => row.parentId === descendants[index].id));
      const shift = level - (previous?.level || level);
      if (level > 6 || descendants.some(row => row.level + shift > 6)) throw new ConflictException('行政区划最多六层。');
      if (previous && !enabled) {
        const scope = [previous.id, ...descendants.map(row => row.id)];
        if (descendants.some(row => row.enabled) || await tx.organization.count({ where: { divisionId: { in: scope }, enabled: true } })
          || await tx.divisionMapping.count({ where: { officialId: { in: scope }, zone: { enabled: true } } })) throw new ConflictException('请先停用下级区划、关联机构及托管功能区。');
      }
      const officialIds = patch.officialIds === undefined ? previous?.managedDivisions.map(item => item.officialId) || [] : strings(patch.officialIds, '托管区划', 100);
      if (type !== 'functional_zone' && officialIds.length) throw new ConflictException('仅功能区可配置托管关系。');
      if (previous && (!standard || type === 'functional_zone') && previous._count.hostingZones) throw new ConflictException('请先解除被托管关系，再更改类型或编码来源。');
      if (officialIds.some(target => target === id || !byId.get(target)?.standard || byId.get(target)?.type === 'functional_zone' || (enabled && !byId.get(target)?.enabled))) throw new ConflictException('托管对象须为有效的国标区划，不能选择自身或功能区。');
      const data = { name, code, type, standard, enabled, parentId, level };
      const row = previous ? await tx.division.update({ where: { id: previous.id }, data }) : await tx.division.create({ data });
      for (const child of descendants) if (shift) await tx.division.update({ where: { id: child.id }, data: { level: child.level + shift } });
      await tx.divisionMapping.deleteMany({ where: { zoneId: row.id } });
      if (officialIds.length) await tx.divisionMapping.createMany({ data: officialIds.map(officialId => ({ zoneId: row.id, officialId })) });
      await this.audit(tx, actor, previous ? 'division.updated' : 'division.created', row.id, { ...data, officialIds });
      return tx.division.findUniqueOrThrow({ where: { id: row.id }, include: divisionInclude });
    });
  }
  @Delete('divisions/:id') removeDivision(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const actor = this.actor(req);
    return this.write(async tx => {
      const row = await tx.division.findUnique({ where: { id }, include: divisionInclude });
      if (!row) throw new NotFoundException('行政区划不存在。');
      if (row._count.children || row._count.organizations || row._count.hostingZones) throw new ConflictException('请先处理下级区划、组织机构及被托管关系。');
      await tx.division.delete({ where: { id } });
      await this.audit(tx, actor, 'division.deleted', id, { name: row.name, code: row.code }); return { deleted: true };
    });
  }
  @Get('organizations') listOrganizations(@Req() req: AuthenticatedRequest) {
    this.actor(req); return this.prisma.organization.findMany({ orderBy: { name: 'asc' }, include: organizationInclude });
  }
  @Get('users/:userId/organizations') async userOrganizations(@Param('userId') userId: string, @Req() req: AuthenticatedRequest) {
    this.actor(req);
    if (!await this.prisma.user.count({ where: { id: userId } })) throw new NotFoundException('用户不存在。');
    return this.prisma.userOrganization.findMany({ where: { userId }, include: { organization: true } });
  }
  @Put('users/:userId/organizations') setUserOrganizations(@Param('userId') userId: string, @Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const actor = this.actor(req), patch = input(body, ['organizations']);
    return this.write(async tx => {
      if (!await tx.user.count({ where: { id: userId } })) throw new NotFoundException('用户不存在。');
      const detail = await replaceOrganizations(tx, userId, patch.organizations);
      await tx.auditLog.create({ data: { actorUserId: actor.userId, actorName: actor.name, actorRole: actor.role, action: 'user.organizations', targetType: 'User', targetId: userId, detail } });
      return tx.userOrganization.findMany({ where: { userId }, include: { organization: true } });
    });
  }
  @Get('organizations/:id/members') members(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    this.actor(req);
    return this.prisma.userOrganization.findMany({ where: { organizationId: id }, select: { isPrimary: true, user: { select: { id: true, displayName: true, username: true, status: true } } } });
  }
  @Post('organizations') createOrganization(@Body() body: unknown, @Req() req: AuthenticatedRequest) { return this.saveOrganization(null, body, this.actor(req)); }
  @Patch('organizations/:id') updateOrganization(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthenticatedRequest) { return this.saveOrganization(id, body, this.actor(req)); }
  private saveOrganization(id: string | null, body: unknown, actor: Actor) {
    const patch = input(body, ['name', 'creditCode', 'type', 'divisionId', 'enabled', 'plaques']);
    return this.write(async tx => {
      const previous = id ? await tx.organization.findUnique({ where: { id }, include: organizationInclude }) : null;
      if (id && !previous) throw new NotFoundException('组织机构不存在。');
      const merged: Input = { type: 'institution', enabled: true, divisionId: null, ...previous, ...patch };
      const name = text(merged.name, '机构名称', 160), creditCode = text(merged.creditCode, '统一社会信用代码', 18).toUpperCase();
      if (!/^[0-9A-HJ-NPQRTUWXY]{18}$/.test(creditCode)) throw new BadRequestException('统一社会信用代码须为 18 位有效字符。');
      const type = text(merged.type, '机构类型', 30), enabled = flag(merged.enabled), divisionId = reference(merged.divisionId);
      if (!organizationTypes.includes(type)) throw new BadRequestException('机构类型无效。');
      if (!divisionId) throw new BadRequestException('请选择所属行政区划。');
      const division = await tx.division.findUnique({ where: { id: divisionId } });
      if (!division || enabled && !division.enabled) throw new ConflictException('所属区划不存在或已停用。');
      const plaques = patch.plaques === undefined ? previous?.plaques.map(item => item.name) || [] : strings(patch.plaques, '加挂牌子', 160);
      if (plaques.includes(name)) throw new BadRequestException('加挂牌子不能与主名称重复。');
      const data = { name, creditCode, type, divisionId, enabled };
      const row = previous ? await tx.organization.update({ where: { id: previous.id }, data }) : await tx.organization.create({ data });
      await tx.organizationPlaque.deleteMany({ where: { organizationId: row.id } });
      if (plaques.length) await tx.organizationPlaque.createMany({ data: plaques.map(name => ({ organizationId: row.id, name })) });
      await this.audit(tx, actor, previous ? 'organization.updated' : 'organization.created', row.id, { ...data, plaques });
      return tx.organization.findUniqueOrThrow({ where: { id: row.id }, include: organizationInclude });
    });
  }
  @Delete('organizations/:id') removeOrganization(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const actor = this.actor(req);
    return this.write(async tx => {
      const row = await tx.organization.findUnique({ where: { id } });
      if (!row) throw new NotFoundException('组织机构不存在。');
      if (row.enabled) throw new ConflictException('请先停用机构，再删除。');
      if (await tx.userOrganization.count({ where: { organizationId: id } })) throw new ConflictException('请先移除机构成员，再删除。');
      await tx.organization.delete({ where: { id } });
      await this.audit(tx, actor, 'organization.deleted', id, { name: row.name, creditCode: row.creditCode }); return { deleted: true };
    });
  }
}
