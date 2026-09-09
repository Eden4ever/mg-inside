import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { readXlsxRows } from './xlsx-import';
import { type ResearchModuleKey, WORKBOOK_COLUMN_MAPPINGS } from '@mg-expert/contracts';
import { requireRole, type Actor } from './auth';
import { definitionsForLevel, type ContractField } from './contract';
import { TemplatesService, activeModules } from './templates.service';
import type { ModuleDefinition } from './contract';
import { PrismaService } from './prisma.service';
import { SystemAccessService } from './system-access';

type JsonMap = Record<string, unknown>;
type Headers = Record<string, unknown>;
type CreateSystemInput = { name?: string; code?: string; region?: string; year?: number; versionCode?: string; maxLevel?: number };
type NodeInput = { parentId?: string | null; level?: number; code?: string; name?: string; sortOrder?: number };
type ModuleInput = { expectedTemplateRevision?: number; expectedRevisionNo?: number; values?: Array<{ fieldKey?: string; value?: unknown }>; notApplicableReasons?: Record<string, string>; confirm?: boolean };
type EvidenceInput = { expectedTemplateRevision?: number; type?: string; title?: string; sourceUrl?: string; excerpt?: string; verificationStatus?: string; fieldKeys?: string[] };
type SuggestionInput = { expectedTemplateRevision?: number; targetType?: 'module' | 'summary'; moduleKey?: string; fieldKey?: string; content?: string; rationale?: string; confidence?: string; evidenceIds?: string[]; verificationItems?: string[]; sourceRevisionIds?: string[]; modelId?: string; promptVersion?: string };
type SuggestionDecisionInput = { expectedTemplateRevision?: number; decision?: 'accepted' | 'rejected'; expectedRevisionNo?: number; fieldKey?: string; value?: unknown; reason?: string };

const MODULE_STATUSES = new Set(['not_started', 'in_progress', 'pending_review', 'confirmed', 'returned']);
const EVIDENCE_STATUSES = new Set(['pending_verification', 'verified', 'invalid', 'superseded']);

