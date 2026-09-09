import { defineComponent } from 'vue';
import { createRouter, createWebHistory, createMemoryHistory, type RouteLocationRaw, type Router, type RouterHistory } from 'vue-router';

const RouteOutlet = defineComponent({ name: 'RouteOutlet', render: () => null });

export function createAppRouter(history?: RouterHistory): Router {
  return createRouter({
    history: history ?? (typeof window === 'undefined' ? createMemoryHistory() : createWebHistory(import.meta.env.BASE_URL)),
    routes: [
      { path: '/', redirect: { name: 'systems' } },
      { path: '/systems', name: 'systems', component: RouteOutlet },
      { path: '/semantic-libraries', name: 'semantic', component: RouteOutlet },
      { path: '/systems/:versionId', name: 'system-detail', component: RouteOutlet },
      { path: '/systems/:versionId/indicators/:indicatorId', name: 'indicator-workspace', component: RouteOutlet },
      { path: '/model-management', name: 'models', component: RouteOutlet, meta: { requiresAdmin: true } },
      { path: '/mail-settings', name: 'mail', component: RouteOutlet, meta: { requiresAdmin: true } },
      { path: '/users', name: 'users', component: RouteOutlet, meta: { requiresAdmin: true } },
      { path: '/profile', name: 'profile', component: RouteOutlet },
      { path: '/:pathMatch(.*)*', redirect: '/systems' },
    ],
  });
}

export type LeaveDecision = 'save' | 'discard' | 'stay';

export interface NavigationGuardContext {
  canNavigate?: () => boolean;
  isAdmin: () => boolean;
  isWorkspaceDirty: () => boolean;
  confirmLeaveWorkspace: () => Promise<LeaveDecision>;
  saveAndContinue: (target: RouteLocationRaw) => void;
  discardWorkspaceChanges: () => void;
}

export function installNavigationGuard(router: Router, context: NavigationGuardContext): () => void {
  return router.beforeEach(async (to, from) => {
    if (from.fullPath !== to.fullPath && context.canNavigate?.() === false) return false;
    if (to.meta.requiresAdmin && !context.isAdmin()) return { name: 'systems' };
    if (!context.isWorkspaceDirty() || from.fullPath === to.fullPath) return true;
    const decision = await context.confirmLeaveWorkspace();
    if (decision === 'stay') return false;
    if (decision === 'save') {
      context.saveAndContinue(to);
      return false;
    }
    context.discardWorkspaceChanges();
    return true;
  });
}

export const router = createAppRouter();
