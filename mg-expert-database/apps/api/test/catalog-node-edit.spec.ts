import { describe, expect, it, vi } from 'vitest';
import { CatalogService } from '../src/catalog.service';
import type { PrismaService } from '../src/prisma.service';
import type { TemplatesService } from '../src/templates.service';
import type { SystemAccessService } from '../src/system-access';

const actor = { userId: 'editor', name: '目录管理员', role: 'catalog_manager' as const };

function fixture(level = 1, hasChildren = true) {
  const existing = { id: 'node', versionId: 'version', level, parentId: level === 1 ? null : 'parent', code: 'IND-1', name: '原名称', sortOrder: 0, children: hasChildren ? [{ id: 'child' }] : [] };
  const update = vi.fn(async ({ data }) => ({ ...existing, ...data }));
  const audit = vi.fn(async () => ({}));
  const tx = { indicatorNode: { update }, auditLog: { create: audit } };
  const prisma = {
    indicatorVersion: { findUnique: vi.fn(async () => ({ id: 'version', status: 'draft' })) },
    indicatorNode: { findFirst: vi.fn(async ({ where }) => where.id === 'node' ? existing : { id: where.id, level: level - 1, versionId: 'version' }) },
    $transaction: vi.fn(async (run) => run(tx)),
  };
  const access = { requireForVersion: vi.fn(async () => undefined) };
  const service = new CatalogService({} as TemplatesService, prisma as unknown as PrismaService, access as unknown as SystemAccessService);
  return { service, existing, update, audit, access };
}

describe('指标目录编辑与移动边界', () => {
  it.each([undefined, null])('含子节点的一级指标可编辑，parentId=%s', async (parentId) => {
    const { service, update, audit } = fixture();
    const input = { name: '信用环境', code: 'IND-NEW', sortOrder: 2, ...(parentId === undefined ? {} : { parentId }) };
    await expect(service.updateNode('version', 'node', input, actor)).resolves.toMatchObject({ name: '信用环境', code: 'IND-NEW', sortOrder: 2, parentId: null });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ parentId: null, parentKey: '__root__' }) }));
    expect(audit).toHaveBeenCalledOnce();
  });

  it('含子节点的二级指标保留父节点时可编辑', async () => {
    const { service } = fixture(2);
    await expect(service.updateNode('version', 'node', { name: '更新二级指标', parentId: 'parent' }, actor)).resolves.toMatchObject({ name: '更新二级指标', parentId: 'parent' });
  });

  it('含子节点的指标仍不能移动到其他父节点', async () => {
    const { service, update, audit } = fixture(2);
    await expect(service.updateNode('version', 'node', { parentId: 'other-parent' }, actor)).rejects.toThrow('含子节点的指标不可移动');
    expect(update).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it('叶子指标仍可在同级父节点之间移动', async () => {
    const { service } = fixture(2, false);
    await expect(service.updateNode('version', 'node', { parentId: 'other-parent' }, actor)).resolves.toMatchObject({ parentId: 'other-parent', parentKey: 'other-parent' });
  });

  it.each([
    [{ parentId: 'node' }, '不能以自身为父节点'],
    [{ parentId: 'other' }, '一级指标不能设置父节点'],
    [{ level: 2 }, '不允许变更层级'],
  ])('非法层级变更仍被拒绝：%j', async (input, message) => {
    const { service, update } = fixture();
    await expect(service.updateNode('version', 'node', input, actor)).rejects.toThrow(message);
    expect(update).not.toHaveBeenCalled();
  });

  it('目录权限不足时不写入', async () => {
    const { service, access, update } = fixture();
    access.requireForVersion.mockRejectedValueOnce(new Error('无目录管理权限'));
    await expect(service.updateNode('version', 'node', { name: '新名称' }, actor)).rejects.toThrow('无目录管理权限');
    expect(update).not.toHaveBeenCalled();
  });
});
