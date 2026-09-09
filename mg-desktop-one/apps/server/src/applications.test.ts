import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplicationStore, externalApplication } from './applications';
import { essentialApplicationIds, registry } from './config';

describe('应用授权和个人外链边界', () => {
  it('只有明确的基础入口豁免，Token 三个应用独立授权', () => {
    expect([...essentialApplicationIds].sort()).toEqual(['files', 'personal-center']);
    expect(registry.find(app => app.id === 'files')?.kind).toBe('default');
    expect(registry.find(app => app.id === 'personal-center')?.kind).toBe('default');
    expect(registry.find(app => app.id === 'app-manager')?.kind).toBe('system');
    for (const id of ['token-one', 'token-one-console', 'token-one-docs', 'identity']) {
      const app = registry.find(app => app.id === id)!;
      expect(app.authorizationAppId || app.id).toBe(id); expect(essentialApplicationIds.has(id)).toBe(false);
    }
  });
  it('拒绝危险地址和平台会话主机，保留正常外链查询及锚点', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,a', 'file:///a', 'https://user:pass@example.com', 'https://desktop.example.com:8888/', 'https://a.desktop.example.com/']) {
      expect(() => externalApplication({ name: '测试', url }, ['https://desktop.example.com'])).toThrow();
    }
    expect(externalApplication({ name: '测试', url: 'https://docs.example.com/a?q=b#intro' }, ['https://desktop.example.com']).entryUrl).toBe('https://docs.example.com/a?q=b#intro');
  });
  it('用户隔离、并发新增不覆盖、不能改删他人的应用', async () => {
    const store = createApplicationStore(await mkdtemp(join(tmpdir(), 'mg-applications-')), ['https://desktop.example.com']);
    const [a, b] = await Promise.all(['一', '二'].map(name => store.save('alice', { name, url: 'https://example.com' })));
    expect(await store.list('alice')).toHaveLength(2); expect(await store.list('bob')).toEqual([]);
    await expect(store.save('bob', { name: '越权', url: 'https://example.com' }, a.id)).rejects.toThrow('不存在');
    await expect(store.remove('bob', a.id)).rejects.toThrow('不存在');
    await store.save('alice', { name: '已修改', url: 'https://example.com/new' }, a.id);
    await store.remove('alice', b.id); expect((await store.list('alice'))[0]?.name).toBe('已修改');
  });
});