@Injectable()
export class CatalogService {
  constructor(
    @Inject(TemplatesService) private readonly templates: TemplatesService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SystemAccessService) private readonly systemAccess: SystemAccessService,
  ) {}

  async health(): Promise<object> {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', service: 'mg-expert-api', timestamp: new Date().toISOString() };
  }


  async listSystems(actor: Actor): Promise<object[]> {
    const accessMap = await this.systemAccess.accessMap(actor);
    const systems = await this.prisma.indicatorSystem.findMany({
      where: accessMap ? { id: { in: [...accessMap.keys()] } } : undefined,
      orderBy: { updatedAt: 'desc' },
      include: { versions: { orderBy: [{ year: 'desc' }, { updatedAt: 'desc' }], include: { nodes: true, records: { include: { modules: true } } } } },
    });
    return Promise.all(systems.map(async (system) => {
      const version = system.versions[0];
      const progress = version ? await this.versionProgress(version.id) : { total: 0 };
      const modules = version?.records.flatMap((record) => record.modules) ?? [];
      const completed = modules.filter((module) => module.revisionNo > 0).length;
      return {
        id: system.id, name: system.name, code: system.code, region: system.region,
        year: version?.year ?? null, version: version?.versionCode ?? null, versionId: version?.id ?? null,
        indicatorCount: version?.nodes.length ?? 0, maxLevel: system.maxLevel,
        progress: progress.total,
        status: version?.status ?? 'draft', updatedAt: system.updatedAt.toISOString(),
        access: accessMap ? accessMap.get(system.id)! : this.systemAccess.permissions(null, actor),
      };
    }));
  }

  async getSystem(id: string, actor: Actor): Promise<object> {
    const system = await this.prisma.indicatorSystem.findUnique({ where: { id }, include: { versions: { orderBy: [{ year: 'desc' }, { updatedAt: 'desc' }] } } });
    if (!system) throw new NotFoundException('指标体系不存在。');
    const access = actor.role === 'system_admin'
      ? this.systemAccess.permissions(null, actor)
      : this.systemAccess.permissions(await this.prisma.indicatorSystemAccess.findUnique({ where: { systemId_userId: { systemId: id, userId: actor.userId } } }), actor);
    return { ...system, access, versions: system.versions.map((version) => ({ ...version, createdAt: version.createdAt.toISOString(), updatedAt: version.updatedAt.toISOString() })) };
  }

  async createSystem(input: CreateSystemInput, actor: Actor): Promise<object> {
    requireRole(actor, ['system_admin', 'catalog_manager']);
    if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.name !== 'string' || !input.name.trim()) {
      throw new BadRequestException('指标体系名称不能为空。');
    }
    if ((input.code !== undefined && (typeof input.code !== 'string' || !input.code.trim())) ||
        (input.versionCode !== undefined && (typeof input.versionCode !== 'string' || !input.versionCode.trim()))) {
      throw new BadRequestException('提供的体系编码和版本号必须为非空文本。');
    }
    if (input.region !== undefined && typeof input.region !== 'string') throw new BadRequestException('地区必须为文本。');
    const year = input.year === undefined ? new Date().getFullYear() : input.year;
    const maxLevel = input.maxLevel === undefined ? 3 : input.maxLevel;
    if (typeof year !== 'number' || !Number.isInteger(year) || year < 2000 || year > 9999) throw new BadRequestException('年度必须为2000至9999之间的整数。');
    if (typeof maxLevel !== 'number' || !Number.isInteger(maxLevel) || maxLevel < 1 || maxLevel > 6) throw new BadRequestException('最大层级必须为1至6之间的整数。');
    const name = input.name.trim();
    const code = input.code === undefined ? `SYS-${randomUUID()}` : input.code.trim();
    const region = input.region?.trim() ?? '';
    const versionCode = input.versionCode === undefined ? 'V1.0' : input.versionCode.trim();
    try {
      const system = await this.prisma.$transaction(async (tx) => {
        const created = await tx.indicatorSystem.create({ data: { name, code, region, maxLevel, creatorUserId: actor.userId } });
        await this.templates.initialize(tx, created.id, maxLevel);
        const version = await tx.indicatorVersion.create({ data: { systemId: created.id, year, versionCode, status: 'draft' } });
        await tx.indicatorSystemAccess.create({ data: { systemId: created.id, userId: actor.userId, systemRole: 'creator', canView: true, canResearch: true, canManageCatalog: true, grantedByUserId: actor.userId } });
        await this.audit(tx, actor, 'system.created', 'IndicatorSystem', created.id, version.id, { code, year, versionCode, maxLevel });
        return { ...created, version };
      });
      return {
        id: system.id, name: system.name, code: system.code, region: system.region, version: system.version,
        access: actor.role === 'system_admin'
          ? this.systemAccess.permissions(null, actor)
          : this.systemAccess.permissions({ systemRole: 'creator' }, actor),
      };
    } catch (error) {
      if (this.isUniqueError(error)) throw new ConflictException('指标体系编码或版本号已存在。');
      throw error;
    }
  }

  async updateSystem(id: string, input: { name?: string; region?: string }, actor: Actor): Promise<object> {
    await this.systemAccess.requireForSystem(id, actor, ['canManageCatalog']);
    if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 200) throw new BadRequestException('体系名称需为1至200个字符。');
    if (typeof input.region !== 'string' || input.region.trim().length > 200) throw new BadRequestException('地区需为不超过200个字符的文本。');
    return this.prisma.$transaction(async tx => {
      const system = await tx.indicatorSystem.findUnique({ where: { id } });
      if (!system) throw new NotFoundException('指标体系不存在。');
      const updated = await tx.indicatorSystem.update({ where: { id }, data: { name: input.name!.trim(), region: input.region!.trim() } });
      await this.audit(tx, actor, 'system.updated', 'IndicatorSystem', id, undefined, { before: { name: system.name, region: system.region }, after: { name: updated.name, region: updated.region } });
      return updated;
    });
  }

  async deleteSystem(id: string, input: { confirmName?: string }, actor: Actor): Promise<void> {
    await this.systemAccess.requireForSystem(id, actor, ['canManageCatalog']);
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "IndicatorSystem" WHERE id = ${id} FOR UPDATE`;
      const system = await tx.indicatorSystem.findUnique({ where: { id } });
      if (!system) throw new NotFoundException('指标体系不存在。');
      if (!input || input.confirmName !== system.name) throw new BadRequestException('请输入完整体系名称确认删除。');
      if (await tx.semanticLibrary.count({ where: { version: { systemId: id } } })) throw new ConflictException('该体系已关联智能语义库，请先删除关联语义库后再删除体系。');
      // 先断开树内父子关系，避免自关联 Restrict 阻止整体系级联删除。
      await tx.indicatorNode.updateMany({ where: { version: { systemId: id } }, data: { parentId: null } });
      await this.audit(tx, actor, 'system.deleted', 'IndicatorSystem', id, undefined, { name: system.name, code: system.code });
      await tx.indicatorSystem.delete({ where: { id } });
    });
  }

  async getVersion(versionId: string, actor: Actor): Promise<object> {
    const version = await this.prisma.indicatorVersion.findUnique({ where: { id: versionId }, include: { system: true, nodes: true, records: { include: { modules: true } } } });
    if (!version) throw new NotFoundException('指标体系版本不存在。');
    const templates = await this.prisma.indicatorLevelTemplate.findMany({ where: { systemId: version.systemId } });
    const modules = version.records.flatMap(record => {
      const level = version.nodes.find(n => n.id === record.indicatorNodeId)?.level ?? 3;
      const definitions = activeModules((templates.find(t => t.level === level)?.modules as unknown as ModuleDefinition[]) ?? definitionsForLevel(level));
      return record.modules.filter(m => definitions.some(d => d.moduleKey === m.moduleKey));
    });
    const moduleStatusCounts = Object.fromEntries([...MODULE_STATUSES].map((status) => [status, modules.filter((module) => module.status === status).length]));
    const confirmed = modules.filter(module => module.revisionNo > 0).length;
    const access = actor.role === 'system_admin'
      ? this.systemAccess.permissions(null, actor)
      : this.systemAccess.permissions(await this.prisma.indicatorSystemAccess.findUnique({ where: { systemId_userId: { systemId: version.systemId, userId: actor.userId } } }), actor);
    const { byNode: progressByNode, total: progress } = await this.versionProgress(versionId);
    return {
      id: version.system.id,
      versionId: version.id,
      name: version.system.name,
      code: version.system.code,
      region: version.system.region,
      year: version.year,
      version: version.versionCode,
      status: version.status,
      indicatorCount: version.nodes.length, maxLevel: version.system.maxLevel,
      progress,
      createdAt: version.createdAt.toISOString(),
      updatedAt: version.updatedAt.toISOString(),
      access,
      counts: {
        level1: version.nodes.filter((node) => node.level === 1).length,
        level2: version.nodes.filter((node) => node.level === 2).length,
        level3: version.nodes.filter((node) => node.level === 3).length,
        researchRecords: version.records.length,
        levels: Object.fromEntries(Array.from({ length: version.system.maxLevel }, (_, i) => [i + 1, version.nodes.filter(n => n.level === i + 1).length])),
      },
      moduleStatusCounts,
      tree: this.toTree(version.nodes, progressByNode),
    };
  }

  async getTree(versionId: string, query?: string): Promise<object[]> {
    await this.version(versionId);
    const [nodes, records] = await Promise.all([
      this.prisma.indicatorNode.findMany({ where: { versionId }, orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] }),
      this.prisma.researchRecord.findMany({ where: { versionId }, include: { modules: true } }),
    ]);
    const { byNode: progressByNode } = await this.versionProgress(versionId);
    if (!query?.trim()) return this.toTree(nodes, progressByNode);
    const needle = query.trim().toLowerCase();
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const visible = new Set<string>();
    for (const node of nodes.filter((item) => `${item.name}${item.code}`.toLowerCase().includes(needle))) {
      let current: typeof node | undefined = node;
      while (current) { visible.add(current.id); current = current.parentId ? byId.get(current.parentId) : undefined; }
    }
    return this.toTree(nodes.filter((node) => visible.has(node.id)), progressByNode);
  }

  async createNode(versionId: string, input: NodeInput, actor: Actor): Promise<object> {
    await this.systemAccess.requireForVersion(versionId, actor, ['canManageCatalog']);
    const version = await this.requireWritableVersion(versionId, true);
    if (!input || typeof input.name !== 'string' || (input.code !== undefined && (typeof input.code !== 'string' || !input.code.trim()))) throw new BadRequestException('名称和显式提供的编码必须为非空文本。');
    const level = Number(input.level); const requestedCode = input.code?.trim(); const name = input.name.trim();
    if (!Number.isInteger(level) || level < 1 || level > version.system.maxLevel || !name) throw new BadRequestException(`节点层级仅支持1至${version.system.maxLevel}级，名称不能为空。`);
    if (input.sortOrder !== undefined && (!Number.isInteger(Number(input.sortOrder)) || Number(input.sortOrder) < 0)) throw new BadRequestException('排序必须是非负整数。');
    const parent = await this.validateParent(version.id, level, input.parentId ?? null);
    try {
      const node = await this.prisma.$transaction(async (tx) => {
        const currentSystem = await this.templates.lock(tx, version.systemId);
        if (level > currentSystem.maxLevel) throw new ConflictException('最大层级已变更，请刷新。');
        // 在体系锁内分配编码，各层级共享序号；保留已有和外部标准编码。
        let code = requestedCode;
        if (!code) {
          const existing = await tx.indicatorNode.findMany({ where: { versionId }, select: { code: true } });
          const used = new Set(existing.map(node => node.code));
          let sequence = existing.reduce((max, node) => /^IND-\d{1,9}$/.test(node.code) ? Math.max(max, Number(node.code.slice(4))) : max, 0) + 1;
          do { code = `IND-${String(sequence++).padStart(6, '0')}`; } while (used.has(code));
        }
        const created = await tx.indicatorNode.create({ data: { versionId, parentId: parent?.id, parentKey: parent?.id ?? '__root__', level, code, name, sortOrder: Number.isInteger(input.sortOrder) ? Number(input.sortOrder) : 0 } });
        await this.audit(tx, actor, 'indicator_node.created', 'IndicatorNode', created.id, versionId, { level, code, name, parentId: parent?.id ?? null });
        return created;
      });
      return node;
    } catch (error) {
      if (this.isUniqueError(error)) throw new ConflictException('同一父节点下指标编码不得重复。');
      throw error;
    }
  }

  async updateNode(versionId: string, nodeId: string, input: NodeInput, actor: Actor): Promise<object> {
    await this.systemAccess.requireForVersion(versionId, actor, ['canManageCatalog']);
    await this.requireWritableVersion(versionId);
    const existing = await this.prisma.indicatorNode.findFirst({ where: { id: nodeId, versionId }, include: { children: true } });
    if (!existing) throw new NotFoundException('指标节点不存在。');
    const level = input.level === undefined ? existing.level : Number(input.level);
    if (level !== existing.level) throw new BadRequestException('已创建节点不允许变更层级。');
    const parentId = input.parentId === undefined ? existing.parentId : input.parentId;
    if (parentId === nodeId) throw new BadRequestException('指标节点不能以自身为父节点。');
    const parent = await this.validateParent(versionId, level, parentId ?? null);
    if (existing.children.length && (parent?.id ?? null) !== existing.parentId) throw new BadRequestException('含子节点的指标不可移动，避免形成循环或破坏层级。');
    if (input.sortOrder !== undefined && (!Number.isInteger(Number(input.sortOrder)) || Number(input.sortOrder) < 0)) throw new BadRequestException('排序必须是非负整数。');
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const result = await tx.indicatorNode.update({ where: { id: nodeId }, data: { parentId: parent?.id ?? null, parentKey: parent?.id ?? '__root__', code: input.code?.trim() || existing.code, name: input.name?.trim() || existing.name, sortOrder: input.sortOrder === undefined ? existing.sortOrder : Number(input.sortOrder) } });
        await this.audit(tx, actor, 'indicator_node.updated', 'IndicatorNode', nodeId, versionId, { before: { code: existing.code, name: existing.name }, after: { code: result.code, name: result.name } });
        return result;
      });
      return updated;
    } catch (error) {
      if (this.isUniqueError(error)) throw new ConflictException('同一父节点下指标编码不得重复。');
      throw error;
    }
  }

  async reorderNode(versionId: string, input: { nodeId: string; targetId: string; position: 'before' | 'after' }, actor: Actor) {
    await this.systemAccess.requireForVersion(versionId, actor, ['canManageCatalog']);
    await this.requireWritableVersion(versionId);
    if (!input || typeof input.nodeId !== 'string' || typeof input.targetId !== 'string' || input.nodeId === input.targetId || !['before', 'after'].includes(input.position)) {
      throw new BadRequestException('排序参数无效。');
    }
    return this.prisma.$transaction(async (tx) => {
      const node = await tx.indicatorNode.findFirst({ where: { id: input.nodeId, versionId } });
      const target = await tx.indicatorNode.findFirst({ where: { id: input.targetId, versionId } });
      if (!node || !target) throw new NotFoundException('指标节点不存在。');
      if (node.level !== target.level || node.parentId !== target.parentId) throw new BadRequestException('只能在同一父节点下进行同级排序。');
      const siblings = await tx.indicatorNode.findMany({ where: { versionId, parentId: node.parentId }, orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] });
      const ordered = siblings.filter((item) => item.id !== node.id);
      ordered.splice(ordered.findIndex((item) => item.id === target.id) + (input.position === 'after' ? 1 : 0), 0, node);
      for (const [index, item] of ordered.entries()) {
        await tx.indicatorNode.update({ where: { id: item.id }, data: { sortOrder: index + 1 } });
      }
      await this.audit(tx, actor, 'indicator_node.reordered', 'IndicatorNode', node.id, versionId, { nodeIds: ordered.map((item) => item.id) });
      return { nodeIds: ordered.map((item) => item.id) };
    });
  }

  async deleteNode(versionId: string, nodeId: string, actor: Actor, input?: { confirmName?: string }): Promise<void> {
    await this.systemAccess.requireForVersion(versionId, actor, ['canManageCatalog']);
    const version = await this.requireWritableVersion(versionId);
    await this.prisma.$transaction(async (tx) => {
      await this.templates.lock(tx, version.systemId);
      const node = await tx.indicatorNode.findFirst({ where: { id: nodeId, versionId }, include: { children: true, record: { include: { _count: { select: { modules: true, evidence: true, suggestions: true, summaryRevisions: true } } } } } });
      if (!node) throw new NotFoundException('指标节点不存在。');
      if (node.children.length) throw new ConflictException('请先删除全部子节点。');
      if ((node.record || input?.confirmName !== undefined) && input?.confirmName !== node.name) {
        throw new ConflictException('请确认删除该指标及其内容记录；名称已变化时请刷新后重新确认。');
      }
      await tx.indicatorNode.delete({ where: { id: nodeId } });
      await this.audit(tx, actor, 'indicator_node.deleted', 'IndicatorNode', nodeId, versionId, {
        name: node.name, code: node.code, level: node.level, parentId: node.parentId,
        contentDeleted: Boolean(node.record), deletedContent: node.record?._count ?? null,
      });
    });
  }

  async workspace(versionId: string, nodeId: string, actor?: Actor): Promise<object> {
    const version = await this.version(versionId, true);
    const node = await this.prisma.indicatorNode.findFirst({ where: { id: nodeId, versionId }, include: { parent: { include: { parent: true } } } });
    if (!node) throw new NotFoundException('指标节点不存在。');
        const existingRecord = await this.prisma.researchRecord.findUnique({ where: { versionId_indicatorNodeId: { versionId, indicatorNodeId: node.id } } });
    const record = await this.ensureRecord(versionId, node.id);
    const template = await this.templates.forNode(versionId, nodeId);
    const definitions = activeModules(template.modules);
    const hydrated = await this.prisma.researchRecord.findUniqueOrThrow({ where: { id: record.id }, include: { modules: true, evidence: true, indicatorNode: { include: { parent: { include: { parent: true } } } }, version: { include: { system: true } } } });
    const access = actor?.role === 'system_admin'
      ? this.systemAccess.permissions(null, actor)
      : actor
        ? this.systemAccess.permissions(await this.prisma.indicatorSystemAccess.findUnique({ where: { systemId_userId: { systemId: hydrated.version.systemId, userId: actor.userId } } }), actor)
        : undefined;
    return {
      system: { ...this.systemSummary(hydrated.version.system, hydrated.version), ...(access ? { access } : {}) },
      indicator: { id: node.id, code: node.code, name: node.name, level: node.level, level1Name: node.parent?.parent?.name ?? '', level2Name: node.parent?.name ?? '', progress: this.contentProgress(hydrated.modules, definitions), issues: 0 },
      summary: hydrated.summary ?? '',
      summaryRevisionNo: (await this.prisma.researchSummaryRevision.aggregate({ where: { recordId: hydrated.id }, _max: { revisionNo: true } }))._max.revisionNo ?? 0,
      summarySourceRevisionIds: (await this.prisma.researchSummaryRevision.findFirst({ where: { recordId: hydrated.id }, orderBy: { revisionNo: 'desc' } }))?.sourceRevisionIds ?? [],
      templateRevision: template.revisionNo,
      moduleDefinitions: definitions,
      modules: definitions.map((definition) => this.moduleView(hydrated.modules.find((item) => item.moduleKey === definition.moduleKey)!, hydrated.evidence.filter(e => e.moduleKey === definition.moduleKey), definition.moduleKey, definition)),
      recentRevisions: await this.revisionsForRecord(hydrated.id, 10),
    };
  }

  async saveModule(versionId: string, nodeId: string, moduleKey: string, input: ModuleInput, actor: Actor): Promise<object> {
    await this.requireWritableVersion(versionId);
    const template = await this.templates.forNode(versionId, nodeId);
    const definition = activeModules(template.modules).find(m => m.moduleKey === moduleKey);
    if (!definition) throw new BadRequestException('未知研究模块。');
    await this.requireResearchPermission(versionId, nodeId, actor);
    const record = await this.recordForNode(versionId, nodeId);
    const module = await this.prisma.researchModule.findUniqueOrThrow({ where: { recordId_moduleKey: { recordId: record.id, moduleKey } } });
    const expected = Number(input.expectedRevisionNo);
    if (!Number.isInteger(expected)) throw new BadRequestException('保存时必须携带 expectedRevisionNo。');
    if (module.revisionNo !== expected) throw new ConflictException({ message: '研究模块已被他人更新，请刷新后重试。', expectedRevisionNo: expected, currentRevisionNo: module.revisionNo });
    const values = this.mergeValues(module.values as JsonMap, input.values ?? [], definition.fields);
    const naReasons = { ...(module.naReasons as JsonMap), ...this.cleanNaReasons(input.notApplicableReasons ?? {}, definition.fields) };
    // 字段级提交只清理本次编辑字段的不适用状态，不能覆盖其他字段的理由。
    for (const entry of input.values ?? []) if (entry.fieldKey && !input.notApplicableReasons?.[entry.fieldKey]) delete naReasons[entry.fieldKey];
    const nextRevision = module.revisionNo + 1;
    const nextStatus = 'in_progress';
    const saved = await this.prisma.$transaction(async (tx) => {
      await this.templates.assertCurrent(tx, template.systemId, template.level, input.expectedTemplateRevision, template.revisionNo);
      return (await this.persistModuleRevision(tx, {
      versionId,
      recordId: record.id,
      module,
      moduleKey,
      values,
      naReasons,
      nextStatus,
      action: 'saved',
      actor,
    })).module;
    });
    const evidence = await this.prisma.evidence.findMany({ where: { recordId: record.id, moduleKey } });
    return this.moduleView(saved, evidence, moduleKey, definition);
  }

  async saveSummary(versionId: string, nodeId: string, input: { expectedTemplateRevision?: number; expectedRevisionNo?: number; summary?: string; sourceRevisionIds?: string[] }, actor: Actor): Promise<object> {
    await this.requireWritableVersion(versionId);
    await this.requireResearchPermission(versionId, nodeId, actor);
    const record = await this.recordForNode(versionId, nodeId);
    const expected = Number(input.expectedRevisionNo);
    if (!Number.isInteger(expected)) throw new BadRequestException('保存摘要时必须携带 expectedRevisionNo。');
    const current = await this.prisma.researchSummaryRevision.aggregate({ where: { recordId: record.id }, _max: { revisionNo: true } });
    const currentRevisionNo = current._max.revisionNo ?? 0;
    if (expected !== currentRevisionNo) throw new ConflictException({ message: '研究摘要已被他人更新，请刷新后重试。', expectedRevisionNo: expected, currentRevisionNo });
    const summary = input.summary?.trim();
    const sourceRevisionIds = [...new Set(input.sourceRevisionIds ?? [])];
    if (!summary) throw new BadRequestException('研究结论摘要不能为空。');
    if (!sourceRevisionIds.length) throw new BadRequestException('摘要必须引用至少一条模块修订。');
    const validSources = await this.prisma.researchRevision.count({ where: { id: { in: sourceRevisionIds }, module: { recordId: record.id } } });
    if (validSources !== sourceRevisionIds.length) throw new BadRequestException('摘要引用了不属于当前指标的模块修订。');
    const nextRevisionNo = currentRevisionNo + 1;
    const template = await this.templates.forNode(versionId, nodeId);
    return this.prisma.$transaction(async (tx) => {
      await this.templates.assertCurrent(tx, template.systemId, template.level, input.expectedTemplateRevision, template.revisionNo);
      const fresh = await tx.researchSummaryRevision.aggregate({ where: { recordId: record.id }, _max: { revisionNo: true } });
      if ((fresh._max.revisionNo ?? 0) !== expected) throw new ConflictException('摘要已被更新，请刷新后核对。');
      await tx.researchRecord.update({ where: { id: record.id }, data: { summary, revisionNo: { increment: 1 } } });
      const revision = await tx.researchSummaryRevision.create({ data: { recordId: record.id, revisionNo: nextRevisionNo, summary, sourceRevisionIds, actorUserId: actor.userId, actorName: actor.name } });
      await this.audit(tx, actor, 'research_summary.saved', 'ResearchRecord', record.id, versionId, { revisionNo: nextRevisionNo, sourceRevisionIds });
      return { summary, revisionNo: revision.revisionNo, sourceRevisionIds, updatedAt: revision.createdAt.toISOString() };
    });
  }

  async evidenceList(versionId: string, nodeId: string, moduleKey: string | undefined, actor: Actor): Promise<object[]> {
    await this.systemAccess.requireForVersion(versionId, actor, ['canView']);
    await this.requireContentNode(versionId, nodeId);
    const record = await this.recordForNode(versionId, nodeId);
    return this.prisma.evidence.findMany({ where: { recordId: record.id, ...(moduleKey ? { moduleKey } : {}) }, orderBy: { updatedAt: 'desc' } });
  }

  async createEvidence(versionId: string, nodeId: string, moduleKey: string, input: EvidenceInput, actor: Actor): Promise<object> {
    await this.requireWritableVersion(versionId);
    await this.requireResearchOrReviewScope(versionId, nodeId, actor);
    const template = await this.templates.forNode(versionId, nodeId);
    const definition = activeModules(template.modules).find(m => m.moduleKey === moduleKey); if (!definition) throw new BadRequestException('未知研究模块。');
    const title = input.title?.trim(); const type = input.type?.trim();
    if (!title || !type) throw new BadRequestException('依据标题和类型不能为空。');
    const keys = input.fieldKeys ?? [];
    if (keys.some((key) => !definition.fields.some((field) => field.fieldId === key))) throw new BadRequestException('依据引用了当前模块不存在的字段。');
    const status = input.verificationStatus ?? 'pending_verification';
    if (!EVIDENCE_STATUSES.has(status)) throw new BadRequestException('无效的依据核验状态。');
    const record = await this.recordForNode(versionId, nodeId);
    const evidence = await this.prisma.$transaction(async (tx) => {
      await this.templates.assertCurrent(tx, template.systemId, template.level, input.expectedTemplateRevision, template.revisionNo);
      const created = await tx.evidence.create({ data: { recordId: record.id, moduleKey, type, title, sourceUrl: input.sourceUrl?.trim() || null, excerpt: input.excerpt?.trim() || null, verificationStatus: status, fieldKeys: keys } });
      await this.audit(tx, actor, 'evidence.created', 'Evidence', created.id, versionId, { moduleKey, status }); return created;
    });
    return evidence;
  }

  async updateEvidence(versionId: string, nodeId: string, evidenceId: string, input: EvidenceInput, actor: Actor): Promise<object> {
    await this.requireWritableVersion(versionId);
    await this.requireResearchOrReviewScope(versionId, nodeId, actor);
    const record = await this.recordForNode(versionId, nodeId);
    const current = await this.prisma.evidence.findFirst({ where: { id: evidenceId, recordId: record.id } });
    if (!current) throw new NotFoundException('依据材料不存在。');
    const template = await this.templates.forNode(versionId, nodeId);
    const definition = activeModules(template.modules).find(m => m.moduleKey === current.moduleKey);
    if (!definition) throw new BadRequestException('模块已停用。'); const status = input.verificationStatus ?? current.verificationStatus;
    if (!EVIDENCE_STATUSES.has(status)) throw new BadRequestException('无效的依据核验状态。');
    const keys = input.fieldKeys ?? (current.fieldKeys as string[]);
    if (keys.some((key) => !definition.fields.some((field) => field.fieldId === key))) throw new BadRequestException('依据引用了当前模块不存在的字段。');
    return this.prisma.$transaction(async (tx) => {
      await this.templates.assertCurrent(tx, template.systemId, template.level, input.expectedTemplateRevision, template.revisionNo);
      const updated = await tx.evidence.update({ where: { id: evidenceId }, data: { ...(input.title === undefined ? {} : { title: input.title.trim() }), ...(input.type === undefined ? {} : { type: input.type.trim() }), ...(input.sourceUrl === undefined ? {} : { sourceUrl: input.sourceUrl?.trim() || null }), ...(input.excerpt === undefined ? {} : { excerpt: input.excerpt?.trim() || null }), verificationStatus: status, fieldKeys: keys } });
      await this.audit(tx, actor, 'evidence.updated', 'Evidence', evidenceId, versionId, { status }); return updated;
    });
  }

  async deleteEvidence(versionId: string, nodeId: string, evidenceId: string, actor: Actor): Promise<void> {
    await this.requireWritableVersion(versionId);
    await this.requireResearchOrReviewScope(versionId, nodeId, actor);
    const record = await this.recordForNode(versionId, nodeId); const evidence = await this.prisma.evidence.findFirst({ where: { id: evidenceId, recordId: record.id } });
    if (!evidence) throw new NotFoundException('依据材料不存在。');
    await this.prisma.$transaction(async (tx) => { await tx.evidence.delete({ where: { id: evidenceId } }); await this.audit(tx, actor, 'evidence.deleted', 'Evidence', evidenceId, versionId); });
  }

  async revisions(versionId: string, nodeId: string, moduleKey: string | undefined, actor: Actor): Promise<object[]> {
    await this.systemAccess.requireForVersion(versionId, actor, ['canView']);
    await this.requireContentNode(versionId, nodeId);
    const record = await this.recordForNode(versionId, nodeId);
    const modules = await this.prisma.researchModule.findMany({ where: { recordId: record.id, ...(moduleKey ? { moduleKey } : {}) }, include: { revisions: { orderBy: { createdAt: 'desc' } } } });
    return modules.flatMap((module) => module.revisions.map((revision) => ({ id: revision.id, revision: revision.revisionNo, moduleKey: module.moduleKey, action: revision.action, actorName: revision.actorName, createdAt: revision.createdAt.toISOString(), snapshot: revision.snapshot }))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async auditLogs(versionId: string): Promise<object[]> {
    await this.version(versionId);
    return this.prisma.auditLog.findMany({ where: { versionId }, orderBy: { at: 'desc' }, take: 100 });
  }

  async suggestions(versionId: string, nodeId: string, actor: Actor): Promise<object[]> {
    await this.systemAccess.requireForVersion(versionId, actor, ['canView']);
    await this.requireContentNode(versionId, nodeId);
    const record = await this.recordForNode(versionId, nodeId);
    const suggestions = await this.prisma.aISuggestion.findMany({ where: { recordId: record.id }, orderBy: { createdAt: 'desc' } });
    return suggestions.map((suggestion) => this.suggestionView(suggestion));
  }

  async createSuggestion(versionId: string, nodeId: string, input: SuggestionInput, actor: Actor): Promise<object> {
    requireRole(actor, ['system_admin', 'ai_service']);
    await this.requireWritableVersion(versionId);
    const targetType = input.targetType ?? 'module';
    if (!['module', 'summary'].includes(targetType)) throw new BadRequestException('AI建议目标类型无效。');
    const template = await this.templates.forNode(versionId, nodeId);
    const moduleKey = input.moduleKey?.trim(); const definition = activeModules(template.modules).find(m => m.moduleKey === moduleKey);
    if (targetType === 'module' && !definition) throw new BadRequestException('模块建议必须包含有效模块。');
    if (targetType === 'summary' && (moduleKey || input.fieldKey)) throw new BadRequestException('摘要建议不能指定模块字段。');
    if (!input.content?.trim() || !input.rationale?.trim()) throw new BadRequestException('AI建议必须包含正文和说明。');
    if (input.fieldKey && !definition?.fields.some((field) => field.fieldId === input.fieldKey)) throw new BadRequestException('AI建议目标字段不属于当前模块。');
    const confidence = input.confidence ?? 'needs_verification';
    if (!['supported', 'inference', 'needs_verification'].includes(confidence)) throw new BadRequestException('AI建议置信状态无效。');
    const record = await this.recordForNode(versionId, nodeId);
    const evidenceIds = [...new Set(input.evidenceIds ?? [])];
    const sourceRevisionIds = [...new Set(input.sourceRevisionIds ?? [])];
    if (evidenceIds.length) {
      const count = await this.prisma.evidence.count({ where: { id: { in: evidenceIds }, recordId: record.id } });
      if (count !== evidenceIds.length) throw new BadRequestException('AI建议引用了不属于当前指标的依据。');
    }
    if (sourceRevisionIds.length) {
      const count = await this.prisma.researchRevision.count({ where: { id: { in: sourceRevisionIds }, module: { recordId: record.id } } });
      if (count !== sourceRevisionIds.length) throw new BadRequestException('AI建议引用了不属于当前指标的模块修订。');
    }
    const content = input.content!.trim();
    const rationale = input.rationale!.trim();
    return this.prisma.$transaction(async (tx) => {
      await this.templates.assertCurrent(tx, template.systemId, template.level, input.expectedTemplateRevision, template.revisionNo);
      const suggestion = await tx.aISuggestion.create({ data: { templateRevision: template.revisionNo, recordId: record.id, targetType, moduleKey: moduleKey ?? null, fieldKey: input.fieldKey ?? null, content, rationale, confidence, evidenceIds, verificationItems: [...new Set(input.verificationItems ?? [])].map((item) => item.trim()).filter(Boolean), sourceRevisionIds, modelId: input.modelId?.trim() || 'unconfigured', promptVersion: input.promptVersion?.trim() || 'm0-contract' } });
      await this.audit(tx, actor, 'ai_suggestion.created', 'AISuggestion', suggestion.id, versionId, { targetType, moduleKey: moduleKey ?? null, evidenceCount: evidenceIds.length, sourceRevisionCount: sourceRevisionIds.length });
      return this.suggestionView(suggestion);
    });
  }

  async decideSuggestion(versionId: string, nodeId: string, suggestionId: string, input: SuggestionDecisionInput, actor: Actor): Promise<object> {
    await this.requireWritableVersion(versionId);
    await this.requireResearchPermission(versionId, nodeId, actor);
    const record = await this.recordForNode(versionId, nodeId);
    const suggestion = await this.prisma.aISuggestion.findFirst({ where: { id: suggestionId, recordId: record.id } });
    if (!suggestion) throw new NotFoundException('AI建议不存在。');
    if (suggestion.status !== 'pending') throw new ConflictException('AI建议已被处理。');
    if (input.decision === 'rejected') return this.prisma.$transaction(async (tx) => {
      const updated = await tx.aISuggestion.update({ where: { id: suggestionId }, data: { status: 'rejected', decisionReason: input.reason?.trim() || null, decidedAt: new Date(), decidedByUserId: actor.userId } });
      await this.audit(tx, actor, 'ai_suggestion.rejected', 'AISuggestion', suggestionId, versionId, { reason: input.reason?.trim() ?? null });
      return this.suggestionView(updated);
    });
    if (input.decision !== 'accepted') throw new BadRequestException('建议处理结果必须是 accepted 或 rejected。');
    const suggestionTemplate = await this.templates.forNode(versionId, nodeId);
    if (suggestion.templateRevision !== suggestionTemplate.revisionNo) throw new ConflictException('模板已变更，请重新生成 AI 建议。');
    if (suggestion.targetType === 'summary') {
      const sourceRevisionIds = (suggestion.sourceRevisionIds as string[]).filter(Boolean);
      if (!sourceRevisionIds.length) throw new BadRequestException('采纳摘要建议前必须存在至少一条来源模块修订。');
      const expected = Number(input.expectedRevisionNo);
      if (!Number.isInteger(expected)) throw new BadRequestException('采纳摘要建议时必须携带 expectedRevisionNo。');
      const current = await this.prisma.researchSummaryRevision.aggregate({ where: { recordId: record.id }, _max: { revisionNo: true } });
      const currentRevisionNo = current._max.revisionNo ?? 0;
      if (expected !== currentRevisionNo) throw new ConflictException({ message: '研究摘要已被他人更新，请刷新后重试。', expectedRevisionNo: expected, currentRevisionNo });
      const nextRevisionNo = currentRevisionNo + 1;
      return this.prisma.$transaction(async (tx) => {
        await this.templates.assertCurrent(tx, suggestionTemplate.systemId, suggestionTemplate.level, suggestion.templateRevision);
        await tx.researchRecord.update({ where: { id: record.id }, data: { summary: suggestion.content, revisionNo: { increment: 1 } } });
        const revision = await tx.researchSummaryRevision.create({ data: { recordId: record.id, revisionNo: nextRevisionNo, summary: suggestion.content, sourceRevisionIds, actorUserId: actor.userId, actorName: actor.name } });
        const updated = await tx.aISuggestion.update({ where: { id: suggestionId }, data: { status: 'accepted', decidedAt: new Date(), decidedByUserId: actor.userId, resultRevisionId: revision.id } });
        await this.audit(tx, actor, 'ai_suggestion.accepted', 'AISuggestion', suggestionId, versionId, { targetType: 'summary', resultRevisionId: revision.id });
        return { suggestion: this.suggestionView(updated), summary: { summary: suggestion.content, revisionNo: revision.revisionNo, sourceRevisionIds, resultRevisionId: revision.id } };
      });
    }
    if (!suggestion.moduleKey) throw new BadRequestException('模块建议缺少目标模块。');
    const moduleKey = suggestion.moduleKey;
    const fieldKey = input.fieldKey ?? suggestion.fieldKey; if (!fieldKey) throw new BadRequestException('采纳AI建议时必须选择目标字段。');
    const template = await this.templates.forNode(versionId, nodeId);
    const definition = activeModules(template.modules).find(m => m.moduleKey === moduleKey);
    if (!definition) throw new BadRequestException('模块建议包含未知研究模块。');
    const expected = Number(input.expectedRevisionNo);
    if (!Number.isInteger(expected)) throw new BadRequestException('采纳模块建议时必须携带 expectedRevisionNo。');
    return this.prisma.$transaction(async (tx) => {
      await this.templates.assertCurrent(tx, suggestionTemplate.systemId, suggestionTemplate.level, suggestion.templateRevision);
      const pendingSuggestion = await tx.aISuggestion.findFirst({ where: { id: suggestionId, recordId: record.id, status: 'pending' } });
      if (!pendingSuggestion) throw new ConflictException('AI建议已被处理。');
      const module = await tx.researchModule.findUniqueOrThrow({ where: { recordId_moduleKey: { recordId: record.id, moduleKey } } });
      if (module.revisionNo !== expected) throw new ConflictException({ message: '研究模块已被他人更新，请刷新后重试。', expectedRevisionNo: expected, currentRevisionNo: module.revisionNo });
      const values = this.mergeValues(module.values as JsonMap, [{ fieldKey, value: input.value ?? pendingSuggestion.content }], definition.fields);
      const naReasons = module.naReasons as JsonMap;
      const nextStatus = 'in_progress';
      const persisted = await this.persistModuleRevision(tx, {
        versionId,
        recordId: record.id,
        module,
        moduleKey,
        values,
        naReasons,
        nextStatus,
        action: 'saved',
        actor,
      });
      const accepted = await tx.aISuggestion.updateMany({
        where: { id: suggestionId, recordId: record.id, status: 'pending' },
        data: { status: 'accepted', decidedAt: new Date(), decidedByUserId: actor.userId, resultRevisionId: persisted.revision.id },
      });
      if (accepted.count !== 1) throw new ConflictException('AI建议已被处理。');
      const updated = await tx.aISuggestion.findUniqueOrThrow({ where: { id: suggestionId } });
      await this.audit(tx, actor, 'ai_suggestion.accepted', 'AISuggestion', suggestionId, versionId, { targetType: 'module', moduleKey, fieldKey, resultRevisionId: persisted.revision.id });
      const evidence = await tx.evidence.findMany({ where: { recordId: record.id, moduleKey } });
      return { suggestion: this.suggestionView(updated), module: this.moduleView(persisted.module, evidence, moduleKey, definition) };
    });
  }

  async cloneVersion(versionId: string, input: { year?: number; versionCode?: string }, actor: Actor): Promise<object> {
    await this.systemAccess.requireForVersion(versionId, actor, ['canManageCatalog']);
    const source = await this.prisma.indicatorVersion.findUnique({ where: { id: versionId }, include: { nodes: { orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }] }, records: { include: { modules: { include: { revisions: { orderBy: { revisionNo: 'asc' } } } }, evidence: true, summaryRevisions: { orderBy: { revisionNo: 'asc' } } } }, system: true } });
    if (!source) throw new NotFoundException('指标体系版本不存在。');
    const year = input.year ?? source.year; const versionCode = input.versionCode?.trim();
    if (!versionCode) throw new BadRequestException('复制版本必须提供新版本号。');
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.templates.lock(tx, source.systemId);
        const templateRows = await tx.indicatorLevelTemplate.findMany({ where: { systemId: source.systemId } });
        const target = await tx.indicatorVersion.create({ data: { systemId: source.systemId, year, versionCode, status: 'draft' } });
        const nodeMap = new Map<string, string>();
        for (const sourceNode of source.nodes) {
          const parentId = sourceNode.parentId ? nodeMap.get(sourceNode.parentId) : null;
          const created = await tx.indicatorNode.create({ data: { versionId: target.id, parentId: parentId ?? null, parentKey: parentId ?? '__root__', level: sourceNode.level, code: sourceNode.code, name: sourceNode.name, sortOrder: sourceNode.sortOrder } });
          nodeMap.set(sourceNode.id, created.id);
        }
        for (const sourceRecord of source.records) {
          const targetNodeId = nodeMap.get(sourceRecord.indicatorNodeId); if (!targetNodeId) continue;
          const targetRecord = await tx.researchRecord.create({ data: { versionId: target.id, indicatorNodeId: targetNodeId, summary: sourceRecord.summary, revisionNo: sourceRecord.revisionNo } });
          const revisionMap = new Map<string, string>();
          for (const sourceModule of sourceRecord.modules) {
            const copiedStatus = sourceModule.status === 'not_started' ? 'not_started' : 'in_progress';
            const copiedRevisionNo = sourceModule.revisions.length ? sourceModule.revisionNo + 1 : 0;
            const targetModule = await tx.researchModule.create({ data: { recordId: targetRecord.id, moduleKey: sourceModule.moduleKey, status: copiedStatus, values: sourceModule.values as Prisma.InputJsonValue, naReasons: sourceModule.naReasons as Prisma.InputJsonValue, revisionNo: copiedRevisionNo, returnReason: null } });
            for (const revision of sourceModule.revisions) {
              const copied = await tx.researchRevision.create({ data: { moduleId: targetModule.id, revisionNo: revision.revisionNo, snapshot: revision.snapshot as Prisma.InputJsonValue, actorUserId: revision.actorUserId, actorName: revision.actorName, action: revision.action } });
              revisionMap.set(revision.id, copied.id);
            }
            if (copiedRevisionNo > sourceModule.revisionNo) await tx.researchRevision.create({ data: { moduleId: targetModule.id, revisionNo: copiedRevisionNo, snapshot: { template: templateRows.find(t => t.level === source.nodes.find(n => n.id === sourceRecord.indicatorNodeId)?.level)?.modules, templateRevision: templateRows.find(t => t.level === source.nodes.find(n => n.id === sourceRecord.indicatorNodeId)?.level)?.revisionNo, evidence: JSON.parse(JSON.stringify(sourceRecord.evidence.filter(e => e.moduleKey === sourceModule.moduleKey))), values: sourceModule.values, naReasons: sourceModule.naReasons, status: copiedStatus, sourceVersionId: source.id } as Prisma.InputJsonValue, actorUserId: actor.userId, actorName: actor.name, action: 'cloned' } });
          }
          for (const summaryRevision of sourceRecord.summaryRevisions) {
            const mappedSources = (summaryRevision.sourceRevisionIds as string[]).map((id) => revisionMap.get(id)).filter((id): id is string => Boolean(id));
            await tx.researchSummaryRevision.create({ data: { recordId: targetRecord.id, revisionNo: summaryRevision.revisionNo, summary: summaryRevision.summary, sourceRevisionIds: mappedSources, actorUserId: summaryRevision.actorUserId, actorName: summaryRevision.actorName } });
          }
          for (const evidence of sourceRecord.evidence) await tx.evidence.create({ data: { recordId: targetRecord.id, moduleKey: evidence.moduleKey, fieldKeys: evidence.fieldKeys as Prisma.InputJsonValue, type: evidence.type, title: evidence.title, sourceUrl: evidence.sourceUrl, excerpt: evidence.excerpt, verificationStatus: evidence.verificationStatus } });
        }
        await this.audit(tx, actor, 'indicator_version.cloned', 'IndicatorVersion', target.id, target.id, { sourceVersionId: source.id });
        return { id: target.id, systemId: target.systemId, year: target.year, versionCode: target.versionCode, status: target.status };
      });
    } catch (error) { if (this.isUniqueError(error)) throw new ConflictException('目标年度和版本号已存在。'); throw error; }
  }

  async previewImport(versionId: string, file: Buffer, actor: Actor): Promise<object> {
    await this.systemAccess.requireForVersion(versionId, actor, ['canManageCatalog']);
    await this.requireWritableVersion(versionId);
    const rows = await this.readImportRows(file);
    const existing = await this.prisma.indicatorNode.findMany({ where: { versionId }, select: { code: true, level: true } });
    return this.validateImportRows(rows, existing, (await this.version(versionId)).system.maxLevel);
  }

  async importTree(versionId: string, file: Buffer, actor: Actor): Promise<object> {
    await this.systemAccess.requireForVersion(versionId, actor, ['canManageCatalog']);
    await this.requireWritableVersion(versionId);
    const rows = await this.readImportRows(file);
    const existing = await this.prisma.indicatorNode.findMany({ where: { versionId }, select: { code: true, level: true } });
    const result = this.validateImportRows(rows, existing);
    if ((result as { valid: boolean }).valid === false) throw new BadRequestException(result);
    const parsed = (result as { rows: Array<{ level: number; code: string; name: string; sortOrder: number; parentCode?: string }> }).rows;
    await this.prisma.$transaction(async (tx) => {
      const currentVersion = await this.version(versionId);
      const currentSystem = await this.templates.lock(tx, currentVersion.systemId);
      if (parsed.some(r => r.level > currentSystem.maxLevel)) throw new ConflictException('最大层级已变更，请重新导入。');
      const byCode = new Map<string, { id: string; level: number }>();
      const current = await tx.indicatorNode.findMany({ where: { versionId } });
      current.forEach((node) => byCode.set(node.code, node));
      for (const row of [...parsed].sort((a, b) => a.level - b.level || a.sortOrder - b.sortOrder)) {
        const parent = row.parentCode ? byCode.get(row.parentCode) : undefined;
        const node = await tx.indicatorNode.create({ data: { versionId, parentId: parent?.id ?? null, parentKey: parent?.id ?? '__root__', level: row.level, code: row.code, name: row.name, sortOrder: row.sortOrder } });
        byCode.set(row.code, node);
      }
      await this.audit(tx, actor, 'indicator_tree.imported', 'IndicatorVersion', versionId, versionId, { rowCount: parsed.length });
    });
    return { imported: parsed.length };
  }

  private async readImportRows(file: Buffer): Promise<Array<{ row: number; level: unknown; code: unknown; name: unknown; parentCode: unknown; sortOrder: unknown }>> {
    return readXlsxRows(file);
  }

  private validateImportRows(rows: Array<{ row: number; level: unknown; code: unknown; name: unknown; parentCode: unknown; sortOrder: unknown }>, existing: Array<{ code: string; level: number }> = [], maxLevel = 3): object {
    const errors: Array<{ row: number; field: string; reason: string }> = []; const parsed: Array<{ level: number; code: string; name: string; parentCode?: string; sortOrder: number }> = []; const codeLevel = new Map<string, number>(existing.map((node) => [node.code, node.level])); const importedCodes = new Set<string>();
    if (!rows.length) errors.push({ row: 1, field: 'file', reason: '导入文件没有数据行。' });
    for (const item of rows) {
      const level = Number(item.level); const code = String(item.code ?? '').trim(); const name = String(item.name ?? '').trim(); const parentCode = String(item.parentCode ?? '').trim();
      if (!Number.isInteger(level) || level < 1 || level > maxLevel) errors.push({ row: item.row, field: 'level', reason: `层级仅支持1至${maxLevel}级。` });
      if (!code) errors.push({ row: item.row, field: 'code', reason: '指标编码不能为空。' });
      if (!name) errors.push({ row: item.row, field: 'name', reason: '指标名称不能为空；空白单元不会导入为已确认事实。' });
      if (level === 1 && parentCode) errors.push({ row: item.row, field: 'parentCode', reason: '一级指标不得填写父级编码。' });
      if (level > 1 && !parentCode) errors.push({ row: item.row, field: 'parentCode', reason: '非一级指标必须填写父级编码。' });
      if (code && importedCodes.has(code)) errors.push({ row: item.row, field: 'code', reason: '同一导入文件中指标编码重复。' });
      if (code && existing.some((node) => node.code === code)) errors.push({ row: item.row, field: 'code', reason: '指标编码与当前版本已有目录重复。' });
      if (code) importedCodes.add(code);
      if (code) codeLevel.set(code, level);
      parsed.push({ level, code, name, parentCode: parentCode || undefined, sortOrder: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : item.row });
    }
    for (const item of parsed) if (item.parentCode) { const parentLevel = codeLevel.get(item.parentCode); if (parentLevel === undefined) errors.push({ row: rows[parsed.indexOf(item)]!.row, field: 'parentCode', reason: '父级编码不在当前导入文件中。' }); else if (parentLevel !== item.level - 1) errors.push({ row: rows[parsed.indexOf(item)]!.row, field: 'parentCode', reason: '父级层级必须恰好高一级。' }); }
    return { valid: errors.length === 0, errors, rows: errors.length === 0 ? parsed : undefined, mapping: { level: 'level/层级', code: 'code/指标编码', name: 'name/指标名称', parentCode: 'parentCode/父级编码', sortOrder: 'sortOrder/排序' }, workbookResearchMapping: WORKBOOK_COLUMN_MAPPINGS };
  }

  private async version(id: string, includeSystem = false) {
    const version = await this.prisma.indicatorVersion.findUnique({ where: { id }, include: { system: true } });
    if (!version) throw new NotFoundException('指标体系版本不存在。'); return version;
  }
  private async requireContentNode(versionId: string, nodeId: string) {
    const node = await this.prisma.indicatorNode.findFirst({ where: { id: nodeId, versionId } });
    if (!node) throw new NotFoundException('指标节点不存在。');
    return node;
  }
  async requireResearchPermission(versionId: string, nodeId: string, actor: Actor): Promise<void> {
    await this.requireContentNode(versionId, nodeId);
    if (actor.role === 'system_admin' || actor.role === 'ai_service') return;
    await this.systemAccess.requireForVersion(versionId, actor, ['canResearch']);
  }
  private async requireResearchOrReviewScope(versionId: string, nodeId: string, actor: Actor): Promise<void> {
    await this.requireContentNode(versionId, nodeId);
    if (actor.role === 'system_admin') return;
    const permissions = await this.systemAccess.permissionsForVersion(versionId, actor);
    if (permissions.canReview) return;
    await this.requireResearchPermission(versionId, nodeId, actor);
  }
  private async requireWritableVersion(id: string, includeSystem = false) { return this.version(id, includeSystem); }
  private async validateParent(versionId: string, level: number, parentId: string | null) {
    if (level === 1) { if (parentId) throw new BadRequestException('一级指标不能设置父节点。'); return null; }
    if (!parentId) throw new BadRequestException('二级及以上指标必须设置父节点。');
    const parent = await this.prisma.indicatorNode.findFirst({ where: { id: parentId, versionId } });
    if (!parent) throw new BadRequestException('父指标不存在或不属于当前版本。');
    if (parent.level !== level - 1) throw new BadRequestException('父指标必须恰好高一级。'); return parent;
  }
  private async ensureRecord(versionId: string, nodeId: string, level?: number) {
    const template = await this.templates.forNode(versionId, nodeId);
    const record = await this.prisma.researchRecord.upsert({ where: { versionId_indicatorNodeId: { versionId, indicatorNodeId: nodeId } }, update: {}, create: { versionId, indicatorNodeId: nodeId } });
    await this.prisma.researchModule.createMany({ data: template.modules.map(m => ({ recordId: record.id, moduleKey: m.moduleKey })), skipDuplicates: true });
    return record;
  }
  private async recordForNode(versionId: string, nodeId: string) {
    const node = await this.requireContentNode(versionId, nodeId);
    return this.ensureRecord(versionId, node.id, node.level);
  }
  private toTree(nodes: Array<{ id: string; parentId: string | null; level: number; code: string; name: string; sortOrder: number }>, progressByNode: Map<string, number> = new Map()): object[] {
    const byId = new Map<string, object>(); const roots: object[] = [];
    for (const node of nodes) byId.set(node.id, { id: node.id, parentId: node.parentId, level: node.level, code: node.code, name: node.name, sortOrder: node.sortOrder, progress: progressByNode.get(node.id) ?? 0, issues: 0, children: [] as object[] });
    for (const node of nodes) { const item = byId.get(node.id)! as { children: object[] }; if (node.parentId) { const parent = byId.get(node.parentId) as { children: object[] } | undefined; if (parent) parent.children.push(item); } else roots.push(item); }
    return roots;
  }
  private mergeValues(current: JsonMap, entries: Array<{ fieldKey?: string; value?: unknown }>, fields: ContractField[]): JsonMap {
    const result = { ...current }; const allowed = new Set(fields.map((field) => field.fieldId));
    const definitions = new Map(fields.map((field) => [field.fieldId, field]));
    for (const entry of entries) {
      if (!entry.fieldKey || !allowed.has(entry.fieldKey)) throw new BadRequestException(`字段 ${entry.fieldKey ?? ''} 不属于当前模块。`);
      const value = entry.value ?? null;
      const error = JSON.stringify(current[entry.fieldKey]) === JSON.stringify(value) ? null : this.valueValidationError(definitions.get(entry.fieldKey)!, value);
      if (error) throw new BadRequestException(`字段 ${entry.fieldKey} ${error}`);
      result[entry.fieldKey] = value;
    }
    return result;
  }
  private cleanNaReasons(reasons: Record<string, string>, fields: ContractField[]): JsonMap {
    if (!reasons || typeof reasons !== 'object' || Array.isArray(reasons)) throw new BadRequestException('不适用理由必须是对象。');
    const allowed = new Map(fields.map((field) => [field.fieldId, field])); const output: JsonMap = {};
    for (const [key, reason] of Object.entries(reasons)) { const field = allowed.get(key); if (!field?.allowNotApplicable) throw new BadRequestException(`字段 ${key} 不支持不适用说明。`); if (!reason?.trim()) throw new BadRequestException(`字段 ${key} 的不适用说明不能为空。`); output[key] = reason.trim(); }
    return output;
  }
  private valueValidationError(field: ContractField, value: unknown): string | null {
    if (value === null || value === undefined || value === '') return null;
    if (field.fieldType === 'number' || field.fieldType === 'decimal' || field.fieldType === 'percentage') {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '必须是有效数字。';
      if (field.fieldType === 'percentage' && (value < 0 || value > 100)) return '必须在 0 至 100 之间。';
      return null;
    }
    if (field.fieldType === 'date') {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) return '必须是 YYYY-MM-DD 日期。';
      return null;
    }
    if (field.fieldType === 'enum') return typeof value === 'string' && field.enumValues?.includes(value) ? null : `必须从规定选项中选择（${field.enumValues?.join('、') || '无可用选项'}）。`;
    if (['short_text', 'long_text', 'rich_text'].includes(field.fieldType)) return typeof value === 'string' ? null : '必须是文本。';
    if (['reference_list', 'object_list', 'organization_contact_list'].includes(field.fieldType)) return typeof value === 'string' || Array.isArray(value) || (typeof value === 'object' && value !== null) ? null : '必须是文本、列表或对象。';
    return null;
  }
  private async persistModuleRevision(tx: Prisma.TransactionClient, input: {
    versionId: string;
    recordId: string;
    module: { id: string; status: string; revisionNo: number };
    moduleKey: string;
    values: JsonMap;
    naReasons: JsonMap;
    nextStatus: string;
    action: 'saved';
    actor: Actor;
  }) {
    const record = await tx.researchRecord.findUniqueOrThrow({ where: { id: input.recordId }, include: { indicatorNode: true, version: true } });
    const template = await tx.indicatorLevelTemplate.findUniqueOrThrow({ where: { systemId_level: { systemId: record.version.systemId, level: record.indicatorNode.level } } });
    const evidence = await tx.evidence.findMany({ where: { recordId: input.recordId, moduleKey: input.moduleKey } });
    const nextRevision = input.module.revisionNo + 1;
    const updated = await tx.researchModule.updateMany({
      where: { id: input.module.id, revisionNo: input.module.revisionNo, status: input.module.status },
      data: { values: input.values as Prisma.InputJsonValue, naReasons: input.naReasons as Prisma.InputJsonValue, revisionNo: nextRevision, status: input.nextStatus },
    });
    if (updated.count !== 1) {
      const current = await tx.researchModule.findUniqueOrThrow({ where: { id: input.module.id } });
      throw new ConflictException({ message: '研究模块已被他人更新，请刷新后重试。', expectedRevisionNo: input.module.revisionNo, currentRevisionNo: current.revisionNo });
    }
    const module = await tx.researchModule.findUniqueOrThrow({ where: { id: input.module.id } });
    await tx.researchRecord.update({ where: { id: input.recordId }, data: { revisionNo: { increment: 1 } } });
    const revision = await tx.researchRevision.create({
      data: {
        moduleId: input.module.id,
        revisionNo: nextRevision,
        snapshot: { templateRevision: template.revisionNo, template: template.modules, evidence: JSON.parse(JSON.stringify(evidence)), values: input.values, naReasons: input.naReasons, status: input.nextStatus } as Prisma.InputJsonValue,
        actorUserId: input.actor.userId,
        actorName: input.actor.name,
        action: input.action,
      },
    });
    await this.audit(tx, input.actor, 'research_module.saved', 'ResearchModule', input.module.id, input.versionId, { moduleKey: input.moduleKey, revisionNo: nextRevision });
    return { module, revision };
  }
  private moduleView(module: { id: string; moduleKey: string; status: string; revisionNo: number; returnReason: string | null; values: unknown; naReasons: unknown; updatedAt: Date }, evidence: Array<{ id: string; title: string; type: string; sourceUrl: string | null; excerpt: string | null; verificationStatus: string; fieldKeys: unknown }>, moduleKey: string, definition: ModuleDefinition): object {
    const values = module.values as JsonMap; const naReasons = module.naReasons as JsonMap;
    return { id: module.id, moduleKey, status: module.revisionNo > 0 ? 'in_progress' : 'not_started', revisionNo: module.revisionNo, completedFields: definition.fields.filter((field) => values[field.fieldId] !== null && values[field.fieldId] !== undefined && values[field.fieldId] !== '').length, totalFields: definition.fields.length, values: definition.fields.map((field) => ({ fieldKey: field.fieldId, value: values[field.fieldId] ?? null, notApplicableReason: typeof naReasons[field.fieldId] === 'string' ? naReasons[field.fieldId] : undefined, evidenceStatus: evidence.some((item) => item.verificationStatus === 'verified' && (item.fieldKeys as string[]).includes(field.fieldId)) ? 'confirmed' : 'pending', evidence: evidence.filter((item) => (item.fieldKeys as string[]).includes(field.fieldId)).map((item) => ({ id: item.id, title: item.title, sourceType: item.type, sourceUrl: item.sourceUrl ?? undefined, excerpt: item.excerpt ?? undefined, status: item.verificationStatus === 'verified' ? 'confirmed' : 'pending' })) })), updatedAt: module.updatedAt.toISOString() };
  }
  private suggestionView(suggestion: { id: string; targetType: string; moduleKey: string | null; fieldKey: string | null; content: string; rationale: string; confidence: string; evidenceIds: unknown; verificationItems: unknown; sourceRevisionIds: unknown; modelId: string; promptVersion: string; status: string; decisionReason: string | null; decidedAt: Date | null; decidedByUserId: string | null; resultRevisionId: string | null; createdAt: Date }): object {
    return {
      id: suggestion.id,
      targetType: suggestion.targetType,
      moduleKey: suggestion.moduleKey ?? undefined,
      fieldKey: suggestion.fieldKey ?? undefined,
      content: suggestion.content,
      rationale: suggestion.rationale,
      confidence: suggestion.confidence,
      evidenceIds: Array.isArray(suggestion.evidenceIds) ? suggestion.evidenceIds : [],
      verificationItems: Array.isArray(suggestion.verificationItems) ? suggestion.verificationItems : [],
      sourceRevisionIds: Array.isArray(suggestion.sourceRevisionIds) ? suggestion.sourceRevisionIds : [],
      modelId: suggestion.modelId,
      promptVersion: suggestion.promptVersion,
      status: suggestion.status,
      decisionReason: suggestion.decisionReason ?? undefined,
      decidedAt: suggestion.decidedAt?.toISOString(),
      decidedByUserId: suggestion.decidedByUserId ?? undefined,
      resultRevisionId: suggestion.resultRevisionId ?? undefined,
      createdAt: suggestion.createdAt.toISOString(),
    };
  }
  private contentProgress(modules: Array<{ moduleKey: string; values: unknown; naReasons: unknown }>, definitions: ModuleDefinition[]): number {
    let total = 0, filled = 0;
    for (const d of activeModules(definitions)) {
      const m = modules.find(m => m.moduleKey === d.moduleKey);
      const values = (m?.values ?? {}) as JsonMap, reasons = (m?.naReasons ?? {}) as JsonMap;
      for (const f of d.fields) { total++; const v = values[f.fieldId]; if ((v !== null && v !== undefined && v !== '' && (!Array.isArray(v) || v.length > 0)) || reasons[f.fieldId]) filled++; }
    }
    return total ? Math.round(filled / total * 100) : 0;
  }
  private async versionProgress(versionId: string) {
    const version = await this.version(versionId);
    const templates = await this.prisma.indicatorLevelTemplate.findMany({ where: { systemId: version.systemId } });
    const nodes = await this.prisma.indicatorNode.findMany({ where: { versionId }, include: { record: { include: { modules: true } } } });
    const byNode = new Map(nodes.map(n => [n.id, this.contentProgress(n.record?.modules ?? [], (templates.find(t => t.level === n.level)?.modules as unknown as ModuleDefinition[]) ?? definitionsForLevel(n.level))]));
    return { byNode, total: nodes.length ? Math.round([...byNode.values()].reduce((a,b) => a+b,0) / nodes.length) : 0 };
  }
  private recordProgress(modules: Array<{ status: string; revisionNo: number }>): number { return modules.length ? Math.round((modules.filter((module) => module.revisionNo > 0).length / modules.length) * 100) : 0; }
  private systemSummary(system: { id: string; name: string; code: string; region: string; maxLevel: number; updatedAt: Date }, version: { id: string; year: number; versionCode: string; status: string }): object { return { id: system.id, name: system.name, maxLevel: system.maxLevel, code: system.code, year: version.year, version: version.versionCode, versionId: version.id, region: system.region, status: version.status, updatedAt: system.updatedAt.toISOString() }; }
  private async revisionsForRecord(recordId: string, take: number): Promise<object[]> { const modules = await this.prisma.researchModule.findMany({ where: { recordId }, include: { revisions: { orderBy: { createdAt: 'desc' }, take } } }); return modules.flatMap((module) => module.revisions.map((revision) => ({ id: revision.id, revision: revision.revisionNo, moduleKey: module.moduleKey, action: revision.action, actorName: revision.actorName, createdAt: revision.createdAt.toISOString() }))).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, take); }
  private async audit(tx: Prisma.TransactionClient, actor: Actor, action: string, targetType: string, targetId: string, versionId?: string, detail?: JsonMap): Promise<void> { await tx.auditLog.create({ data: { actorUserId: actor.userId, actorName: actor.name, actorRole: actor.role, action, targetType, targetId, versionId: versionId ?? null, detail: detail as Prisma.InputJsonValue | undefined } }); }
  private isUniqueError(error: unknown): boolean { return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'P2002'; }
}
