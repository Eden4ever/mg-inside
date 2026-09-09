import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNotificationStore } from './notifications';
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function setup() { const directory = await mkdtemp(join(tmpdir(), 'mg-notifications-')); directories.push(directory); return { directory, store: createNotificationStore(directory) }; }
test('通知按用户隔离，并在重新创建存储后保留', async () => {
  const { store, directory } = await setup();
  await store.add('one', { text: '任务完成', appId: 'knowledge', appName: '知识库' });
  expect(await store.list('two')).toEqual([]);
  expect(await createNotificationStore(directory).list('one')).toMatchObject([{ text: '任务完成', read: false }]);
});
test('并发通知不会丢失，已读和删除仅影响指定项', async () => {
  const { store } = await setup();
  await Promise.all(Array.from({ length: 8 }, (_, index) => store.add('one', { text: String(index), appId: '', appName: '桌面' })));
  const items = await store.list('one'); expect(items).toHaveLength(8);
  await store.markRead('one', items[0]!.id);
  expect((await store.list('one')).filter(item => item.read)).toHaveLength(1);
  await store.remove('one', items[0]!.id); expect(await store.list('one')).toHaveLength(7);
  await store.markRead('one'); expect((await store.list('one')).every(item => item.read)).toBe(true);
  await store.remove('one'); expect(await store.list('one')).toEqual([]);
});
