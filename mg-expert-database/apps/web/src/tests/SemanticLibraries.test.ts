import { flushPromises, mount } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SemanticLibraries from '@/components/SemanticLibraries.vue';
const mocks = vi.hoisted(() => ({ semanticList: vi.fn(), semanticDetail: vi.fn(), semanticSearch: vi.fn(), semanticCreate: vi.fn() }));
vi.mock('@/api/client', () => ({ api: mocks }));
beforeEach(() => vi.clearAllMocks());
describe('智能语义库', () => {
  it('创建期间保持对话框，失败保留输入并支持原处重试', async () => {
    mocks.semanticList.mockResolvedValue({configured:true,libraries:[]});
    let reject!: (error: Error) => void;
    mocks.semanticCreate.mockImplementationOnce(()=>new Promise((_resolve,fail)=>{reject=fail;})).mockResolvedValueOnce({id:'created'});
    const wrapper=mount(SemanticLibraries,{attachTo:document.body,props:{systems:[{id:'s',versionId:'v',name:'测试体系',year:2026,version:'V1',access:{canManageCatalog:true}} as any]},global:{plugins:[ElementPlus]}});
    await flushPromises();
    await wrapper.findAll('button').find(b=>b.text()==='新建语义库')!.trigger('click');await flushPromises();
    const dialog=wrapper.get('.el-dialog');
    dialog.findComponent({name:'ElSelect'}).vm.$emit('update:modelValue','v');
    await dialog.findAll('input').at(-1)!.setValue('保留填写内容');
    await dialog.findAll('button').find(b=>b.text()==='创建')!.trigger('click');await flushPromises();
    expect(dialog.findAll('button').find(b=>b.text()==='取消')!.attributes('disabled')).toBeDefined();
    expect(wrapper.emitted('closeStateChange')!.at(-1)).toEqual([{dirty:true,busy:true}]);
    reject(Error('连接失败，请重试'));await flushPromises();
    expect(dialog.text()).toContain('连接失败，请重试');expect((dialog.findAll('input').at(-1)!.element as HTMLInputElement).value).toBe('保留填写内容');
    await dialog.findAll('button').find(b=>b.text()==='创建')!.trigger('click');await flushPromises();
    expect(mocks.semanticCreate).toHaveBeenCalledTimes(2);expect(mocks.semanticCreate).toHaveBeenLastCalledWith({versionId:'v',name:'保留填写内容'});
    expect(wrapper.emitted('closeStateChange')!.at(-1)).toEqual([{dirty:false,busy:false}]);
    wrapper.unmount();
  });
  it('卡片只保留进入入口，支持名称检索和状态过滤', async () => {
    mocks.semanticList.mockResolvedValue({ configured: true, libraries: [
      { id: 'a', name: '信用环境知识库', systemName: '营商环境', version: '2026 V1', canManage: true, activeBuildId: 'b', build: { status: 'ready', completed: 10, total: 10 } },
      { id: 'b', name: '市场准入知识库', systemName: '市场评价', version: '2025 V2', canManage: true, build: null },
    ] });
    const wrapper = mount(SemanticLibraries, { props: { systems: [] }, global: { plugins: [ElementPlus] } });
    await flushPromises();
    expect(wrapper.findAll('.library-card')).toHaveLength(2);
    expect(wrapper.findAll('.library-card button').map(b => b.text())).toEqual(['进入语义库', '进入语义库']);
    await wrapper.get('.list-filters input').setValue('2025');
    expect(wrapper.findAll('.library-card')).toHaveLength(1);
    expect(wrapper.get('.library-card').text()).toContain('市场准入知识库');
    await wrapper.get('.list-filters input').setValue('');
    wrapper.findComponent({ name: 'ElSelect' }).vm.$emit('update:modelValue', 'ready');
    await flushPromises();
    expect(wrapper.findAll('.library-card')).toHaveLength(1);
    expect(wrapper.get('.library-card').text()).toContain('信用环境知识库');
    await wrapper.get('.list-filters input').setValue('不存在');
    expect(wrapper.text()).toContain('未找到匹配的语义库');
    wrapper.unmount();
  });
  it('没有密钥时明确显示未配置', async () => {
    mocks.semanticList.mockResolvedValue({ configured: false, libraries: [] });
    const wrapper = mount(SemanticLibraries, { props: { systems: [] }, global: { plugins: [ElementPlus] } });
    await flushPromises();
    expect(wrapper.text()).toContain('模型管理');
    expect(wrapper.text()).toContain('暂无语义库');
    wrapper.unmount();
  });
  it('检索需同意外发问题，展示原文并可回到原指标', async () => {
    mocks.semanticList.mockResolvedValue({ configured: true, libraries: [{ id: 'lib', name: '语义库', versionId: 'v1', canManage: false }] });
    mocks.semanticDetail.mockResolvedValue({ builds: [], active: { status: 'ready' }, preview: [], indicatorCount: 1, chunkCount: 1, pendingChanges: false });
    mocks.semanticSearch.mockResolvedValue({ matches: [{ id: 'c', nodeId: 'n1', path: '一级/二级', label: '统计口径', text: '信用修复内容', metadata: {}, score: 0.9 }], pendingChanges: false });
    const wrapper = mount(SemanticLibraries, { props: { systems: [] }, global: { plugins: [ElementPlus] } });
    await flushPromises();
    await wrapper.findAll('button').find(b => b.text() === '进入语义库')!.trigger('click'); await flushPromises();
    await wrapper.get('.search-row input').setValue('信用修复');
    expect(wrapper.get('.search-row button').attributes('disabled')).toBeDefined();
    await wrapper.get('input[type="checkbox"]').setValue(true);
    await wrapper.get('.search-row button').trigger('click'); await flushPromises();
    expect(mocks.semanticSearch).toHaveBeenCalledWith('lib', '信用修复');
    expect(wrapper.text()).toContain('信用修复内容');
    await wrapper.findAll('button').find(b => b.text() === '查看原指标')!.trigger('click');
    expect(wrapper.emitted('openIndicator')?.[0]).toEqual(['v1', 'n1']);
    expect(wrapper.text()).not.toContain('构建索引');
    wrapper.unmount();
  });
});
