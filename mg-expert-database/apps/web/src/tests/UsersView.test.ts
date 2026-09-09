import { flushPromises, mount } from '@vue/test-utils';
import ElementPlus, { ElMessageBox } from 'element-plus';
import { afterEach, describe, expect, it, vi } from 'vitest';
import UsersView from '@/components/UsersView.vue';

const apiMock = vi.hoisted(() => ({
  listUsers: vi.fn(),
  getWeComSyncStatus: vi.fn(),
  syncWeComUsers: vi.fn(),
}));

vi.mock('@/api/client', () => ({ api: apiMock }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  apiMock.listUsers.mockReset();
  apiMock.getWeComSyncStatus.mockReset();
  apiMock.syncWeComUsers.mockReset();
});

describe('UsersView', () => {
  it('展示自动同步状态并允许管理员立即同步', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok:true, json:async()=>({enabled:false}) }));
    apiMock.listUsers.mockResolvedValue([]);
    apiMock.getWeComSyncStatus.mockResolvedValue({ enabled: true, running: false, intervalMinutes: 60, lastResult: null, lastError: null });
    apiMock.syncWeComUsers.mockResolvedValue({ total: 16, created: 12, updated: 2, bound: 1, unchanged: 1, conflicts: 0, completedAt: '2026-08-22T00:00:00.000Z' });
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never);
    const wrapper = mount(UsersView, { props: { currentUserId: 'admin' }, global: { plugins: [ElementPlus] } });
    await flushPromises();

    expect(wrapper.text()).toContain('企业微信每 60 分钟自动同步');
    const syncButton = wrapper.findAll('button').find((button) => button.text().includes('同步企业微信'))!;
    await syncButton.trigger('click');
    await flushPromises();

    expect(apiMock.syncWeComUsers).toHaveBeenCalledTimes(1);
    expect(apiMock.listUsers).toHaveBeenCalledTimes(2);
    expect(apiMock.getWeComSyncStatus).toHaveBeenCalledTimes(2);
  });
  it('统一认证启用后只展示身份映射，不提供建号和独立企业微信同步', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok:true,json:async()=>({enabled:true})}));
    apiMock.listUsers.mockResolvedValue([]);
    const wrapper=mount(UsersView,{props:{currentUserId:'admin'},global:{plugins:[ElementPlus]}});
    await flushPromises();
    expect(wrapper.text()).toContain('账号资料和访问状态由统一认证中心同步');
    expect(wrapper.text()).not.toContain('新建用户');expect(wrapper.text()).not.toContain('同步企业微信');
    expect(apiMock.getWeComSyncStatus).not.toHaveBeenCalled();
    expect(wrapper.find('a').attributes('href')).toBe('https://identity.meta-gravity.com/admin');
  });

});
