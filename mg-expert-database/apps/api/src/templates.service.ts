import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Actor } from './auth';
import { definitionsForLevel, type ModuleDefinition } from './contract';
import { PrismaService } from './prisma.service';
import { SystemAccessService } from './system-access';
import type { SaveSystemTemplatesRequest } from '@mg-expert/contracts';

export const activeModules = (modules: ModuleDefinition[]) => modules.filter(m => m.deleted !== true && m.active !== false).map(m => ({ ...m, fields: m.fields.filter(f => f.deleted !== true && f.active !== false) }));
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
  return JSON.stringify(value);
};
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

@Injectable()
export class TemplatesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(SystemAccessService) private readonly access: SystemAccessService) {}

  // 体系行锁统一串行化模板变更、目录新增和内容提交。
  async lock(tx: Prisma.TransactionClient, systemId: string) {
    await tx.$queryRaw`SELECT id FROM "IndicatorSystem" WHERE id = ${systemId} FOR UPDATE`;
    const system = await tx.indicatorSystem.findUnique({ where: { id: systemId } });
    if (!system) throw new NotFoundException('指标体系不存在。');
    return system;
  }

  async initialize(tx: Prisma.TransactionClient, systemId: string, maxLevel: number) {
    if (await tx.indicatorLevelTemplate.count({ where: { systemId } }) >= 6) return;
    for (let level = 1; level <= 6; level++) {
      const modules = json(definitionsForLevel(level));
      await tx.indicatorLevelTemplate.upsert({
        where: { systemId_level: { systemId, level } }, update: {},
        create: { systemId, level, modules, revisions: { create: { revisionNo: 1, modules, actorName: '初始化' } } },
      });
    }
  }

  async read(systemId: string, actor: Actor) {
    await this.access.requireForSystem(systemId, actor, ['canView']);
    return this.prisma.$transaction(async tx => {
      const system = await this.lock(tx, systemId);
      await this.initialize(tx, systemId, system.maxLevel);
      const templates = await tx.indicatorLevelTemplate.findMany({ where: { systemId }, orderBy: { level: 'asc' } });
      const counts = await tx.indicatorNode.groupBy({ by: ['level'], where: { version: { systemId } }, _count: true });
      return { systemId, maxLevel: system.maxLevel, revisionNo: system.templateRevision, levels: templates.map(t => ({
        level: t.level, revisionNo: t.revisionNo, modules: t.modules, affectedCount: counts.find(c => c.level === t.level)?._count ?? 0,
      })) };
    });
  }

  async forNode(versionId: string, nodeId: string) {
    const node = await this.prisma.indicatorNode.findFirst({ where: { id: nodeId, versionId }, include: { version: { include: { system: true } } } });
    if (!node) throw new NotFoundException('指标不存在。');
    const systemId = node.version.systemId;
    const existing = await this.prisma.indicatorLevelTemplate.findUnique({ where: { systemId_level: { systemId, level: node.level } } });
    if (existing) return { systemId, level: node.level, revisionNo: existing.revisionNo, modules: existing.modules as unknown as ModuleDefinition[] };
    return this.prisma.$transaction(async tx => {
      const system = await this.lock(tx, systemId);
      await this.initialize(tx, systemId, system.maxLevel);
      const template = await tx.indicatorLevelTemplate.findUniqueOrThrow({ where: { systemId_level: { systemId, level: node.level } } });
      return { systemId, level: node.level, revisionNo: template.revisionNo, modules: template.modules as unknown as ModuleDefinition[] };
    });
  }

  async assertCurrent(tx: Prisma.TransactionClient, systemId: string, level: number, expected?: number, observed?: number) {
    await this.lock(tx, systemId);
    const template = await tx.indicatorLevelTemplate.findUniqueOrThrow({ where: { systemId_level: { systemId, level } } });
    // 旧客户端仅允许提交未改过的初始模板，编辑后必须携带修订号。
    if ((expected ?? 1) !== template.revisionNo || (observed !== undefined && observed !== template.revisionNo)) throw new ConflictException({ code: 'TEMPLATE_CONFLICT', message: '模板已变更，请刷新后核对；当前输入已保留。', currentTemplateRevision: template.revisionNo });
    return template;
  }

  async save(systemId: string, input: SaveSystemTemplatesRequest, actor: Actor) {
    await this.access.requireForSystem(systemId, actor, ['canManageCatalog']);
    if (!Number.isInteger(input.maxLevel) || input.maxLevel < 1 || input.maxLevel > 6 || !Array.isArray(input.levels)) throw new BadRequestException('请选择 1 至 6 级并提供模板。');
    await this.prisma.$transaction(async tx => {
      const system = await this.lock(tx, systemId);
      if (system.templateRevision !== input.expectedRevisionNo) throw new ConflictException('模板设置已被修改，请重新打开后核对。');
      const deeper = await tx.indicatorNode.count({ where: { version: { systemId }, level: { gt: input.maxLevel } } });
      if (deeper) throw new ConflictException('该体系的业务版本仍存在更深层指标，不能降低最大层级。');
      await this.initialize(tx, systemId, Math.max(system.maxLevel, input.maxLevel));
      const seen = new Set<number>();
      for (const entry of input.levels) {
        if (!Number.isInteger(entry.level) || entry.level < 1 || entry.level > input.maxLevel || seen.has(entry.level)) throw new BadRequestException('模板层级无效或重复。');
        seen.add(entry.level);
        const current = await tx.indicatorLevelTemplate.findUniqueOrThrow({ where: { systemId_level: { systemId, level: entry.level } } });
        const previous = current.modules as unknown as ModuleDefinition[];
        this.validate(entry.modules, previous);
        const records = await tx.researchModule.findMany({ where: { record: { version: { systemId }, indicatorNode: { level: entry.level } } }, include: { revisions: true } });
        const evidence = await tx.evidence.findMany({ where: { record: { version: { systemId }, indicatorNode: { level: entry.level } } }, select: { moduleKey: true, fieldKeys: true } });
        for (const module of entry.modules) for (const field of module.fields) {
          const old = previous.find(m => m.moduleKey === module.moduleKey)?.fields.find(f => f.fieldId === field.fieldId);
          if (old && old.fieldType !== field.fieldType && (evidence.some(e => e.moduleKey === module.moduleKey && (e.fieldKeys as string[]).includes(field.fieldId)) || records.some(r => r.moduleKey === module.moduleKey && (
            Object.prototype.hasOwnProperty.call(r.values, field.fieldId) ||
            r.revisions.some(v => Object.prototype.hasOwnProperty.call((v.snapshot as any).values ?? {}, field.fieldId))
          )))) throw new BadRequestException('已使用字段不能更改类型，请新增字段并停用旧字段。');
        }
        const modules = json(entry.modules);
        if (canonical(modules) === canonical(current.modules)) continue;
        const revisionNo = current.revisionNo + 1;
        await tx.indicatorLevelTemplate.update({ where: { id: current.id }, data: { modules, revisionNo, revisions: { create: { revisionNo, modules, actorName: actor.name } } } });
      }
      await tx.indicatorSystem.update({ where: { id: systemId }, data: { maxLevel: input.maxLevel, templateRevision: { increment: 1 } } });
      await tx.auditLog.create({ data: { actorUserId: actor.userId, actorName: actor.name, actorRole: actor.role, action: 'system_templates.saved', targetType: 'IndicatorSystem', targetId: systemId, detail: { maxLevel: input.maxLevel, levels: [...seen] } } });
    }, { timeout: 30000 });
    return this.read(systemId, actor);
  }

  private validate(modules: ModuleDefinition[], previous: ModuleDefinition[]) {
    const types = ['short_text', 'long_text', 'rich_text', 'number', 'decimal', 'percentage', 'date', 'enum', 'reference_list', 'object_list', 'organization_contact_list'];
    const safeId = (id: unknown) => typeof id === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,99}$/.test(id) && !['constructor', 'prototype', '__proto__'].includes(id);
    if (!Array.isArray(modules) || !modules.length || modules.length > 50) throw new BadRequestException('模块数量需在 1 至 50 之间。');
    const ids = new Set<string>();
    for (const m of modules) {
      if (!m || typeof m !== 'object' || !safeId(m.moduleKey) || ids.has(m.moduleKey) || (typeof m.name !== 'string' || !m.name.trim()) || !Array.isArray(m.fields) || m.fields.length > 100) throw new BadRequestException('模块标识、名称或字段无效。');
      if ((m.active !== undefined && typeof m.active !== 'boolean') || (m.deleted !== undefined && typeof m.deleted !== 'boolean')) throw new BadRequestException('模块启用和删除状态必须为布尔值。');
      if (m.deleted === true) m.active = false;
      ids.add(m.moduleKey);
      const fields = new Set<string>();
      for (const f of m.fields) {
        if (!f || typeof f !== 'object' || !safeId(f.fieldId) || fields.has(f.fieldId) || (typeof f.label !== 'string' || !f.label.trim()) || !types.includes(f.fieldType)) throw new BadRequestException('字段标识、名称或类型无效。');
        if ((f.active !== undefined && typeof f.active !== 'boolean') || (f.deleted !== undefined && typeof f.deleted !== 'boolean')) throw new BadRequestException('字段启用和删除状态必须为布尔值。');
        if (f.deleted === true) f.active = false;
        fields.add(f.fieldId);
        if (f.enumValues && (!Array.isArray(f.enumValues) || f.enumValues.some(v => typeof v !== 'string' || !v.trim()))) throw new BadRequestException('选项必须是非空文字。');
        const old = previous.find(p => p.moduleKey === m.moduleKey)?.fields.find(p => p.fieldId === f.fieldId);
        // 选项停用保留旧值，仅从新增选择中移除。
        const inactiveOptions = [...new Set([...(old?.inactiveEnumValues ?? []), ...(old?.enumValues ?? []).filter(v => !f.enumValues?.includes(v))])].filter(v => !f.enumValues?.includes(v));
        if (inactiveOptions.length) f.inactiveEnumValues = inactiveOptions; else delete f.inactiveEnumValues;
      }
      const old = previous.find(p => p.moduleKey === m.moduleKey);
      if (old?.fields.some(f => !fields.has(f.fieldId))) throw new BadRequestException('已有字段必须保留标识，请通过删除状态移除。');
      m.displayOrder = modules.indexOf(m) + 1;
    }
    if (previous.some(m => !ids.has(m.moduleKey))) throw new BadRequestException('已有模块必须保留标识，请通过删除状态移除。');
    if (!modules.some(m => m.deleted !== true && m.active !== false)) throw new BadRequestException('至少保留一个未删除的启用模块。');
  }
}
