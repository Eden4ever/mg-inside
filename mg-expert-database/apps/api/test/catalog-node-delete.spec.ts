import { describe, expect, it, vi } from 'vitest';
import { CatalogService } from '../src/catalog.service';
import type { PrismaService } from '../src/prisma.service';
import type { TemplatesService } from '../src/templates.service';
import type { SystemAccessService } from '../src/system-access';

function fixture(hasRecord = true, hasChildren = false) {
  const node = { id: 'node', name: '待删除指标', code: 'IND-1', level: 3, parentId: 'parent', children: hasChildren ? [{}] : [], record: hasRecord ? { _count: { modules: 2, evidence: 1, suggestions: 1, summaryRevisions: 1 } } : null };
  const remove = vi.fn(async () => node), audit = vi.fn(async () => ({}));
  const tx = { indicatorNode: { findFirst: vi.fn(async () => node), delete: remove }, auditLog: { create: audit } };
  const prisma = { indicatorVersion: { findUnique: vi.fn(async () => ({ systemId: 'system' })) }, $transaction: vi.fn(async (run) => run(tx)) };
  const access = { requireForVersion: vi.fn(async () => undefined) };
  const lock = vi.fn(async () => ({}));
  const service = new CatalogService({ lock } as unknown as TemplatesService, prisma as unknown as PrismaService, access as unknown as SystemAccessService);
  return { service, remove, audit, access, lock };
}
const actor = { userId: 'editor', name: '管理员', role: 'system_admin' as const };

describe('指标内容删除确认', () => {
  it.each([undefined, {}, { confirmName: '旧名称' }])('有内容记录时拒绝未确认或过期确认：%j', async (input) => {
    const { service, remove, audit } = fixture();
    await expect(service.deleteNode('version', 'node', actor, input)).rejects.toThrow('请确认删除');
    expect(remove).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });
  it('确认后删除并记录节点身份与内容数量', async () => {
    const { service, remove, audit, lock } = fixture();
    await service.deleteNode('version', 'node', actor, { confirmName: '待删除指标' });
    expect(lock).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith({ where: { id: 'node' } });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'indicator_node.deleted', detail: expect.objectContaining({ name: '待删除指标', contentDeleted: true, deletedContent: { modules: 2, evidence: 1, suggestions: 1, summaryRevisions: 1 } }) }) }));
  });
  it('没有内容的旧客户端删除请求保持兼容', async () => {
    const { service, remove } = fixture(false);
    await service.deleteNode('version', 'node', actor);
    expect(remove).toHaveBeenCalledOnce();
  });
  it('确认也不能直接删除含下级指标的节点', async () => {
    const { service, remove } = fixture(true, true);
    await expect(service.deleteNode('version', 'node', actor, { confirmName: '待删除指标' })).rejects.toThrow('请先删除全部子节点');
    expect(remove).not.toHaveBeenCalled();
  });
  it('确认不绕过目录权限', async () => {
    const { service, remove, access } = fixture();
    access.requireForVersion.mockRejectedValueOnce(new Error('无权限'));
    await expect(service.deleteNode('version', 'node', actor, { confirmName: '待删除指标' })).rejects.toThrow('无权限');
    expect(remove).not.toHaveBeenCalled();
  });
});
