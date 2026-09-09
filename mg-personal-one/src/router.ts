import { createRouter, createWebHistory } from 'vue-router';
import { desktop, canLeave } from './desktop';
import { application } from './application';
import { applyApplicationDocument } from '@mg-inside/frontend';
import { pageComponents, assets } from './registry';
export const router = createRouter({ history: createWebHistory(import.meta.env.BASE_URL), routes: [
  ...(!application.pages.some(page => page.path === '/') ? [{ path: '/', redirect: application.defaultPath }] : []),
  ...application.pages.map(page => ({ path: page.path, component: pageComponents[page.component], meta: { title: page.title } })),
  { path: '/:pathMatch(.*)*', redirect: application.defaultPath },
] });
router.afterEach(to => { const title = String(to.meta.title || application.name); applyApplicationDocument(application, assets, title); desktop.setTitle(title); desktop.routeChanged(to.fullPath); });
desktop.configure({ onNavigate: async path => { await router.push(path); }, onClose: canLeave });
