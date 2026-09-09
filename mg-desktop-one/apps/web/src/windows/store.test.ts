import { beforeEach, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useWindows } from './store';
import type { DesktopApp } from '../../../../../mg-platform/packages/frontend/desktop-contracts/src/index';
const app: DesktopApp = { id: 'app-manager', name: '应用管理', description: '', icon: 'knowledge', entryUrl: 'https://apps.example.com', defaultPath: '/applications', allowedPaths: ['/applications'], minWidth: 760, minHeight: 480 };
beforeEach(() => setActivePinia(createPinia()));
it('注册子窗具有独立层级，不挤占应用单例且不持久化参数', () => {
  const store = useWindows(), parent = store.open(app);
  const child = store.openDialog(parent, { id: 'editor', title: '编辑外链', path: '/applications/editor', width: 560, height: 640 }, 'request-1', { applicationId: 'private-id' });
  expect(child.id).not.toBe(parent.id); expect(store.windows).toHaveLength(2);
  expect(store.open(app).id).toBe(parent.id);
  expect(store.snapshot()).toHaveLength(1); expect(JSON.stringify(store.snapshot())).not.toContain('private-id');
  store.move(child.id, { ...child.rect, x: -100, y: 200 }, app);
  expect(child.rect.x).toBe(-100); expect(child.rect.width).toBe(560);
});
it('恢复按当前视口错开，丢弃重复app和未授权app', () => {
  const store = useWindows(); store.area = { width: 1440, height: 900 };
  const other = { ...app, id: 'other', name: '另一个应用' };
  store.restore([
    { appId: app.id, path: '/applications', mode: 'maximized' },
    { appId: other.id, path: '/applications', mode: 'maximized' },
    { appId: other.id, path: '/applications', mode: 'maximized' },
    { appId: 'denied', path: '/' },
  ], [app, other]);
  expect(store.windows).toHaveLength(2); expect(store.windows.every(win => win.mode === 'normal')).toBe(true);
  expect(store.windows[1]!.rect.y).toBeGreaterThan(store.windows[0]!.rect.y);
});
