import { flushPromises, mount } from '@vue/test-utils';
import ElementPlus, { ElMessage } from 'element-plus';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LoginView from '@/components/LoginView.vue';
import { api } from '@/api/client';
import wecomLogoUrl from '@/assets/wecom.svg?url';
import beianLogoUrl from '@/assets/beian.png?url';
import { startAuthentication } from '@simplewebauthn/browser';
vi.mock('@simplewebauthn/browser', () => ({ startAuthentication: vi.fn() }));

vi.mock('@/api/client', () => ({ api: { login: vi.fn(), wecomStatus: vi.fn(), startWeCom: vi.fn(), pendingAuth: vi.fn(), setupCredentials: vi.fn(), mfaKeyOptions: vi.fn(), verifyMfa: vi.fn() } }));
const user = { userId: 'test-user', username: 'demo-user', name: '演示用户', departmentName: null, authSource: 'local' as const, role: 'system_admin' as const };
const defaults = { username: 'demo-user', password: 'Demo-UI-Only-2026!' };
let wrapper: ReturnType<typeof mount<typeof LoginView>> | undefined;
const render = () => (wrapper = mount(LoginView, { global: { plugins: [ElementPlus] }, attachTo: document.body }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.pendingAuth).mockRejectedValue(new Error('没有待完成认证'));
  window.history.replaceState({}, '', '/');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => defaults }));
  vi.mocked(api.wecomStatus).mockResolvedValue({ enabled: false, message: '企业微信登录暂未启用' });
  vi.spyOn(ElMessage, 'warning').mockImplementation(() => ({ close: vi.fn() }));
  vi.spyOn(ElMessage, 'error').mockImplementation(() => ({ close: vi.fn() }));
});
afterEach(() => { wrapper?.unmount(); wrapper = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });

