// 对构建后的目录服务执行真实数据库回归；所有测试数据只存在于最终回滚的事务中。
const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const { randomUUID } = require('node:crypto');
const root = resolve(process.argv[2]);
const base = resolve(root, 'apps/api/dist/apps/api/src');
const { PrismaService } = require(resolve(base, 'prisma.service.js'));
const { CatalogService } = require(resolve(base, 'catalog.service.js'));
const { TemplatesService } = require(resolve(base, 'templates.service.js'));
const { SystemAccessService } = require(resolve(base, 'system-access.js'));
const db = new PrismaService();
const rollback = new Error('回归完成，回滚临时数据');
const marker = `summary-hotfix-${randomUUID()}`;
let checked = false;

async function main() {
  try {
    await db.$transaction(async (tx) => {
      // 将服务内部事务复用为本次外层事务，权限、层级及体系行锁使用真实实现。
      const scoped = new Proxy(tx, { get: (target, key) => key === '$transaction' ? (run) => run(tx) : target[key] });
      const access = new SystemAccessService(scoped);
      const templates = new TemplatesService(scoped, access);
      const service = new CatalogService(templates, scoped, access);
      const user = await tx.user.create({ data: { username: marker, displayName: '摘要回归临时用户', role: 'system_admin' } });
      const actor = { userId: user.id, name: user.displayName, role: 'system_admin' };
      const system = await tx.indicatorSystem.create({ data: { name: marker, code: marker, region: '', maxLevel: 3 } });
      const version = await tx.indicatorVersion.create({ data: { systemId: system.id, year: 2026, versionCode: 'TEST' } });
      const rootNode = await service.createNode(version.id, { level: 1, parentId: null, name: '一级指标' }, actor);
      const child = await service.createNode(version.id, { level: 2, parentId: rootNode.id, name: '二级指标' }, actor);
      const leaf = await service.createNode(version.id, { level: 3, parentId: child.id, name: '三级指标' }, actor);
      const save = (input) => service.saveSummary(version.id, leaf.id, input, actor);

      // 摘要是自由文本框：不带修订号、不引用模块修订也能保存。
      const first = await save({ summary: '直接编辑的摘要' });
      assert.deepEqual({ summary: first.summary, revisionNo: first.revisionNo, sourceRevisionIds: first.sourceRevisionIds }, { summary: '直接编辑的摘要', revisionNo: 1, sourceRevisionIds: [] });
      // 内容可以清空，空白内容按空字符串保存。
      const cleared = await save({ summary: '   ' });
      assert.equal(cleared.summary, '');
      assert.equal(cleared.revisionNo, 2);
      // 模板改动后仍可保存，不再要求携带模板修订号。
      const settings = await templates.read(system.id, actor);
      const level3 = settings.levels.find((entry) => entry.level === 3);
      await templates.save(system.id, {
        expectedRevisionNo: settings.revisionNo,
        maxLevel: settings.maxLevel,
        levels: [{ level: 3, modules: level3.modules.map((module) => ({ ...module, name: module.name + '（回归改名）' })) }],
      }, actor);
      const afterTemplate = await save({ expectedRevisionNo: 0, summary: '模板变更后的摘要' });
      assert.equal(afterTemplate.summary, '模板变更后的摘要');
      assert.equal(afterTemplate.revisionNo, 3);

      const record = await tx.researchRecord.findFirstOrThrow({ where: { versionId: version.id, indicatorNodeId: leaf.id } });
      assert.equal(record.summary, '模板变更后的摘要');
      const revisions = await tx.researchSummaryRevision.findMany({ where: { recordId: record.id }, orderBy: { revisionNo: 'asc' } });
      assert.deepEqual(revisions.map((item) => [item.revisionNo, item.summary]), [[1, '直接编辑的摘要'], [2, ''], [3, '模板变更后的摘要']]);
      assert.equal(await tx.auditLog.count({ where: { versionId: version.id, action: 'research_summary.saved' } }), 3);
      // 权限仍然生效，只读角色不能改摘要。
      await assert.rejects(service.saveSummary(version.id, leaf.id, { summary: '越权' }, { ...actor, role: 'reader' }), /权限/);
      checked = true;
      throw rollback;
    }, { timeout: 30000 });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  assert(checked);
  assert.equal(await db.indicatorSystem.count({ where: { code: marker } }), 0);
  assert.equal(await db.user.count({ where: { username: marker } }), 0);
  console.log('摘要直接编辑、清空、模板变更后保存、修订与审计验证通过；临时数据已回滚。');
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => db.$disconnect());
