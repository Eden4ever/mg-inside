import { flushPromises, mount } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { describe, expect, it, vi } from 'vitest';
import SystemsView from '@/components/SystemsView.vue';
import type { IndicatorSystemSummary } from '@/types/domain';

const system: IndicatorSystemSummary = { id: 's1', versionId: 'v1', name: '营商环境', code: 'BUSINESS', year: 2026, version: 'V1', region: '全省', indicatorCount: 9, progress: 25, status: 'draft', updatedAt: '2026-09-07', access: { canView: true, canResearch: false, canManageCatalog: false, canReview: false, canPublish: false } };
describe('SystemsView', () => {
  it('基本信息只保留业务字段，旧编号仍可搜索但不展示', async () => {
    const wrapper = mount(SystemsView, { props: { systems: [system], loading: false, error: '', importPreview: null, importBusy: false, canManage: true, currentRole: 'system_admin' }, global: { plugins: [ElementPlus] } });
    expect(wrapper.get('.table-count').text()).toBe('共 1 个体系');
    expect(wrapper.get('.system-card-meta').text()).toContain('全省');
    expect(wrapper.get('.system-card-meta').text()).toContain('最多 3 级');
    expect(wrapper.get('.system-card').text()).not.toContain('BUSINESS');
    expect(wrapper.get('.system-card').text()).not.toContain('V1');
    expect(wrapper.find('.filter-select').exists()).toBe(false);
    await wrapper.get('.system-search input').setValue('BUSINESS');
    expect(wrapper.findAll('.system-card')).toHaveLength(1);
    wrapper.unmount();
  });

  it('新建仅要求名称和层级，不发送隐藏的编码、年度、版本号', async () => {
    const wrapper = mount(SystemsView, { attachTo: document.body, props: { systems: [], loading: false, error: '', importPreview: null, importBusy: false, canManage: true, currentRole: 'system_admin' }, global: { plugins: [ElementPlus] } });
    await wrapper.findAll('button').find(button => button.text() === '新建指标体系')!.trigger('click');
    await flushPromises();
    const dialog = wrapper.get('.el-dialog');
    expect(dialog.findAll('.el-form-item__label').map(label => label.text())).toEqual(['体系名称', '最大层级', '适用地区']);
    const nameInput = dialog.get('.el-form-item input');
    const createButton = dialog.findAll('button').find(button => button.text() === '创建')!;
    await nameInput.setValue('   ');
    await createButton.trigger('click');
    await flushPromises();
    expect(wrapper.emitted('create')).toBeUndefined();
    await nameInput.setValue('  新知识体系  ');
    await createButton.trigger('click');
    await vi.waitFor(() => expect(wrapper.emitted('create')?.[0]?.[0]).toEqual({ name: '新知识体系', region: '', maxLevel: 3 }));
    expect(wrapper.get('.el-dialog').isVisible()).toBe(true);
    expect(dialog.findAll('button').find(button => button.text() === '取消')!.attributes('disabled')).toBeDefined();
    const complete = wrapper.emitted('create')![0]![1] as (error?: string) => void;
    complete('网络连接失败'); await flushPromises();
    expect(wrapper.get('.el-dialog').text()).toContain('网络连接失败');
    expect((nameInput.element as HTMLInputElement).value).toContain('新知识体系');
    await createButton.trigger('click'); await flushPromises();
    expect(wrapper.emitted('create')).toHaveLength(2);
    (wrapper.emitted('create')![1]![1] as () => void)(); await flushPromises();
    await vi.waitFor(() => expect(wrapper.find('.el-dialog').exists()).toBe(false));
    wrapper.unmount();
  });

  it('管理员卡片也只保留进入体系操作', async () => {
    const managed = { ...system, access: { ...system.access, canManageCatalog: true, canManageAccess: true } };
    const wrapper = mount(SystemsView, { props: { systems: [managed], loading: false, error: '', importPreview: null, importBusy: false, canManage: true, currentRole: 'system_admin' }, global: { plugins: [ElementPlus] } });
    const buttons = wrapper.findAll('.system-card-actions button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.text()).toBe('进入体系');
    await buttons[0]!.trigger('click');
    expect(wrapper.emitted('open')?.[0]).toEqual([managed]);
    wrapper.unmount();
  });
  it('以卡片呈现体系，支持进入和搜索空态', async () => {
    const wrapper = mount(SystemsView, { props: { systems: [system], loading: false, error: '', importPreview: null, importBusy: false, canManage: false, currentRole: 'reader' }, global: { plugins: [ElementPlus], stubs: { SystemAccessDialog: true } } });
    expect(wrapper.findAll('.system-card')).toHaveLength(1);
    expect(wrapper.find('.el-table').exists()).toBe(false);
    expect(wrapper.get('.system-card').text()).toContain('9 个指标');
    await wrapper.get('.system-card-title').trigger('click');
    expect(wrapper.emitted('open')?.[0]).toEqual([system]);
    expect(wrapper.get('.system-card-actions').text()).not.toContain('权限');
    await wrapper.get('.system-search input').setValue('不存在');
    expect(wrapper.findAll('.system-card')).toHaveLength(0);
    expect(wrapper.text()).toContain('未找到匹配体系');
    wrapper.unmount();
  });
});
