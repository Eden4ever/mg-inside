import { mount } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import HeaderBar from '@/components/HeaderBar.vue';
import { ConfiguredApplicationShell } from '@mg-inside/frontend';
import { applicationForRole } from '@/application';
import { defineComponent, h } from 'vue';
import type { SessionUser } from '@/types/domain';

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }) });
});
const admin: SessionUser = {
  userId: 'admin-1',
  username: 'admin',
  name: '系统管理员',
  departmentName: null,
  role: 'system_admin',
  authSource: 'local',
};

async function settle(ms = 80) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('HeaderBar', () => {
  it('由配置生成页头、图标导航和底部折叠，业务不提供导航标题', async () => {
    const wrapper = mount(HeaderBar, { props: { activeView: 'systems', user: admin }, global: { plugins: [ElementPlus] } });
    expect(wrapper.get('[aria-label="当前模块"]').text()).toBe('指标体系');
    expect(wrapper.get('.brand-copy strong').text()).toBe('指标知识库');
    expect(wrapper.get('.app-sidebar').classes()).toContain('is-collapsed');
    expect(wrapper.find('.mobile-nav-heading').exists()).toBe(false);
    expect(wrapper.get('.global-nav').text()).toBe('');
    expect(wrapper.get('.app-sidebar').element.lastElementChild?.classList.contains('mg-nav-footer')).toBe(true);
    expect(wrapper.find('.app-header .mg-nav-toggle').exists()).toBe(false);
    await wrapper.get('.mg-nav-toggle').trigger('click');
    expect(wrapper.get('.app-sidebar').classes()).not.toContain('is-collapsed');
    expect(wrapper.get('.global-nav').text()).toContain('指标体系');
    await wrapper.get('.nav-item[aria-label="智能语义库"]').trigger('click');
    expect(wrapper.emitted('semantic')).toHaveLength(1);
    await wrapper.setProps({ activeView: 'models' });
    expect(wrapper.get('[aria-label="当前模块"]').text()).toBe('模型管理');
    await wrapper.get('.mg-nav-toggle').trigger('click');
    expect(wrapper.get('.global-nav').text()).toBe('');
    wrapper.unmount();
  });

  it('业务角色仍控制管理入口，个人中心通过账号菜单访问', () => {
    const wrapper = mount(HeaderBar, { props: { activeView: 'systems', user: { ...admin, role: 'researcher' } }, global: { plugins: [ElementPlus] } });
    const navigation = wrapper.get('nav[aria-label="全局导航"]');
    expect(navigation.find('[aria-label="指标体系"]').exists()).toBe(true);
    for (const name of ['用户管理', '模型管理', '邮件设置', '个人中心']) expect(navigation.find(`[aria-label="${name}"]`).exists()).toBe(false);
    wrapper.unmount();
  });

  it('应用不能通过导航插槽或图标组件覆盖公共范式', () => {
    const rogue = defineComponent(() => () => h('b', { class: 'rogue-icon' }, '任意组件'));
    const wrapper = mount(ConfiguredApplicationShell, {
      props: { config: applicationForRole('system_admin'), activePath: '/systems' },
      attrs: { icons: { 'book-open': rogue }, class: 'business-override' },
      slots: { navigation: '<h1>功能导航</h1>', footer: '<button>自定义折叠</button>', default: '<article>正文插槽</article>' },
    });
    expect(wrapper.find('.rogue-icon').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('功能导航');
    expect(wrapper.text()).not.toContain('自定义折叠');
    expect(wrapper.find('.business-override').exists()).toBe(false);
    expect(wrapper.get('.global-nav .nav-item svg').attributes('stroke')).toBe('currentColor');
    expect(wrapper.get('article').text()).toBe('正文插槽');
    wrapper.unmount();
  });

  it('头像下拉提供个人中心入口并保留退出登录', async () => {
    const wrapper = mount(HeaderBar, {
      props: { activeView: 'profile', user: admin },
      attachTo: document.body,
      global: { plugins: [ElementPlus] },
    });

    const dropdownItems = () => Array.from(document.body.querySelectorAll<HTMLElement>('.el-dropdown-menu__item'));

    await wrapper.get('.user-trigger').trigger('click');
    await settle();
    const labels = dropdownItems().map((item) => item.textContent || '');
    expect(labels.some((text) => text.includes('个人中心'))).toBe(true);
    expect(labels.some((text) => text.includes('退出登录'))).toBe(true);

    dropdownItems().find((item) => item.textContent?.includes('个人中心'))?.click();
    await settle(30);
    expect(wrapper.emitted('profile')).toHaveLength(1);

    await wrapper.get('.user-trigger').trigger('click');
    await settle();
    dropdownItems().find((item) => item.textContent?.includes('退出登录'))?.click();
    await settle(30);
    expect(wrapper.emitted('logout')).toHaveLength(1);

    wrapper.unmount();
  });
});
