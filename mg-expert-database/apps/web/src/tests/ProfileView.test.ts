import { mount } from '@vue/test-utils';
import ElementPlus, { ElMessage } from 'element-plus';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProfileView from '@/components/ProfileView.vue';
import type { SessionUser } from '@/types/domain';

const apiMock = vi.hoisted(() => ({
  changePassword: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  api: apiMock,
  ApiError: class ApiError extends Error {
    readonly status: number;
    readonly code?: string;
    constructor(message: string, status: number, code?: string) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
    }
  },
}));

const localUser: SessionUser = {
  userId: 'user-1',
  username: 'zhangsan',
  name: '张三',
  departmentName: '营商环境处',
  role: 'researcher',
  authSource: 'local',
};

const wecomUser: SessionUser = {
  userId: 'user-2',
  username: null,
  name: '李四',
  departmentName: null,
  role: 'reader',
  authSource: 'wecom',
};

async function settle(ms = 60) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function render(user: SessionUser) {
  return mount(ProfileView, {
    props: { user },
    global: { plugins: [ElementPlus] },
  });
}

async function fillPasswordForm(wrapper: ReturnType<typeof render>, current: string, next: string, confirm: string) {
  const inputs = wrapper.findAll('input');
  await inputs[0]!.setValue(current);
  await inputs[1]!.setValue(next);
  await inputs[2]!.setValue(confirm);
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.changePassword.mockResolvedValue({ changed: true, revokedSessions: 0 });
});

describe('ProfileView', () => {
  it('资料、密码和登录保护放在同一间距容器内', () => {
    const wrapper = render(localUser);
    const panels = wrapper.get('.profile-body').element.children;
    expect(Array.from(panels).map(panel => panel.className)).toEqual([
      'profile-panel account-panel',
      'profile-panel security-panel',
      'security-options protection-panel',
    ]);
  });

  it('展示个人资料与登录状态，返回按钮触发 back', async () => {
    const wrapper = render(localUser);

    expect(wrapper.get('h1').text()).toBe('个人中心');
    const text = wrapper.text();
    expect(text).toContain('张三');
    expect(text).toContain('zhangsan');
    expect(text).toContain('营商环境处');
    expect(text).toContain('研究员');
    expect(text).toContain('本地账号');
    expect(text).toContain('已登录');

    await wrapper.get('.back-button').trigger('click');
    expect(wrapper.emitted('back')).toHaveLength(1);
  });

  it('企业微信账号显示认证说明，不提供改密表单', () => {
    const wrapper = render(wecomUser);

    const text = wrapper.text();
    expect(text).toContain('企业微信认证账号');
    expect(text).toContain('未设置本地密码');
    expect(wrapper.find('.password-form').exists()).toBe(false);
    expect(wrapper.findAll('input[type="password"]')).toHaveLength(0);
  });

  it('本地账号改密前端校验：长度、确认一致、不能与当前密码相同', async () => {
    const warningSpy = vi.spyOn(ElMessage, 'warning').mockImplementation(() => undefined as never);
    const wrapper = render(localUser);

    await fillPasswordForm(wrapper, 'old-password-1', 'short', 'short');
    await wrapper.get('.save-button').trigger('click');
    await settle();
    expect(apiMock.changePassword).not.toHaveBeenCalled();
    expect(warningSpy).toHaveBeenLastCalledWith('新密码长度需为 10-128 位');

    await fillPasswordForm(wrapper, 'old-password-1', 'new-password-1', 'new-password-2');
    await wrapper.get('.save-button').trigger('click');
    await settle();
    expect(apiMock.changePassword).not.toHaveBeenCalled();
    expect(warningSpy).toHaveBeenLastCalledWith('两次输入的新密码不一致');

    await fillPasswordForm(wrapper, 'same-password-1', 'same-password-1', 'same-password-1');
    await wrapper.get('.save-button').trigger('click');
    await settle();
    expect(apiMock.changePassword).not.toHaveBeenCalled();
    expect(warningSpy).toHaveBeenLastCalledWith('新密码不能与当前密码相同');
  });

  it('本地账号改密成功：调用接口、提示成功、清空表单并保留会话', async () => {
    const successSpy = vi.spyOn(ElMessage, 'success').mockImplementation(() => undefined as never);
    let resolveRequest: (value: { changed: boolean; revokedSessions: number }) => void = () => undefined;
    apiMock.changePassword.mockImplementation(
      () => new Promise((resolve) => { resolveRequest = resolve; }),
    );
    const wrapper = render(localUser);

    await fillPasswordForm(wrapper, 'old-password-1', 'new-password-1', 'new-password-1');
    await wrapper.get('.save-button').trigger('click');
    await settle();

    expect(apiMock.changePassword).toHaveBeenCalledWith('old-password-1', 'new-password-1');
    expect(wrapper.get('.save-button').attributes('disabled')).toBeDefined();

    resolveRequest({ changed: true, revokedSessions: 2 });
    await settle();

    expect(successSpy).toHaveBeenCalled();
    expect(wrapper.emitted('expired')).toBeUndefined();
    const inputs = wrapper.findAll('input');
    expect((inputs[0]!.element as HTMLInputElement).value).toBe('');
    expect((inputs[1]!.element as HTMLInputElement).value).toBe('');
    expect((inputs[2]!.element as HTMLInputElement).value).toBe('');
  });

  it.each([403, 429])('改密被 %s 拒绝时保留输入，不误报成功或会话过期', async (status) => {
    const errorSpy = vi.spyOn(ElMessage, 'error').mockImplementation(() => undefined as never);
    const successSpy = vi.spyOn(ElMessage, 'success').mockImplementation(() => undefined as never);
    const { ApiError } = await import('@/api/client');
    apiMock.changePassword.mockRejectedValueOnce(new ApiError('请重新登录验证或稍后重试', status));
    const wrapper = render(localUser);
    await fillPasswordForm(wrapper, 'old-password-1', 'new-password-1', 'new-password-1');
    await wrapper.get('.save-button').trigger('click'); await settle();
    expect(errorSpy).toHaveBeenCalledWith('请重新登录验证或稍后重试');
    expect(successSpy).not.toHaveBeenCalled();
    expect(wrapper.emitted('expired')).toBeUndefined();
    expect(wrapper.findAll('input').slice(0, 3).map(input => (input.element as HTMLInputElement).value)).toEqual(['old-password-1', 'new-password-1', 'new-password-1']);
  });

  it('改密接口报错时提示错误，401 时通知会话过期', async () => {
    const errorSpy = vi.spyOn(ElMessage, 'error').mockImplementation(() => undefined as never);
    const { ApiError } = await import('@/api/client');
    const wrapper = render(localUser);

    apiMock.changePassword.mockRejectedValueOnce(new ApiError('当前密码不正确', 400));
    await fillPasswordForm(wrapper, 'wrong-password', 'new-password-1', 'new-password-1');
    await wrapper.get('.save-button').trigger('click');
    await settle();
    expect(errorSpy).toHaveBeenCalledWith('当前密码不正确');
    expect(wrapper.emitted('expired')).toBeUndefined();
    expect(wrapper.get('.save-button').attributes('disabled')).toBeUndefined();

    apiMock.changePassword.mockRejectedValueOnce(new ApiError('登录已过期', 401));
    await fillPasswordForm(wrapper, 'old-password-1', 'new-password-1', 'new-password-1');
    await wrapper.get('.save-button').trigger('click');
    await settle();
    expect(wrapper.emitted('expired')).toHaveLength(1);
  });
});
