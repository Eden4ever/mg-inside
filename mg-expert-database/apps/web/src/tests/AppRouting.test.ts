import { mount } from '@vue/test-utils';
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus';
import { defineComponent } from 'vue';
import { createMemoryHistory } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '@/App.vue';
import { createAppRouter } from '@/router';
import { desktop } from '@/desktop';

const apiMock = vi.hoisted(() => ({
  me: vi.fn(),
  listSystems: vi.fn(),
  getVersionDetail: vi.fn(),
  getTree: vi.fn(),
  updateNode: vi.fn(),
  deleteNode: vi.fn(),
  getWorkspace: vi.fn(),
  updateModule: vi.fn(),
  listAiSuggestions: vi.fn(),
  listEvidence: vi.fn(),
  listAssignments: vi.fn(),
  listResearchers: vi.fn(),
  aiStatus: vi.fn(),
  changePassword: vi.fn(),
}));

vi.mock('@/api/client', () => ({
  api: apiMock,
  setCsrfToken: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string, public code?: string) { super(message); }
  },
}));

const admin = { userId: 'admin-1', username: 'admin', displayName: '管理员', departmentName: '营商环境处', role: 'system_admin' as const };
const reader = { ...admin, userId: 'reader-1', username: 'reader', displayName: '只读用户', role: 'reader' as const };
const system = { id: 'system-1', versionId: 'version-1', name: '营商环境评价', code: 'BUSINESS', year: 2026, version: 'V1.0', region: '全省', indicatorCount: 1, progress: 0, status: 'researching', updatedAt: '2026-08-23', access: { canView: true, canResearch: true, canManageCatalog: true, canReview: true, canPublish: true } };
const node = { id: 'indicator-1', parentId: 'level-2', level: 3, code: 'CREDIT-01', name: '信用修复办理时效', sortOrder: 1, children: [] };
const tree = [{ id: 'level-1', parentId: null, level: 1, code: 'L1', name: '信用环境', sortOrder: 1, children: [{ id: 'level-2', parentId: 'level-1', level: 2, code: 'L2', name: '信用监管', sortOrder: 1, children: [node] }] }];
const versionDetail = { ...system, createdAt: '2026-08-20', counts: { level1: 1, level2: 1, level3: 1, researchRecords: 0 }, moduleStatusCounts: { not_started: 0, in_progress: 0, pending_review: 0, confirmed: 0, returned: 0 }, tree };
const workspace = {
  system,
  indicator: { id: node.id, code: node.code, name: node.name, level1Name: '信用环境', level2Name: '信用监管', progress: 0, issues: 0 },
  summary: null,
  summaryRevisionNo: 0,
  moduleDefinitions: [],
  modules: [],
  recentRevisions: [],
};
const openEdit = vi.fn();
const saveFailed = vi.fn();
const isSaving = vi.fn(() => false);
const saveCurrent = vi.fn(() => true);
const WorkspaceStub = defineComponent({
  name: 'ResearchWorkspace',
  props: ['workspace', 'selectedModuleKey', 'saveVersion', 'readonly'],
  setup(_, { expose }) { expose({ saveFailed, isSaving, saveCurrent, discardCurrent: vi.fn(), showConflict: vi.fn() }); },
  template: '<div class="research-workspace-stub"></div>',
});
const TreePanelStub = defineComponent({
  name: 'IndicatorTreePanel',
  props: ['nodes', 'selectedId', 'readonly'],
  setup(_, { expose }) { expose({ openEdit }); },
  template: '<div class="tree-panel-stub"></div>',
});

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 40));
}

