import { flushPromises, mount } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { describe, expect, it } from 'vitest';
import IndicatorTreePanel from '@/components/IndicatorTreePanel.vue';
import type { IndicatorTreeNode } from '@/types/domain';

const nodes: IndicatorTreeNode[] = [{
  id: 'l1', parentId: null, level: 1, name: '信用环境', code: 'CREDIT', sortOrder: 1, progress: 0, issues: 0,
  children: [{
    id: 'l2', parentId: 'l1', level: 2, name: '信用监管', code: 'CREDIT-SUP', sortOrder: 1, progress: 0, issues: 0,
    children: [{ id: 'l3', parentId: 'l2', level: 3, name: '信用修复办理时效', code: 'CREDIT-001', sortOrder: 1, progress: 0, issues: 0, children: [] }],
  }],
}];

function render() {
  return mount(IndicatorTreePanel, { props: { nodes, selectedId: 'l3', readonly: false }, global: { plugins: [ElementPlus] } });
}

describe('IndicatorTreePanel', () => {
  it('新增仅填写名称即可保存，不提交空编码', async () => {
    const wrapper = render();
    await wrapper.get('[aria-label="新增一级指标"]').trigger('click');
    await flushPromises();
    const dialog = wrapper.findComponent({ name: 'ElDialog' });
    expect(dialog.text()).not.toContain('指标编码');
    dialog.findComponent({ name: 'ElInput' }).vm.$emit('update:modelValue', '新指标');
    await flushPromises();
    await dialog.findAllComponents({ name: 'ElButton' }).find(button => button.text() === '保存')!.trigger('click');
    await flushPromises();
    expect(wrapper.emitted('add')).toEqual([[{ parentId: null, level: 1, name: '新指标', sortOrder: 2 }]]);
    wrapper.unmount();
  });
  it('只允许同父级前后拖动，并发出排序事件', async () => {
    const wrapper = render();
    const tree = wrapper.findComponent({ name: 'ElTree' });
    const drag = { data: nodes[0] };
    const target = { data: { ...nodes[0], id: 'sibling' } };
    const allowDrop = tree.props('allowDrop') as (a: unknown, b: unknown, type: string) => boolean;
    expect(allowDrop(drag, target, 'prev')).toBe(true);
    expect(allowDrop(drag, target, 'inner')).toBe(false);
    expect(allowDrop(drag, { data: { ...target.data, parentId: 'other' } }, 'next')).toBe(false);
    expect(allowDrop(drag, { data: { ...target.data, level: 2 } }, 'next')).toBe(false);
    tree.vm.$emit('node-drop', drag, target, 'after');
    expect(wrapper.emitted('reorder')?.[0]).toEqual([{ nodeId: 'l1', targetId: 'sibling', position: 'after' }]);
    await wrapper.get('.tree-toolbar input').setValue('信用');
    expect(tree.props('draggable')).toBe(false);
    wrapper.unmount();
  });

  it('目录行突出名称，编码保留在提示中，操作收纳到菜单', () => {
    const wrapper = render();
    expect(wrapper.get('.panel-heading').text()).toContain('指标目录');
    expect(wrapper.find('.node-level').exists()).toBe(false);
    expect(wrapper.get('.node-text').attributes('title')).toContain('CREDIT');
    expect(wrapper.get('.node-text').text()).toBe('信用环境');
    expect(wrapper.find('.node-more').exists()).toBe(true);
    wrapper.unmount();
  });

  it('只读目录不显示管理菜单', () => {
    const wrapper = mount(IndicatorTreePanel, { props: { nodes, selectedId: 'l3', readonly: true }, global: { plugins: [ElementPlus] } });
    expect(wrapper.find('.node-more').exists()).toBe(false);
    wrapper.unmount();
  });

  it('编辑不显示或提交编码，保存仅更新名称与排序', async () => {
    const wrapper = render();
    wrapper.vm.openEdit(nodes[0]!);
    await flushPromises();
    const dialog = wrapper.findComponent({ name: 'ElDialog' });
    expect(dialog.props('modelValue')).toBe(true);
    expect(dialog.props('title')).toBe('编辑指标节点');
    const inputs = dialog.findAllComponents({ name: 'ElInput' });
    expect(inputs[0]!.props('modelValue')).toBe('信用环境');
    expect(dialog.text()).not.toContain('指标编码');
    inputs[0]!.vm.$emit('update:modelValue', '信用建设');
    dialog.findComponent({ name: 'ElInputNumber' }).vm.$emit('update:modelValue', 3);
    await flushPromises();
    const saveButton = dialog.findAllComponents({ name: 'ElButton' }).find((button) => button.text() === '保存');
    await saveButton!.trigger('click');
    await flushPromises();
    expect(wrapper.emitted('edit')).toEqual([['l1', { name: '信用建设', sortOrder: 3 }]]);
    expect(dialog.props('modelValue')).toBe(false);
    wrapper.unmount();
  });

  it('只读状态不可通过外部入口打开编辑表单', async () => {
    const wrapper = mount(IndicatorTreePanel, { props: { nodes, selectedId: 'l1', readonly: true }, global: { plugins: [ElementPlus] } });
    wrapper.vm.openEdit(nodes[0]!);
    await flushPromises();
    expect(wrapper.findComponent({ name: 'ElDialog' }).props('modelValue')).toBe(false);
    wrapper.unmount();
  });


  it('搜索三级指标时保留完整一级和二级父路径', async () => {
    const wrapper = render();
    await wrapper.get('.tree-toolbar input').setValue('修复办理');
    expect(wrapper.text()).toContain('信用环境');
    expect(wrapper.text()).toContain('信用监管');
    expect(wrapper.text()).toContain('信用修复办理时效');
  });

  it('支持收起和重新展开指标树', async () => {
    const wrapper = render();
    const button = wrapper.get('.mobile-collapse');
    expect(button.text()).toContain('收起指标树');
    await button.trigger('click');
    expect(button.text()).toContain('展开指标树');
    expect(wrapper.get('.tree-scroll').attributes('style')).toContain('display: none');
  });
});
