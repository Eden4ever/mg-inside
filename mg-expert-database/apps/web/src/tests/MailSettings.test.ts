import { flushPromises, mount } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MailSettings from '@/components/MailSettings.vue';
import { api } from '@/api/client';

vi.mock('@/api/client', () => ({ api: { mailSettings: vi.fn(), saveMailSettings: vi.fn(), testMailSettings: vi.fn() } }));
const settings = { enabled: true, host: 'smtp.example.com', port: 465, security: 'tls' as const, username: 'sender', fromAddress: 'sender@example.com', fromName: '知识库', revision: 1, hasPassword: true };
let wrapper: ReturnType<typeof mount>;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.mailSettings).mockResolvedValue({ ...settings });
});
afterEach(() => wrapper?.unmount());
async function render() {
  wrapper = mount(MailSettings, { global: { plugins: [ElementPlus] } });
  await flushPromises();
}
describe('邮件设置', () => {
  it('仅有下拉或开关变更也保护未保存配置，保存失败保留保护', async () => {
    await render();
    expect(wrapper.emitted('closeStateChange')?.at(-1)).toEqual([{ dirty: false, busy: false }]);
    await wrapper.get('.el-switch').trigger('click');
    expect(wrapper.emitted('closeStateChange')?.at(-1)).toEqual([{ dirty: true, busy: false }]);
    vi.mocked(api.saveMailSettings).mockRejectedValue(new Error('离线'));
    await wrapper.findAll('form')[0]!.trigger('submit');
    await flushPromises();
    expect(wrapper.emitted('closeStateChange')?.at(-1)).toEqual([{ dirty: true, busy: false }]);
  });
  it('不回显已保存密码，留空保存时不提交密码', async () => {
    vi.mocked(api.saveMailSettings).mockResolvedValue({ ...settings, revision: 2 });
    await render();
    expect(wrapper.get<HTMLInputElement>('input[type="password"]').element.value).toBe('');
    await wrapper.findAll('form')[0]!.trigger('submit');
    await flushPromises();
    expect(api.saveMailSettings).toHaveBeenCalledWith(expect.objectContaining({ revision: 1 }));
    expect(vi.mocked(api.saveMailSettings).mock.calls[0]![0]).not.toHaveProperty('password');
  });
  it('未保存修改时，回车也不能发送测试邮件', async () => {
    await render();
    await wrapper.get('input[placeholder="填写测试收件邮箱"]').setValue('test@example.com');
    await wrapper.get('input[placeholder="smtp.example.com"]').setValue('other.example.com');
    await wrapper.findAll('form')[1]!.trigger('submit');
    expect(api.testMailSettings).not.toHaveBeenCalled();
  });
  it('使用保存的配置发送，并展示服务器接受结果', async () => {
    vi.mocked(api.testMailSettings).mockResolvedValue({ ok: true, message: '邮件服务器已接受发送，请检查收件箱或垃圾邮件。' });
    await render();
    await wrapper.get('input[placeholder="填写测试收件邮箱"]').setValue('test@example.com');
    await wrapper.findAll('form')[1]!.trigger('submit');
    await flushPromises();
    expect(api.testMailSettings).toHaveBeenCalledWith('test@example.com');
    expect(wrapper.text()).toContain('邮件服务器已接受发送');
  });
  it('发送失败显示错误，不显示成功状态', async () => {
    vi.mocked(api.testMailSettings).mockRejectedValue(new Error('邮件发送失败'));
    await render();
    await wrapper.get('input[placeholder="填写测试收件邮箱"]').setValue('test@example.com');
    await wrapper.findAll('form')[1]!.trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('邮件发送失败');
    expect(wrapper.find('.el-alert--success').exists()).toBe(false);
  });
});
