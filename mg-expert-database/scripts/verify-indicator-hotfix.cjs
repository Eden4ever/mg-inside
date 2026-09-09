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
const marker = `indicator-hotfix-${randomUUID()}`;
let checked = false;

async function main() {
  try {
    await db.$transaction(async (tx) => {
      // 将服务内部事务复用为本次外层事务，权限、层级及体系行锁使用真实实现。
      const scoped = new Proxy(tx, { get: (target, key) => key === '$transaction' ? (run) => run(tx) : target[key] });
      const access = new SystemAccessService(scoped);
      const service = new CatalogService(new TemplatesService(scoped, access), scoped, access);
      const user = await tx.user.create({ data: { username: marker, displayName: '指标回归临时用户', role: 'system_admin' } });
      const actor = { userId: user.id, name: user.displayName, role: 'system_admin' };
      const system = await tx.indicatorSystem.create({ data: { name: marker, code: marker, region: '', maxLevel: 5 } });
      const version = await tx.indicatorVersion.create({ data: { systemId: system.id, year: 2026, versionCode: 'TEST' } });
      const create = (input) => service.createNode(version.id, input, actor);
      const rootNode = await create({ level: 1, parentId: null, name: '一级指标' });
      assert.equal(rootNode.code, 'IND-000001');
      const child = await create({ level: 2, parentId: rootNode.id, name: '二级指标' });
      assert.equal(child.code, 'IND-000002');
      const grandchild = await create({ level: 3, parentId: child.id, name: '三级指标' });
      const updated = await service.updateNode(version.id, rootNode.id, { name: '一级改名', sortOrder: 9 }, actor);
      assert.equal(updated.name, '一级改名');
      assert.equal(updated.parentId, null);
      assert.equal(updated.code, rootNode.code);
      await service.updateNode(version.id, rootNode.id, { parentId: null, name: '显式空父节点' }, actor);
      await service.updateNode(version.id, child.id, { name: '二级改名' }, actor);
      const other = await create({ level: 1, name: '另一个一级', code: 'IND-000009' });
      assert.equal((await create({ level: 1, name: '继续自动编码' })).code, 'IND-000010');
      await assert.rejects(service.updateNode(version.id, child.id, { parentId: other.id }, actor), /含子节点的指标不可移动/);
      await assert.rejects(create({ level: 1, name: ' ', parentId: null }), /名称不能为空/);
      await assert.rejects(service.createNode(version.id, { level: 1, name: '无权限' }, { ...actor, role: 'reader' }), /相应权限/);
      checked = true;
      assert.equal((await tx.indicatorNode.findUnique({ where: { id: child.id } })).parentId, rootNode.id);
      assert.equal((await tx.indicatorNode.findUnique({ where: { id: grandchild.id } })).parentId, child.id);
      assert.equal(await tx.auditLog.count({ where: { versionId: version.id, action: 'indicator_node.updated' } }), 3);
      const record = await tx.researchRecord.create({ data: { versionId: version.id, indicatorNodeId: grandchild.id, summary: '待删除摘要' } });
      const module = await tx.researchModule.create({ data: { recordId: record.id, moduleKey: 'portrait', values: { test: '内容' } } });
      await tx.researchRevision.create({ data: { moduleId: module.id, revisionNo: 1, snapshot: {}, actorName: actor.name, action: 'saved' } });
      await tx.researchSummaryRevision.create({ data: { recordId: record.id, revisionNo: 1, summary: '摘要修订', actorUserId: user.id, actorName: actor.name } });
      await tx.evidence.create({ data: { recordId: record.id, moduleKey: 'portrait', type: 'case', title: '依据', verificationStatus: 'verified' } });
      await tx.aISuggestion.create({ data: { recordId: record.id, content: '建议', rationale: '理由', confidence: 'high' } });
      await tx.researchAssignment.create({ data: { versionId: version.id, indicatorNodeId: grandchild.id, userId: user.id } });
      await assert.rejects(service.deleteNode(version.id, grandchild.id, actor), /请确认删除/);
      await assert.rejects(service.deleteNode(version.id, grandchild.id, actor, { confirmName: '旧名称' }), /请确认删除/);
      await assert.rejects(service.deleteNode(version.id, child.id, actor, { confirmName: '二级改名' }), /子节点/);
      assert.equal(await tx.researchRecord.count({ where: { id: record.id } }), 1);
      await service.deleteNode(version.id, grandchild.id, actor, { confirmName: grandchild.name });
      assert.equal(await tx.indicatorNode.count({ where: { id: grandchild.id } }), 0);
      assert.equal(await tx.researchRecord.count({ where: { id: record.id } }), 0);
      for (const model of ['researchModule', 'evidence', 'aISuggestion', 'researchSummaryRevision']) assert.equal(await tx[model].count({ where: { recordId: record.id } }), 0);
      assert.equal(await tx.researchRevision.count({ where: { moduleId: module.id } }), 0);
      assert.equal(await tx.researchAssignment.count({ where: { indicatorNodeId: grandchild.id } }), 0);
      const deletion = await tx.auditLog.findFirstOrThrow({ where: { targetId: grandchild.id, action: 'indicator_node.deleted' } });
      assert.equal(deletion.detail.name, grandchild.name);
      assert.deepEqual(deletion.detail.deletedContent, { modules: 1, evidence: 1, suggestions: 1, summaryRevisions: 1 });
      throw rollback;
    }, { timeout: 30000 });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  assert(checked);
  assert.equal(await db.indicatorSystem.count({ where: { code: marker } }), 0);
  assert.equal(await db.user.count({ where: { username: marker } }), 0);
  console.log('指标新增、编辑、删除确认、内容级联清理及审计验证通过；临时数据已回滚。');
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => db.$disconnect());
