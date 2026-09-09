import { flushPromises, mount } from '@vue/test-utils';
import ElementPlus, { ElMessageBox } from 'element-plus';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SystemEditDialog from '@/components/SystemEditDialog.vue';
import { api } from '@/api/client';
import type { IndicatorSystemSummary } from '@/types/domain';
vi.mock('@/api/client', () => ({ api: { updateSystem: vi.fn(), deleteSystem: vi.fn() } }));
const system = { id: 'system-1', name: '测试体系', region: '测试地区' } as IndicatorSystemSummary;
let wrapper: ReturnType<typeof mount>;
afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks(); vi.clearAllMocks(); });
function render() { return mount(SystemEditDialog, { props: { system }, global: { plugins: [ElementPlus] } }); }
describe('体系基本信息维护', () => {
  it('保存名称和地区，不展示节点编码或版本字段', async () => {
    vi.mocked(api.updateSystem).mockResolvedValue({});
    wrapper = render(); await flushPromises();
    const inputs = wrapper.findAll('input');
    expect(inputs).toHaveLength(2);
    await inputs[0]!.setValue('新名称'); await inputs[1]!.setValue('新地区');
    await wrapper.findAll('button').find(b => b.text() === '保存')!.trigger('click'); await flushPromises();
    expect(api.updateSystem).toHaveBeenCalledWith('system-1', { name: '新名称', region: '新地区' });
    expect(wrapper.emitted('saved')).toHaveLength(1);
  });
  it('取消删除不调用接口，确认后携带完整名称', async () => {
    const prompt = vi.spyOn(ElMessageBox, 'prompt').mockRejectedValueOnce('cancel');
    wrapper = render(); await flushPromises();
    const button = wrapper.findAll('button').find(b => b.text() === '删除体系')!;
    await button.trigger('click'); await flushPromises();
    expect(api.deleteSystem).not.toHaveBeenCalled();
    prompt.mockResolvedValueOnce({ value: system.name, action: 'confirm' } as Awaited<ReturnType<typeof ElMessageBox.prompt>>);
    vi.mocked(api.deleteSystem).mockResolvedValueOnce(undefined);
    await button.trigger('click'); await flushPromises();
    expect(api.deleteSystem).toHaveBeenCalledWith(system.id, system.name);
    expect(wrapper.emitted('removed')).toHaveLength(1);
  });
});
