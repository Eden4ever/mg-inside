import { createMemoryHistory } from 'vue-router';
import { describe, expect, it, vi } from 'vitest';
import { createAppRouter, installNavigationGuard, type LeaveDecision, type NavigationGuardContext } from '@/router';

function guardContext(overrides: Partial<NavigationGuardContext> = {}): NavigationGuardContext {
  return {
    isAdmin: () => true,
    isWorkspaceDirty: () => false,
    confirmLeaveWorkspace: vi.fn(async (): Promise<LeaveDecision> => 'discard'),
    saveAndContinue: vi.fn(),
    discardWorkspaceChanges: vi.fn(),
    ...overrides,
  };
}

async function enterWorkspace(router: ReturnType<typeof createAppRouter>) {
  await router.push('/systems/version-1/indicators/indicator-1');
  await router.isReady();
}

describe('后台路由契约', () => {
  it('根路径和未知路径都进入指标体系列表', async () => {
    const router = createAppRouter(createMemoryHistory());
    await router.push('/');
    expect(router.currentRoute.value.name).toBe('systems');
    await router.push('/unknown-page');
    expect(router.currentRoute.value.name).toBe('systems');
  });

  it('解析体系和三级指标深链接', async () => {
    const router = createAppRouter(createMemoryHistory('/knowledge-base-inside/'));
    await router.push('/systems/version-2026/indicators/indicator-9');
    expect(router.currentRoute.value.name).toBe('indicator-workspace');
    expect(router.currentRoute.value.params).toMatchObject({ versionId: 'version-2026', indicatorId: 'indicator-9' });
  });

  it('非管理员不能进入用户管理', async () => {
    const router = createAppRouter(createMemoryHistory());
    installNavigationGuard(router, guardContext({ isAdmin: () => false }));
    await router.push('/users');
    expect(router.currentRoute.value.name).toBe('systems');
  });
});

describe('未保存内容导航守卫', () => {
  it('创建对话框或请求未完成时拦截导航，完成后可正常离开', async () => {
    const router=createAppRouter(createMemoryHistory());
    await router.push('/systems');
    let allowed=false;
    installNavigationGuard(router,guardContext({canNavigate:()=>allowed}));
    await router.push({name:'semantic'});expect(router.currentRoute.value.name).toBe('systems');
    allowed=true;await router.push({name:'semantic'});expect(router.currentRoute.value.name).toBe('semantic');
  });
  it('选择留下时阻止浏览器导航', async () => {
    const router = createAppRouter(createMemoryHistory());
    const context = guardContext({
      isWorkspaceDirty: () => true,
      confirmLeaveWorkspace: vi.fn(async (): Promise<LeaveDecision> => 'stay'),
    });
    await enterWorkspace(router);
    installNavigationGuard(router, context);
    await router.push('/systems');
    expect(router.currentRoute.value.name).toBe('indicator-workspace');
    expect(context.discardWorkspaceChanges).not.toHaveBeenCalled();
  });

  it('选择放弃修改时允许导航并丢弃草稿', async () => {
    const router = createAppRouter(createMemoryHistory());
    const context = guardContext({
      isWorkspaceDirty: () => true,
      confirmLeaveWorkspace: vi.fn(async (): Promise<LeaveDecision> => 'discard'),
    });
    await enterWorkspace(router);
    installNavigationGuard(router, context);
    await router.push('/systems');
    expect(router.currentRoute.value.name).toBe('systems');
    expect(context.discardWorkspaceChanges).toHaveBeenCalledOnce();
  });

  it('选择保存时先阻止导航，保存成功后由调用方继续', async () => {
    const router = createAppRouter(createMemoryHistory());
    const context = guardContext({
      isWorkspaceDirty: () => true,
      confirmLeaveWorkspace: vi.fn(async (): Promise<LeaveDecision> => 'save'),
    });
    await enterWorkspace(router);
    installNavigationGuard(router, context);
    await router.push('/users');
    expect(router.currentRoute.value.name).toBe('indicator-workspace');
    expect(context.saveAndContinue).toHaveBeenCalledWith(expect.objectContaining({ name: 'users' }));
  });
});
