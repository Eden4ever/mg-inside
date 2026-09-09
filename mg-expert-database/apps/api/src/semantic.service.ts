import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { SystemAccessService } from './system-access';
import type { Actor } from './auth';
import { definitionsForLevel } from './contract';
import { ZhipuEmbedding } from './zhipu-embedding';
import { activeDefinitions, appendChunks, digest, readable, SourceChunk } from './semantic-source';

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const buildSelect = { id: true, status: true, total: true, completed: true, reused: true, tokens: true, error: true, createdAt: true, finishedAt: true, fingerprint: true } as const;

@Injectable()
export class SemanticService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private searching = 0;
  private stopped = false;
  constructor(@Inject(PrismaService) private readonly db: PrismaService, @Inject(SystemAccessService) private readonly access: SystemAccessService, @Inject(ZhipuEmbedding) private readonly embedding: ZhipuEmbedding) {}
  onModuleInit() { if (process.env.NODE_ENV === 'test') return; this.timer = setInterval(() => { void this.tick().catch(() => undefined); }, 2000); this.timer.unref(); }
  onModuleDestroy() { this.stopped = true; if (this.timer) clearInterval(this.timer); }
  async list(actor: Actor) {
    const access = await this.access.accessMap(actor);
    const libraries = await this.db.semanticLibrary.findMany({ where: access ? { version: { systemId: { in: [...access.keys()] } } } : {}, include: { version: { include: { system: true } }, builds: { orderBy: { createdAt: 'desc' }, take: 1, select: buildSelect } }, orderBy: { createdAt: 'desc' } });
    return { configured: this.embedding.configured, model: 'embedding-3', dimensions: 1024, libraries: libraries.map(l => ({ id: l.id, name: l.name, versionId: l.versionId, systemName: l.version.system.name, version: `${l.version.year} · ${l.version.versionCode}`, activeBuildId: l.activeBuildId, build: l.builds[0] || null, canManage: actor.role === 'system_admin' || Boolean(access?.get(l.version.systemId)?.canManageCatalog) })) };
  }
  async create(input: { versionId?: string; name?: string }, actor: Actor) {
    if (typeof input.versionId !== 'string' || !input.versionId) throw new BadRequestException('请选择体系版本');
    await this.access.requireForVersion(input.versionId, actor, ['canManageCatalog']);
    const version = await this.db.indicatorVersion.findUniqueOrThrow({ where: { id: input.versionId }, include: { system: true } });
    const name = typeof input.name === 'string' ? input.name.trim() : version.system.name;
    if (!name || name.length > 120) throw new BadRequestException('名称应为 1–120 个字符');
    try { return await this.db.semanticLibrary.create({ data: { versionId: version.id, name } }); }
    catch (e) { if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('该体系版本已有语义库'); throw e; }
  }
  private async requireLibrary(id: string, actor: Actor, manage = false) {
    const library = await this.db.semanticLibrary.findUnique({ where: { id } });
    if (!library) throw new NotFoundException('语义库不存在');
    await this.access.requireForVersion(library.versionId, actor, [manage ? 'canManageCatalog' : 'canView']);
    return library;
  }
  async source(versionId: string) {
    return this.db.$transaction(async tx => {
      const version = await tx.indicatorVersion.findUniqueOrThrow({ where: { id: versionId }, include: { system: { include: { templates: true } }, nodes: { include: { record: { include: { modules: true, evidence: true } } }, orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }] } } });
      const chunks: SourceChunk[] = []; const paths = new Map<string, string>(); let indicatorCount = 0;
      for (const node of version.nodes) {
        const path = `${node.parentId ? paths.get(node.parentId) || '' : version.system.name} / ${node.code} ${node.name}`;
        paths.set(node.id, path);
        const template = version.system.templates.find(t => t.level === node.level);
        const definitions = activeDefinitions(template?.modules || definitionsForLevel(node.level));
        const record = node.record;
        const base = { versionId, level: node.level, templateRevision: template?.revisionNo || 1 };
        const before = chunks.length;
        appendChunks(chunks, node.id, path, '指标摘要', record?.summary || '', { ...base, contentRevision: record?.revisionNo || 0 });
        for (const definition of definitions) {
          const module = record?.modules.find(m => m.moduleKey === definition.moduleKey);
          for (const field of definition.fields) {
            const values = (module?.values || {}) as Record<string, unknown>;
            const na = (module?.naReasons || {}) as Record<string, unknown>;
            const label = `${definition.name} · ${field.label}`;
            const metadata = { ...base, moduleKey: definition.moduleKey, fieldId: field.fieldId, contentRevision: module?.revisionNo || 0 };
            appendChunks(chunks, node.id, path, label, na[field.fieldId] ? `不适用：${readable(na[field.fieldId])}` : readable(values[field.fieldId]), metadata);
            for (const evidence of record?.evidence || []) {
              if (evidence.moduleKey !== definition.moduleKey || !Array.isArray(evidence.fieldKeys) || !evidence.fieldKeys.includes(field.fieldId) || ['invalid', 'superseded'].includes(evidence.verificationStatus)) continue;
              appendChunks(chunks, node.id, path, `${label} · 依据`, `${evidence.title}\n${evidence.excerpt || ''}`, { ...metadata, evidenceId: evidence.id, sourceUrl: evidence.sourceUrl, verificationStatus: evidence.verificationStatus });
            }
          }
        }
        if (chunks.length > before) indicatorCount++;
        if (chunks.length > 5000) throw new BadRequestException('当前精确检索版单库最多 5000 个片段，请缩小内容规模或升级向量索引');
      }
      return { chunks, indicatorCount, fingerprint: digest(chunks.map(c => c.hash)) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20000 });
  }
  async detail(id: string, actor: Actor) {
    const library = await this.requireLibrary(id, actor);
    const source = await this.source(library.versionId);
    const builds = await this.db.semanticBuild.findMany({ where: { libraryId: id }, orderBy: { createdAt: 'desc' }, take: 10, select: buildSelect });
    const active = library.activeBuildId ? await this.db.semanticBuild.findUnique({ where: { id: library.activeBuildId }, select: buildSelect }) : null;
    return { ...library, builds, active, pendingChanges: source.fingerprint !== active?.fingerprint, indicatorCount: source.indicatorCount, chunkCount: source.chunks.length, preview: source.chunks.slice(0, 5).map(({ text, path, label }) => ({ text, path, label })) };
  }
  async enqueue(id: string, consent: boolean, actor: Actor) {
    const library = await this.requireLibrary(id, actor, true);
    if (consent !== true) throw new BadRequestException('请确认将内容发送至智谱进行向量化');
    if (!this.embedding.configured) throw new ServiceUnavailableException('尚未配置后端 ZHIPU_API_KEY');
    const source = await this.source(library.versionId);
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "SemanticLibrary" WHERE id=${id} FOR UPDATE`;
      if (await tx.semanticBuild.count({ where: { libraryId: id, status: { in: ['queued', 'running'] } } })) throw new ConflictException('已有构建任务，请等待完成');
      return tx.semanticBuild.create({ data: { libraryId: id, actorUserId: actor.userId, fingerprint: source.fingerprint, snapshot: json(source.chunks), total: source.chunks.length }, select: buildSelect });
    });
  }
  async remove(id: string, actor: Actor) {
    await this.requireLibrary(id, actor, true);
    await this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "SemanticLibrary" WHERE id=${id} FOR UPDATE`;
      if (await tx.semanticBuild.count({ where: { libraryId: id, status: { in: ['queued', 'running'] } } })) throw new ConflictException('构建期间不可删除');
      await tx.semanticLibrary.delete({ where: { id } });
    });
    return { ok: true };
  }
  async tick() {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      const job = await this.db.$transaction(async tx => {
        // 多进程也只允许一个构建工作者，超时任务允许用户重新构建。
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(741025)::text`;
        await tx.semanticBuild.updateMany({ where: { status: 'running', heartbeatAt: { lt: new Date(Date.now() - 5 * 60_000) } }, data: { status: 'failed', error: '构建中断，请重试；旧索引保持可用', finishedAt: new Date() } });
        if (await tx.semanticBuild.count({ where: { status: 'running' } })) return null;
        const next = await tx.semanticBuild.findFirst({ where: { status: 'queued' }, orderBy: { createdAt: 'asc' }, include: { library: true } });
        if (!next) return null;
        await tx.semanticBuild.update({ where: { id: next.id }, data: { status: 'running', heartbeatAt: new Date() } });
        return next;
      });
      if (!job) return;
      try {
        const user = await this.db.user.findUnique({ where: { id: job.actorUserId } });
        if (!user || user.status !== 'active') throw new Error('发起用户已停用，构建已停止');
        const actor = { userId: user.id, name: user.displayName, role: user.role as Actor['role'] };
        await this.requireLibrary(job.libraryId, actor, true);
        const chunks = job.snapshot as unknown as SourceChunk[];
        const cached = job.library.activeBuildId ? await this.db.semanticChunk.findMany({ where: { buildId: job.library.activeBuildId }, select: { hash: true, embedding: true } }) : [];
        const cache = new Map(cached.map(c => [c.hash, c.embedding]));
        let tokens = 0; let reused = 0;
        for (let offset = 0; offset < chunks.length; offset += 8) {
          if (this.stopped) throw new Error('服务停止，构建中断，请重试');
          await this.requireLibrary(job.libraryId, actor, true);
          const batch = chunks.slice(offset, offset + 8); const missing = batch.filter(c => !cache.has(c.hash));
          if (missing.length) { const result = await this.embedding.embed(missing.map(c => c.text)); tokens += result.tokens; missing.forEach((c, i) => cache.set(c.hash, result.vectors[i]!)); }
          reused += batch.length - missing.length;
          await this.db.$transaction(async tx => {
            const alive = await tx.semanticBuild.updateMany({ where: { id: job.id, status: 'running' }, data: { heartbeatAt: new Date(), completed: offset + batch.length, reused, tokens } });
            if (!alive.count) throw new Error('构建已失效');
            await tx.semanticChunk.createMany({ data: batch.map(c => ({ buildId: job.id, ...c, metadata: json(c.metadata), embedding: cache.get(c.hash)! })) });
          });
        }
        await this.requireLibrary(job.libraryId, actor, true);
        await this.db.$transaction(async tx => {
          const done = await tx.semanticBuild.updateMany({ where: { id: job.id, status: 'running' }, data: { status: 'ready', finishedAt: new Date(), snapshot: [] } });
          if (!done.count) throw new Error('构建已失效');
          await tx.semanticLibrary.update({ where: { id: job.libraryId }, data: { activeBuildId: job.id } });
          await tx.semanticChunk.deleteMany({ where: { build: { libraryId: job.libraryId }, buildId: { not: job.id } } });
        });
      } catch (e) {
        await this.db.semanticBuild.updateMany({ where: { id: job.id, status: 'running' }, data: { status: 'failed', error: e instanceof Error ? e.message.slice(0, 180) : '构建失败，请重试', finishedAt: new Date(), snapshot: [] } });
        await this.db.semanticChunk.deleteMany({ where: { buildId: job.id } });
      }
    } finally { this.running = false; }
  }
  async search(id: string, query: string, consent: boolean, actor: Actor) {
    const library = await this.requireLibrary(id, actor);
    if (typeof query !== 'string' || !query.trim() || Buffer.byteLength(query, 'utf8') > 2000) throw new BadRequestException('请输入问题，长度不得超过 2000 UTF-8 字节');
    if (consent !== true) throw new BadRequestException('请确认将问题发送至智谱');
    if (!library.activeBuildId) throw new ConflictException('请先构建索引');
    if (this.searching >= 2) throw new ConflictException('检索繁忙，请稍后再试');
    this.searching++;
    try {
      const current = await this.source(library.versionId);
      const hashes = current.chunks.map(c => c.hash);
      const { vectors, tokens } = await this.embedding.embed([query.trim()]);
      await this.requireLibrary(id, actor);
      // 在已授权库内计算精确余弦；剔除所有已变更、停用或删除的旧片段。
      const matches = hashes.length ? await this.db.$queryRaw<{ id: string; nodeId: string; path: string; label: string; text: string; metadata: unknown; score: number }[]>`
        SELECT c.id, c."nodeId", c.path, c.label, c.text, c.metadata,
          (SELECT sum(v * q) FROM unnest(c.embedding, ${vectors[0]}::double precision[]) AS pair(v,q)) AS score
        FROM "SemanticChunk" c WHERE c."buildId"=${library.activeBuildId} AND c.hash = ANY(${hashes}::text[])
        ORDER BY score DESC LIMIT 8` : [];
      const fresh = await this.source(library.versionId);
      const stillValid = new Set(fresh.chunks.map(c => c.hash));
      const validIds = new Set((await this.db.semanticChunk.findMany({ where: { id: { in: matches.map(m => m.id) }, hash: { in: [...stillValid] } }, select: { id: true } })).map(c => c.id));
      await this.requireLibrary(id, actor);
      const active = await this.db.semanticBuild.findUnique({ where: { id: library.activeBuildId }, select: { fingerprint: true } });
      return { matches: matches.filter(m => validIds.has(m.id)), tokens, pendingChanges: fresh.fingerprint !== active?.fingerprint, versionId: library.versionId };
    } finally { this.searching--; }
  }
}