describe('LoginView', () => {
  it('取消安全密钥验证不提交凭证、不发出已登录事件', async () => {
    vi.mocked(api.pendingAuth).mockResolvedValue({ state: 'mfa_required', username: 'user', csrfToken: 'pending', methods: ['key'] });
    vi.mocked(api.mfaKeyOptions).mockResolvedValue({ challenge: 'challenge', rpId: 'localhost', allowCredentials: [] });
    vi.mocked(startAuthentication).mockRejectedValue(new Error('用户取消了验证'));
    const view = render(); await flushPromises();
    await view.get('form').trigger('submit'); await flushPromises();
    expect(startAuthentication).toHaveBeenCalled();
    expect(api.verifyMfa).not.toHaveBeenCalled();
    expect(view.emitted('authenticated')).toBeUndefined();
  });
  it('首次设置展示可编辑的用户名，确认密码一致后才提交', async () => {
    vi.mocked(api.pendingAuth).mockResolvedValue({ state: 'setup_required', username: 'zhangsan1', csrfToken: 'pending', methods: [] });
    vi.mocked(api.setupCredentials).mockResolvedValue({ user, csrfToken: 'session' });
    const view = render(); await flushPromises();
    expect(view.text()).toContain('设置账号');
    const fields = view.findAll('input');
    expect((fields[0]!.element as HTMLInputElement).value).toBe('zhangsan1');
    await fields[0]!.setValue('myname');
    await fields[1]!.setValue('SetupPassword!2026');
    await fields[2]!.setValue('different');
    await view.get('form').trigger('submit'); await flushPromises();
    expect(api.setupCredentials).not.toHaveBeenCalled();
    await fields[2]!.setValue('SetupPassword!2026');
    await view.get('form').trigger('submit'); await flushPromises();
    expect(api.setupCredentials).toHaveBeenCalledWith('myname', 'SetupPassword!2026');
    expect(view.emitted('authenticated')?.[0]).toEqual([user]);
  });
  it('展示官网版权与备案原文，使用本地公安徽章和安全外链', async () => {
    const view = render(); await flushPromises();
    const footer = view.get('footer');
    expect(footer.text()).toContain('© 2026 郑州元引信息科技有限公司');
    const links = footer.findAll('a');
    expect(links.map(link => link.text())).toEqual(['豫ICP备2026018311号-1', '豫公网安备41010702004272号']);
    expect(links.map(link => link.attributes('href'))).toEqual(['https://beian.miit.gov.cn/', 'https://beian.mps.gov.cn/#/query/webSearch?code=41010702004272']);
    for (const link of links) { expect(link.attributes('target')).toBe('_blank'); expect(link.attributes('rel')).toBe('noopener noreferrer'); }
    expect(footer.get('img').attributes('src')).toBe(beianLogoUrl);
  });
  it('保留本地默认填入与语义化账号、密码表单，不增加未实现入口', async () => {
    const view = render(); await flushPromises();
    expect(fetch).toHaveBeenCalledWith('/__local-login-defaults', { cache: 'no-store' });
    expect((view.get('input[autocomplete="username"]').element as HTMLInputElement).value).toBe(defaults.username);
    expect((view.get('input[autocomplete="current-password"]').element as HTMLInputElement).value).toBe(defaults.password);
    expect(view.get('input[autocomplete="current-password"]').attributes('type')).toBe('password');
    expect(view.get('h1').text()).toBe('营商环境指标知识库');
    expect(view.get('h2').text()).toBe('登录');
    expect(view.get('.login-submit').attributes('type')).toBe('submit');
    expect(view.text()).not.toMatch(/注册|忘记密码/);
    expect(view.text()).not.toContain('使用已分配的系统账号');
    expect(view.text()).not.toContain('账号权限由系统管理员统一配置');
    expect(view.get('.wecom-logo').attributes('src')).toBe(wecomLogoUrl);
    expect(view.get('.wecom-logo').attributes('alt')).toBe('');
    expect(view.get('.login-ambience').attributes('aria-hidden')).toBe('true');
    expect(view.findAll('.login-glow')).toHaveLength(2);
    expect(view.get('.wecom-button').attributes('disabled')).toBeDefined();
    expect(view.text()).toContain('企业微信登录暂未启用');
  });

  it('迟到的本地默认值不会覆盖已经手动输入的账号', async () => {
    let resolveDefaults!: (value: Response) => void;
    vi.mocked(fetch).mockReturnValue(new Promise<Response>(resolve => { resolveDefaults = resolve; }));
    const view = render();
    await view.get('input[autocomplete="username"]').setValue('typed-user');
    resolveDefaults({ ok: true, json: async () => defaults } as Response);
    await flushPromises();
    expect((view.get('input[autocomplete="username"]').element as HTMLInputElement).value).toBe('typed-user');
    expect((view.get('input[autocomplete="current-password"]').element as HTMLInputElement).value).toBe('');
  });

  it('缺少账号密码不提交，账号去空格后正常登录并防止重复提交', async () => {
    let finishLogin!: (value: Awaited<ReturnType<typeof api.login>>) => void;
    vi.mocked(api.login).mockImplementation(() => new Promise(resolve => { finishLogin = resolve; }));
    const view = render(); await flushPromises();
    await view.get('input[autocomplete="username"]').setValue(' ');
    await view.get('form').trigger('submit');
    expect(api.login).not.toHaveBeenCalled();
    expect(ElMessage.warning).toHaveBeenCalledWith('请输入账号和密码');
    await view.get('input[autocomplete="username"]').setValue('  demo-user  ');
    await view.get('form').trigger('submit');
    await view.get('form').trigger('submit');
    expect(api.login).toHaveBeenCalledTimes(1);
    expect(api.login).toHaveBeenCalledWith('demo-user', defaults.password);
    expect(view.get('input[autocomplete="username"]').attributes('disabled')).toBeDefined();
    finishLogin({ user, csrfToken: 'browser-test-token' });
    await flushPromises();
    expect(view.emitted('authenticated')).toEqual([[user]]);
  });

  it('登录失败保留输入并允许重试', async () => {
    vi.mocked(api.login).mockRejectedValue(new Error('账号或密码错误'));
    const view = render(); await flushPromises();
    await view.get('form').trigger('submit'); await flushPromises();
    expect(ElMessage.error).toHaveBeenCalledWith('账号或密码错误');
    expect((view.get('input[autocomplete="current-password"]').element as HTMLInputElement).value).toBe(defaults.password);
    expect(view.get('input[autocomplete="username"]').attributes('disabled')).toBeUndefined();
    expect(view.emitted('authenticated')).toBeUndefined();
  });

  it('企业微信登录防双提交，失败恢复按钮且保留本地登录', async () => {
    vi.mocked(api.wecomStatus).mockResolvedValue({ enabled: true, message: '' });
    let rejectWeCom!: (reason: Error) => void;
    vi.mocked(api.startWeCom).mockImplementation(() => new Promise((_resolve, reject) => { rejectWeCom = reject; }));
    const view = render(); await flushPromises();
    await view.get('.wecom-button').trigger('click');
    await view.get('.wecom-button').trigger('click');
    await view.get('form').trigger('submit');
    expect(api.startWeCom).toHaveBeenCalledTimes(1);
    expect(api.login).not.toHaveBeenCalled();
    expect(view.get('.login-submit').attributes('disabled')).toBeDefined();
    rejectWeCom(new Error('企业微信登录暂不可用')); await flushPromises();
    expect(ElMessage.error).toHaveBeenCalledWith('企业微信登录暂不可用');
    expect(view.get('.wecom-button').attributes('disabled')).toBeUndefined();
    expect(view.get('.login-submit').attributes('disabled')).toBeUndefined();
  });

  it('默认填入与企业微信状态接口不可用时仍可手动登录', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('本地预填不可用'));
    vi.mocked(api.wecomStatus).mockRejectedValue(new Error('配置读取失败'));
    vi.mocked(api.login).mockResolvedValue({ user, csrfToken: 'browser-test-token' });
    const view = render(); await flushPromises();
    expect(view.text()).toContain('暂时无法读取企业微信登录配置');
    await view.get('input[autocomplete="username"]').setValue('demo-user');
    await view.get('input[autocomplete="current-password"]').setValue('Demo-UI-Only-2026!');
    await view.get('form').trigger('submit'); await flushPromises();
    expect(view.emitted('authenticated')).toEqual([[user]]);
  });
});
