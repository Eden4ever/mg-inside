import { mount, flushPromises } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SystemAccessDialog from '@/components/SystemAccessDialog.vue';
import type { IndicatorSystemSummary } from '@/types/domain';

const system: IndicatorSystemSummary = {
  id: 's1', versionId: 'v1', name: '营商环境评价', code: 'BUSINESS', year: 2026, version: 'V1', region: '全省',
  indicatorCount: 1, progress: 0, status: 'researching', updatedAt: '',
  access: { canView: true, canResearch: true, canManageCatalog: true, canReview: true, canPublish: true },
};

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('SystemAccessDialog', () => {
  it('展示可查看、可编辑、可管理三项权限', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([
      {
        userId: 'u1', displayName: '研究员甲', username: 'researcher', departmentName: '研究处', role: 'researcher', globalAdmin: false,
        platformRoleLabel: '研究员',
        permissions: { canView: true, canResearch: true, canManageCatalog: false, canReview: false, canPublish: false },
      },
    ]), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const wrapper = mount(SystemAccessDialog, {
      props: { modelValue: true, system },
      attachTo: document.body,
      global: { plugins: [ElementPlus] },
    });
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(fetchMock).toHaveBeenCalledWith('/api/systems/s1/access', expect.objectContaining({ credentials: 'include' }));
    expect(document.body.textContent).toContain('权限管理 · 营商环境评价');
    expect(document.body.textContent).toContain('研究员甲');
    expect(document.body.textContent).toContain('平台角色');
    expect(document.body.querySelectorAll('.el-table__body-wrapper input[type="checkbox"]')).toHaveLength(0);
    expect(document.body.textContent).toContain('可编辑');
    expect(document.body.querySelector('[aria-label="研究员甲-体系权限"]')).not.toBeNull();
    wrapper.unmount();
  });

  it('按后端返回展示平台角色标签', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([
      {
        userId: 'u1', displayName: '用户甲', username: 'reader', departmentName: '综合处', role: 'reader', globalAdmin: false,
        platformRoleLabel: '普通用户',
        permissions: { canView: false, canResearch: false, canManageCatalog: false, canReview: false, canPublish: false },
      },
      {
        userId: 'u2', displayName: '用户乙', username: 'manager', departmentName: '综合处', role: 'catalog_manager', globalAdmin: false,
        platformRoleLabel: '指标管理员',
        permissions: { canView: true, canResearch: true, canManageCatalog: true, canReview: true, canPublish: true },
      },
      {
        userId: 'u3', displayName: '用户丙', username: 'researcher', departmentName: '研究处', role: 'researcher', globalAdmin: false,
        platformRoleLabel: '研究员',
        permissions: { canView: true, canResearch: true, canManageCatalog: false, canReview: false, canPublish: false },
      },
    ]), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const wrapper = mount(SystemAccessDialog, {
      props: { modelValue: true, system },
      attachTo: document.body,
      global: { plugins: [ElementPlus] },
    });
    await new Promise((resolve) => setTimeout(resolve, 80));

    const text = document.body.textContent ?? '';
    // reader 平台角色显示“普通用户”
    expect(text).not.toContain('用户甲');
    expect(text).toContain('指标管理员');
    expect(text).toContain('研究员');
    wrapper.unmount();
  });
  it('只添加已有用户，选择权限后提交，不提供新建账号', async () => {
    const user = { userId: 'u-new', displayName: '待授权用户', username: 'member', departmentName: '', role: 'reader', globalAdmin: false, platformRoleLabel: '普通用户', permissions: { canView: false, canResearch: false, canManageCatalog: false, canReview: false, canPublish: false } };
    const fetchMock = vi.fn().mockImplementation(async (_url, options) => new Response(JSON.stringify(options?.method === 'PUT' ? { userId: user.userId, permissions: { ...user.permissions, canView: true, canResearch: true } } : [user]), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const wrapper = mount(SystemAccessDialog, { props: { modelValue: true, system }, attachTo: document.body, global: { plugins: [ElementPlus] } });
    await flushPromises();
    const add = [...document.body.querySelectorAll('button')].find(b => b.textContent?.trim() === '添加用户')!;
    add.click(); await flushPromises();
    expect(document.body.textContent).not.toContain('新建账号');
    expect(document.body.querySelector('input[type="password"]')).toBeNull();
    const selectors = wrapper.findAllComponents({ name: 'ElSelect' });
    selectors.at(-2)!.vm.$emit('update:modelValue', 'u-new');
    selectors.at(-1)!.vm.$emit('update:modelValue', 'editor');
    await flushPromises();
    [...document.body.querySelectorAll('button')].find(b => b.textContent?.trim() === '添加并授权')!.click();
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledWith('/api/systems/s1/access/u-new', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ systemRole: 'editor' }) }));
    expect(fetchMock.mock.calls.every(([url]) => url !== '/api/users')).toBe(true);
    wrapper.unmount();
  });

});
