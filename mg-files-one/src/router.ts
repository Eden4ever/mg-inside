import { createRouter, createWebHistory } from 'vue-router';
import { applyApplicationDocument } from '@mg-inside/frontend';
import { application } from './application';
import { pageComponents, assets } from './registry';
import { desktop, canLeave } from './desktop';
import { dialogs } from './dialogs';
export const router = createRouter({ history: createWebHistory(import.meta.env.BASE_URL), routes: [
  { path: '/', redirect: application.defaultPath }, ...application.pages.map(page => ({ path: page.path, component: pageComponents[page.component], meta: { title: page.title } })),
  { path: '/my-files/:folderId', component: pageComponents.files, meta: { title: '我的文件' } },
  ...dialogs.definitions.map(dialog => ({ path: dialog.path, component: { render: () => null }, meta: { title: dialog.title } })),
  { path: '/:pathMatch(.*)*', redirect: application.defaultPath },
] });
router.beforeEach(async (to, from) => { if (to.path !== from.path && !(await canLeave())) return false; if (!dialogs.isDialogWindow && dialogs.definitions.some(d => d.path === to.path)) return application.defaultPath; });
router.afterEach(to => { applyApplicationDocument(application, assets, String(to.meta.title || application.name)); desktop.setTitle(String(to.meta.title || application.name)); desktop.routeChanged(to.fullPath); });
desktop.configure({ onNavigate: async path => { await router.push(path); }, onClose: canLeave });