function render(router: ReturnType<typeof createAppRouter>) {
  return mount(App, {
    global: {
      plugins: [ElementPlus, router],
      stubs: {
        HeaderBar: { name: 'HeaderBar', template: '<div><slot /></div>' },
        LoginView: true,
        UsersView: true,
        SystemsView: true,
        SystemDetailView: true,
        ProfileView: true,
        IndicatorTreePanel: TreePanelStub,
        ResearchWorkspace: WorkspaceStub,
        AiExpertPanel: true,
      },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.me.mockResolvedValue({ user: admin });
  apiMock.listSystems.mockResolvedValue([system]);
  apiMock.getVersionDetail.mockResolvedValue(versionDetail);
  apiMock.getTree.mockResolvedValue(tree);
  apiMock.updateNode.mockResolvedValue(node);
  apiMock.getWorkspace.mockResolvedValue(workspace);
  isSaving.mockReturnValue(false);
  saveCurrent.mockReturnValue(true);
  apiMock.listAiSuggestions.mockResolvedValue([]);
  apiMock.listEvidence.mockResolvedValue([]);
  apiMock.listAssignments.mockResolvedValue([]);
  apiMock.listResearchers.mockResolvedValue([]);
  apiMock.aiStatus.mockResolvedValue({ configured: false });
});

describe('App 路由会话协调', () => {
  it('确认删除传递名称并离开已删除指标', async () => {
    const router = createAppRouter(createMemoryHistory());
    await router.push('/systems/version-1/indicators/indicator-1');
    const wrapper = render(router);
    await settle();
    apiMock.deleteNode.mockResolvedValue(undefined);
    apiMock.getTree.mockResolvedValue([]);
    wrapper.findComponent({ name: 'IndicatorTreePanel' }).vm.$emit('remove', node.id, node.name);
    await settle();
    expect(apiMock.deleteNode).toHaveBeenCalledWith('version-1', node.id, node.name);
    expect(router.currentRoute.value.name).toBe('system-detail');
    expect(wrapper.findComponent({ name: 'ResearchWorkspace' }).exists()).toBe(false);
    wrapper.unmount();
  });
  it('删除失败保留当前指标内容', async () => {
    const router = createAppRouter(createMemoryHistory());
    await router.push('/systems/version-1/indicators/indicator-1');
    const wrapper = render(router);
    await settle();
    apiMock.deleteNode.mockRejectedValueOnce(new Error('删除失败'));
    wrapper.findComponent({ name: 'IndicatorTreePanel' }).vm.$emit('remove', node.id, node.name);
    await settle();
    expect(router.currentRoute.value.params.indicatorId).toBe(node.id);
    expect(wrapper.findComponent({ name: 'ResearchWorkspace' }).props('workspace').indicator.id).toBe(node.id);
    wrapper.unmount();
  });
  it('将非模块编辑状态和传送弹窗合并上报，关闭弹窗不清除其它草稿', async () => {
    const state = vi.spyOn(desktop, 'setState');
    const router = createAppRouter(createMemoryHistory());
    await router.push('/systems/version-1/indicators/indicator-1');
    const wrapper = render(router);
    await settle();
    const editor = wrapper.findComponent({ name: 'ResearchWorkspace' });
    editor.vm.$emit('close-state-change', { dirty: true, busy: false });
    expect(state).toHaveBeenLastCalledWith({ dirty: true, busy: false });
    const dialog = document.createElement('div'); dialog.className = 'el-overlay-dialog';
    vi.spyOn(dialog, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
    document.body.append(dialog); await settle();
    dialog.remove(); await settle();
    expect(state).toHaveBeenLastCalledWith({ dirty: true, busy: false });
    editor.vm.$emit('close-state-change', { dirty: false, busy: true });
    expect(state).toHaveBeenLastCalledWith({ dirty: false, busy: true });
    editor.vm.$emit('close-state-change', { dirty: false, busy: false });
    expect(state).toHaveBeenLastCalledWith({ dirty: false, busy: false });
    wrapper.unmount(); state.mockRestore();
  });
  it('离开前保存被表单校验阻止时，不残留待跳转路由', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never);
    apiMock.updateModule.mockResolvedValue({ moduleKey: 'portrait', status: 'in_progress', revisionNo: 1, values: [] });
    const router = createAppRouter(createMemoryHistory());
    await router.push('/systems/version-1/indicators/indicator-1');
    const wrapper = render(router);
    await settle();
    const editor = wrapper.findComponent({ name: 'ResearchWorkspace' });
    editor.vm.$emit('dirty-change', true);
    await settle();
    saveCurrent.mockReturnValue(false);
    await router.push('/systems');
    expect(saveCurrent).toHaveBeenCalledOnce();
    expect(router.currentRoute.value.params.indicatorId).toBe('indicator-1');
    editor.vm.$emit('dirty-change', false);
    editor.vm.$emit('save', 'portrait', { expectedRevisionNo: 0, values: [{ fieldKey: 'indicator_nature', value: '正向指标' }] });
    await settle();
    expect(router.currentRoute.value.params.indicatorId).toBe('indicator-1');
    wrapper.unmount();
    confirm.mockRestore();
  });

  it('保存请求失败时通知字段编辑器解锁，并保留当前指标', async () => {
    const error = vi.spyOn(ElMessage, 'error');
    apiMock.updateModule.mockRejectedValue(new Error('网络连接中断'));
    const router = createAppRouter(createMemoryHistory());
    await router.push('/systems/version-1/indicators/indicator-1');
    const wrapper = render(router);
    await settle();
    wrapper.findComponent({ name: 'ResearchWorkspace' }).vm.$emit('save', 'portrait', { expectedRevisionNo: 0, values: [{ fieldKey: 'indicator_nature', value: '正向指标' }] });
    await settle();
    expect(saveFailed).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith('网络连接中断');
    expect(router.currentRoute.value.params.indicatorId).toBe('indicator-1');
    wrapper.unmount();
    error.mockRestore();
  });

  it('保存中即使没有脏标记也禁止切走，保存结束才允许导航', async () => {
    const warning = vi.spyOn(ElMessage, 'warning');
    const confirm = vi.spyOn(ElMessageBox, 'confirm');
    const router = createAppRouter(createMemoryHistory());
    await router.push('/systems/version-1/indicators/indicator-1');
    const wrapper = render(router);
    await settle();
    isSaving.mockReturnValue(true);
    await router.push('/profile');
    expect(router.currentRoute.value.params.indicatorId).toBe('indicator-1');
    expect(warning).toHaveBeenCalledWith('内容正在保存，请稍候');
    expect(confirm).not.toHaveBeenCalled();
    isSaving.mockReturnValue(false);
    await router.push('/profile');
    expect(router.currentRoute.value.name).toBe('profile');
    wrapper.unmount();
    warning.mockRestore();
    confirm.mockRestore();
  });

  it('旧指标的延迟保存响应不会写回离开后的工作区', async () => {
    let finish!: (value: unknown) => void;
    apiMock.updateModule.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const router = createAppRouter(createMemoryHistory());
    await router.push('/systems/version-1/indicators/indicator-1');
    const wrapper = render(router);
    await settle();
    wrapper.findComponent({ name: 'ResearchWorkspace' }).vm.$emit('save', 'portrait', { expectedRevisionNo: 0, values: [{ fieldKey: 'indicator_nature', value: '正向指标' }] });
    await settle();
    await router.push('/systems');
    await settle();
    finish({ moduleKey: 'portrait', status: 'in_progress', revisionNo: 1, values: [] });
    await settle();
    expect(router.currentRoute.value.name).toBe('systems');
    expect(wrapper.findComponent({ name: 'ResearchWorkspace' }).exists()).toBe(false);
    wrapper.unmount();
  });

  it('体系入口直接进入首个三级指标，不显示中间页', async () => {
    const router = createAppRouter(createMemoryHistory());
    await router.push('/systems/version-1');
    await router.isReady();
    const wrapper = render(router);
    await settle();

    expect(router.currentRoute.value.name).toBe('indicator-workspace');
    expect(apiMock.getVersionDetail).toHaveBeenCalledWith('version-1');
    expect(apiMock.getWorkspace).toHaveBeenCalledWith('version-1', 'indicator-1');
    expect(wrapper.findComponent({ name: 'ResearchWorkspace' }).exists()).toBe(true);
    wrapper.unmount();
  });

  it('登录恢复后支持三级指标深链接和浏览器返回', async () => {
    const router = createAppRouter(createMemoryHistory());
    await router.push('/systems');
    await router.isReady();
    const wrapper = render(router);
    await settle();

    await router.push('/systems/version-1/indicators/indicator-1');
    await settle();
    expect(apiMock.getVersionDetail).toHaveBeenCalledWith('version-1');
    expect(apiMock.getWorkspace).toHaveBeenCalledWith('version-1', 'indicator-1');
    expect(wrapper.findComponent({ name: 'ResearchWorkspace' }).exists()).toBe(true);

    router.back();
    await settle();
    expect(router.currentRoute.value.name).toBe('systems');
    expect(wrapper.findComponent({ name: 'SystemsView' }).exists()).toBe(true);
    wrapper.unmount();
  });

  it('空体系显示目录维护并可返回列表', async () => {
    apiMock.getVersionDetail.mockResolvedValue({ ...versionDetail, tree: [] });
    const router = createAppRouter(createMemoryHistory());
    await router.push('/systems/version-1');
    const wrapper = render(router);
    await settle();
    expect(wrapper.findComponent({ name: 'IndicatorTreePanel' }).exists()).toBe(true);
    expect(apiMock.getWorkspace).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('暂无指标');
    expect(wrapper.find('.workspace-toolbar').exists()).toBe(true);
    await wrapper.get('.workspace-back').trigger('click');
    await settle();
    expect(router.currentRoute.value.name).toBe('systems');
    wrapper.unmount();
  });

  it('AI 指标专家默认收起', async () => {
    const router = createAppRouter(createMemoryHistory());
    await router.push('/systems/version-1/indicators/indicator-1');
    const wrapper = render(router);
    await settle();
    expect(wrapper.findComponent({ name: 'AiExpertPanel' }).props('collapsed')).toBe(true);
    wrapper.unmount();
  });

  it('顶部编辑体系，节点编辑仍通过指标树保存', async () => {
    const router = createAppRouter(createMemoryHistory());
    await router.push('/systems/version-1/indicators/indicator-1');
    const wrapper = render(router);
    await settle();
    await wrapper.get('.workspace-edit-system').trigger('click');
    expect(openEdit).not.toHaveBeenCalled();
    expect(wrapper.findComponent({ name: 'SystemEditDialog' }).exists()).toBe(true);
    wrapper.findComponent({ name: 'SystemEditDialog' }).vm.$emit('close');

    const updatedNode = { ...node, name: '信用修复办理时限', code: 'CREDIT-02', sortOrder: 2 };
    apiMock.getTree.mockResolvedValue([{ ...tree[0], children: [{ ...tree[0]!.children[0], children: [updatedNode] }] }]);
    const contentBefore = wrapper.findComponent({ name: 'ResearchWorkspace' }).props('workspace');
    wrapper.findComponent({ name: 'IndicatorTreePanel' }).vm.$emit('edit', node.id, { name: updatedNode.name, code: updatedNode.code, sortOrder: 2 });
    await settle();
    expect(apiMock.updateNode).toHaveBeenCalledWith('version-1', node.id, { name: updatedNode.name, code: updatedNode.code, sortOrder: 2 });
    const contentAfter = wrapper.findComponent({ name: 'ResearchWorkspace' }).props('workspace');
    expect(contentAfter.indicator).toMatchObject({ id: node.id, name: updatedNode.name, code: updatedNode.code });
    expect(contentAfter.modules).toBe(contentBefore.modules);
    expect(apiMock.getWorkspace).toHaveBeenCalledTimes(1);
    expect(wrapper.get('.workspace-edit-system').text()).toBe('编辑指标体系');
    wrapper.unmount();
  });

  it('正文有未保存输入时提示先保存或取消，不打开指标编辑表单', async () => {
    const warning = vi.spyOn(ElMessage, 'warning');
    const router = createAppRouter(createMemoryHistory());
    await router.push('/systems/version-1/indicators/indicator-1');
    const wrapper = render(router);
    await settle();
    wrapper.findComponent({ name: 'ResearchWorkspace' }).vm.$emit('dirty-change', true);
    await wrapper.get('.workspace-edit-system').trigger('click');
    expect(openEdit).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith('请先保存或取消当前编辑');
    wrapper.unmount();
    warning.mockRestore();
  });

  it('无目录管理权限时隐藏详情编辑指标按钮', async () => {
    apiMock.me.mockResolvedValue({ user: reader });
    apiMock.getVersionDetail.mockResolvedValue({ ...versionDetail, access: { ...system.access, canManageCatalog: false } });
    const router = createAppRouter(createMemoryHistory());
    await router.push('/systems/version-1/indicators/indicator-1');
    const wrapper = render(router);
    await settle();
    expect(wrapper.find('.workspace-edit-system').exists()).toBe(false);
    wrapper.unmount();
  });

  it('工作台返回按钮直接回到体系列表', async () => {
    const router = createAppRouter(createMemoryHistory());
    await router.push('/systems/version-1/indicators/indicator-1');
    const wrapper = render(router);
    await settle();
    await wrapper.get('.workspace-back').trigger('click');
    await settle();
    expect(router.currentRoute.value.name).toBe('systems');
    wrapper.unmount();
  });

  it('非管理员通过地址栏进入用户管理时重定向到体系列表', async () => {
    apiMock.me.mockResolvedValue({ user: reader });
    const router = createAppRouter(createMemoryHistory());
    await router.push('/users');
    await router.isReady();
    const wrapper = render(router);
    await settle();
    expect(router.currentRoute.value.name).toBe('systems');
    expect(wrapper.findComponent({ name: 'UsersView' }).exists()).toBe(false);
    wrapper.unmount();
  });

  it('个人中心路由渲染 ProfileView，不加载体系详情', async () => {
    const router = createAppRouter(createMemoryHistory());
    await router.push('/profile');
    await router.isReady();
    const wrapper = render(router);
    await settle();

    expect(router.currentRoute.value.name).toBe('profile');
    expect(wrapper.findComponent({ name: 'ProfileView' }).exists()).toBe(true);
    expect(wrapper.findComponent({ name: 'SystemDetailView' }).exists()).toBe(false);
    expect(apiMock.getVersionDetail).not.toHaveBeenCalled();
    expect(apiMock.getWorkspace).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
