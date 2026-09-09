import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { DesktopApp } from '../../../../mg-platform/packages/frontend/desktop-contracts/src/index';

export class ApplicationInputError extends Error { constructor(message: string, public status = 400) { super(message); } }
export function externalApplication(input: unknown, protectedOrigins: string[]): Pick<DesktopApp, 'name' | 'description' | 'entryUrl' | 'icon'> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ApplicationInputError('应用配置无效');
  const value = input as Record<string, unknown>;
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 80) throw new ApplicationInputError('应用名称应为 1 至 80 个字符');
  if (typeof value.url !== 'string' || value.url.length > 4096) throw new ApplicationInputError('应用地址无效');
  let url: URL; try { url = new URL(value.url); } catch { throw new ApplicationInputError('请输入完整的 HTTP 或 HTTPS 地址'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new ApplicationInputError('应用地址不支持此协议或内嵌账号密码');
  // Cookie 按主机隔离而非端口。平台主机不作为用户外链，避免外链获得平台会话上下文。
  if (protectedOrigins.some(origin => { const host = new URL(origin).hostname; return url.hostname === host || url.hostname.endsWith(`.${host}`); })) throw new ApplicationInputError('平台应用请使用已有入口，不能作为外链重复添加');
  if (value.description !== undefined && (typeof value.description !== 'string' || value.description.length > 200)) throw new ApplicationInputError('应用说明不能超过 200 个字符');
  if (value.icon !== undefined && !['knowledge', 'token', 'identity', 'personal'].includes(String(value.icon))) throw new ApplicationInputError('应用图标无效');
  return { name: value.name.trim(), description: (value.description as string || '').trim(), entryUrl: url.href, icon: (value.icon || 'knowledge') as DesktopApp['icon'] };
}
export function createApplicationStore(directory: string, protectedOrigins: string[]) {
  const pending = new Map<string, Promise<unknown>>();
  const fileFor = (user: string) => resolve(directory, createHash('sha256').update(user).digest('hex') + '.json');
  async function read(user: string): Promise<DesktopApp[]> {
    try { return JSON.parse(await readFile(fileFor(user), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  }
  async function change(user: string, update: (items: DesktopApp[]) => DesktopApp[]) {
    const task = (pending.get(user) || Promise.resolve()).catch(() => {}).then(async () => {
      const items = update(await read(user)); await mkdir(directory, { recursive: true });
      const target = fileFor(user), temporary = `${target}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(items), { mode: 0o600 }); await rename(temporary, target); return items;
    });
    pending.set(user, task); try { return await task; } finally { if (pending.get(user) === task) pending.delete(user); }
  }
  return {
    async list(user: string) { await pending.get(user); return read(user); },
    async save(user: string, input: unknown, id?: string) {
      const value = externalApplication(input, protectedOrigins), appId = id || `external-${randomUUID()}`;
      const items = await change(user, items => {
        if (id && !items.some(item => item.id === id)) throw new ApplicationInputError('外链应用不存在', 404);
        if (!id && items.length >= 32) throw new ApplicationInputError('最多可添加 32 个外链应用');
        const app: DesktopApp = { ...value, id: appId, kind: 'external', defaultPath: '/', allowedPaths: ['/'], minWidth: 640, minHeight: 480 };
        return id ? items.map(item => item.id === id ? app : item) : [...items, app];
      }); return items.find(item => item.id === appId)!;
    },
    async remove(user: string, id: string) { await change(user, items => { if (!items.some(item => item.id === id)) throw new ApplicationInputError('外链应用不存在', 404); return items.filter(item => item.id !== id); }); },
  };
}
