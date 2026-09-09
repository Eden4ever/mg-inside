import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

export interface Notification { id: string; text: string; appId: string; appName: string; createdAt: string; read: boolean; }
export function createNotificationStore(directory: string) {
  const pending = new Map<string, Promise<unknown>>();
  function fileFor(user: string) { return resolve(directory, createHash('sha256').update(user).digest('hex') + '.json'); }
  async function read(user: string): Promise<Notification[]> {
    try { return JSON.parse(await readFile(fileFor(user), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  }
  async function change(user: string, update: (items: Notification[]) => Notification[]) {
    const task = (pending.get(user) || Promise.resolve()).catch(() => {}).then(async () => {
      const items = update(await read(user));
      await mkdir(directory, { recursive: true });
      const target = fileFor(user), temporary = `${target}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(items), { mode: 0o600 }); await rename(temporary, target);
      return items;
    });
    pending.set(user, task);
    try { return await task; } finally { if (pending.get(user) === task) pending.delete(user); }
  }
  return {
    async list(user: string) { await pending.get(user); return read(user); },
    add(user: string, value: Pick<Notification, 'text' | 'appId' | 'appName'>) {
      return change(user, items => [{ ...value, id: randomUUID(), createdAt: new Date().toISOString(), read: false }, ...items].slice(0, 100));
    },
    markRead(user: string, id?: string) { return change(user, items => items.map(item => !id || item.id === id ? { ...item, read: true } : item)); },
    remove(user: string, id?: string) { return change(user, items => id ? items.filter(item => item.id !== id) : []); },
  };
}
