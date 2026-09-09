import { flushPromises, mount } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AccountSecurity from '@/components/AccountSecurity.vue';
import { api } from '@/api/client';
vi.mock('@/api/client', () => ({ api: { accountSecurity: vi.fn(), authorizeSecurity: vi.fn(), startTotp: vi.fn(), confirmTotp: vi.fn(), removeTotp: vi.fn(), setMfa: vi.fn() } }));
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,test') } }));
let wrapper: ReturnType<typeof mount>;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.accountSecurity).mockResolvedValue({ mfaEnabled: false, methods: [], email: null, totpBound: false, keys: [] });
});
afterEach(() => { wrapper?.unmount(); document.body.innerHTML = ''; });
describe('账户安全设置', () => {
  it('丢失设备可使用完整恢复码关闭多因素验证', async () => {
    vi.mocked(api.accountSecurity).mockResolvedValue({ mfaEnabled: true, methods: ['totp'], email: null, totpBound: true, keys: [] });
    vi.mocked(api.authorizeSecurity).mockResolvedValue({ token: 'recovery-grant' });
    vi.mocked(api.setMfa).mockResolvedValue({ enabled: false, recoveryCodes: [] });
    wrapper = mount(AccountSecurity, { global: { plugins: [ElementPlus] }, attachTo: document.body }); await flushPromises();
    await wrapper.get('[role="switch"]').trigger('click'); await flushPromises();
    wrapper.findComponent({ name: 'ElSelect' }).vm.$emit('update:modelValue', 'recovery'); await flushPromises();
    expect(document.body.textContent).toContain('请输入一枚未使用的恢复码');
    const password = document.body.querySelector('input[type="password"]') as HTMLInputElement;
    password.value = 'CurrentPassword!2026'; password.dispatchEvent(new Event('input', { bubbles: true }));
    const code = document.body.querySelector('input[autocomplete="one-time-code"]') as HTMLInputElement;
    expect(code.maxLength).toBe(32); expect(code.inputMode).toBe('text');
    code.value = 'abcdef0123456789abcdef0123456789'; code.dispatchEvent(new Event('input', { bubbles: true })); await flushPromises();
    (Array.from(document.body.querySelectorAll('button')).find(button => button.textContent?.trim() === '确认') as HTMLButtonElement).click(); await flushPromises();
    expect(api.authorizeSecurity).toHaveBeenCalledWith('CurrentPassword!2026', 'abcdef0123456789abcdef0123456789', 'recovery');
    expect(api.setMfa).toHaveBeenCalledWith('recovery-grant', false, ['totp']);
  });
  it('默认关闭，未绑定方式时不能开启', async () => {
    wrapper = mount(AccountSecurity, { global: { plugins: [ElementPlus] } }); await flushPromises();
    expect(wrapper.text()).toContain('未开启，由你自行选择');
    expect(wrapper.get('[role="switch"]').attributes('aria-disabled')).toBe('true');
    expect(api.setMfa).not.toHaveBeenCalled();
  });
  it('绑定前必须重新输入密码，验证成功后才展示本地二维码', async () => {
    vi.mocked(api.authorizeSecurity).mockResolvedValue({ token: 'grant' });
    vi.mocked(api.startTotp).mockResolvedValue({ token: 'binding', secret: 'TESTSECRET', uri: 'otpauth://totp/test' });
    wrapper = mount(AccountSecurity, { global: { plugins: [ElementPlus] }, attachTo: document.body }); await flushPromises();
    await wrapper.findAll('button').find(button => button.text() === '绑定认证器')!.trigger('click'); await flushPromises();
    expect(api.startTotp).not.toHaveBeenCalled();
    const input = document.body.querySelector('input[type="password"]') as HTMLInputElement;
    input.value = 'CurrentPassword!2026'; input.dispatchEvent(new Event('input', { bubbles: true })); await flushPromises();
    (Array.from(document.body.querySelectorAll('button')).find(button => button.textContent?.trim() === '确认') as HTMLButtonElement).click(); await flushPromises();
    expect(api.authorizeSecurity).toHaveBeenCalledWith('CurrentPassword!2026', '', 'totp');
    expect(api.startTotp).toHaveBeenCalledWith('grant');
    expect(document.body.textContent).toContain('TESTSECRET');
  });
});
