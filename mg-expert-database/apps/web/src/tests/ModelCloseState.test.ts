import { flushPromises, mount } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { expect, it, vi } from 'vitest';
import ModelManagement from '@/components/ModelManagement.vue';
import { api } from '@/api/client';

vi.mock('@/api/client', () => ({ api: { modelConfig: vi.fn(), saveModelConfig: vi.fn(), testModelConfig: vi.fn() } }));

it('模型密钥及开关变更均进入关闭保护，保存失败不清除草稿状态', async () => {
  vi.mocked(api.modelConfig).mockResolvedValue({ enabled: true, configured: true, hasKey: true, revision: 1 });
  vi.mocked(api.saveModelConfig).mockRejectedValue(new Error('离线'));
  const wrapper = mount(ModelManagement, { global: { plugins: [ElementPlus] } });
  await flushPromises();
  expect(wrapper.emitted('closeStateChange')?.at(-1)).toEqual([{ dirty: false, busy: false }]);
  await wrapper.get('.el-switch').trigger('click');
  expect(wrapper.emitted('closeStateChange')?.at(-1)).toEqual([{ dirty: true, busy: false }]);
  await wrapper.get('.el-switch').trigger('click');
  expect(wrapper.emitted('closeStateChange')?.at(-1)).toEqual([{ dirty: false, busy: false }]);
  await wrapper.get('input[type="password"]').setValue('test-unsaved-key');
  expect(wrapper.emitted('closeStateChange')?.at(-1)).toEqual([{ dirty: true, busy: false }]);
  await wrapper.get('form').trigger('submit');
  await flushPromises();
  expect(wrapper.emitted('closeStateChange')?.at(-1)).toEqual([{ dirty: true, busy: false }]);
  wrapper.unmount();
});
