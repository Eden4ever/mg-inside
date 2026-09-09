import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm, open } from 'node:fs/promises';
import { join } from 'node:path';
import { createWriteStream } from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';

export class FilesError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } }
export interface Entry { id: string; ownerId: string; parentId: string | null; name: string; kind: 'file' | 'folder'; protected?: 'root' | 'desktop'; size: number; mimeType: string; preview: 'image' | 'text' | 'pdf' | 'none'; storageKey?: string; version: number; favorite: boolean; createdAt: string; updatedAt: string; accessedAt?: string; officeAccessedAt?: string; deletedAt?: string; trashRootId?: string }
type State = { schemaVersion: 1; entries: Entry[] };
export function validName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 180 || /[\\/\u0000-\u001f\u007f<>:"|?*]/.test(value) || ['.', '..'].includes(value.trim()) || /[. ]$/.test(value)) throw new FilesError(400, '名称必须为 1～180 个字符，且不能包含路径、控制字符或特殊文件符号');
  return value.trim();
}
export class FilesStore {
  dir: string; maxFile: number; quota: number; state: State = { schemaVersion: 1, entries: [] }; tail: Promise<unknown> = Promise.resolve(); reserved = new Map<string, number>();
  constructor(dir: string, maxFile = 50 * 1024 ** 2, quota = 1024 ** 3) { this.dir = dir; this.maxFile = maxFile; this.quota = quota; }
  async initialize() { await mkdir(join(this.dir, 'objects'), { recursive: true }); try { const value = JSON.parse(await readFile(join(this.dir, 'metadata.json'), 'utf8')); if (value.schemaVersion !== 1 || !Array.isArray(value.entries)) throw new Error('文件元数据格式无效'); this.state = value; } catch (error: any) { if (error.code !== 'ENOENT') throw error; } }
  async transaction<T>(fn: () => T | Promise<T>): Promise<T> {
    const pending = this.tail.then(async () => { const before = structuredClone(this.state); try { const result = await fn(); const temp = join(this.dir, `metadata-${randomUUID()}.tmp`); try { await writeFile(temp, JSON.stringify(this.state), { flag: 'wx' }); await rename(temp, join(this.dir, 'metadata.json')); } finally { await rm(temp, { force: true }); } return result; } catch (error) { this.state = before; throw error; } }); this.tail = pending.catch(() => {}); return pending;
  }
  owned(owner: string) { return this.state.entries.filter(entry => entry.ownerId === owner); }
  get(owner: string, id: string, includeDeleted = false) { const entry = this.state.entries.find(item => item.id === id && item.ownerId === owner && (includeDeleted || !item.deletedAt)); if (!entry) throw new FilesError(404, '文件或文件夹不存在'); return entry; }
  folder(owner: string, id: string) { const entry = this.get(owner, id); if (entry.kind !== 'folder') throw new FilesError(400, '目标必须是文件夹'); return entry; }
  root(owner: string) { return this.owned(owner).find(item => item.protected === 'root')!; }
  desktop(owner: string) { return this.owned(owner).find(item => item.protected === 'desktop')!; }
  public(entry: Entry) { const { ownerId, storageKey, ...data } = entry; return structuredClone(data); }
  async ensureOwner(owner: string) { if (this.root(owner)) return; await this.transaction(() => { if (this.root(owner)) return; const root = this.newEntry(owner, null, '我的文件', 'folder'); root.protected = 'root'; const desktop = this.newEntry(owner, root.id, '桌面', 'folder'); desktop.protected = 'desktop'; }); }
  newEntry(owner: string, parentId: string | null, name: string, kind: 'file' | 'folder') { const now = new Date().toISOString(); const entry: Entry = { id: randomUUID(), ownerId: owner, parentId, name, kind, size: 0, mimeType: '', preview: 'none', version: 1, favorite: false, createdAt: now, updatedAt: now }; this.state.entries.push(entry); return entry; }
  usage(owner: string) { return this.owned(owner).reduce((sum, entry) => sum + entry.size, 0); }
  unique(owner: string, parent: string | null, name: string, except?: string, keepBoth = false) { let candidate = name, index = 2; while (this.owned(owner).some(e => !e.deletedAt && e.parentId === parent && e.id !== except && e.name.toLocaleLowerCase() === candidate.toLocaleLowerCase())) { if (!keepBoth) throw new FilesError(409, '目标位置已有同名条目，请使用其他名称'); const dot = name.lastIndexOf('.'); candidate = dot > 0 ? `${name.slice(0, dot)} (${index++})${name.slice(dot)}` : `${name} (${index++})`; if (candidate.length > 180) throw new FilesError(409, '同名文件过多，请缩短文件名后重试'); } return candidate; }
  touch(entry: Entry) { entry.version++; entry.updatedAt = new Date().toISOString(); }
  mutable(entry: Entry, version?: unknown) { if (entry.protected) throw new FilesError(403, '系统文件夹不可重命名、移动或删除'); if (version !== undefined && version !== entry.version) throw new FilesError(409, '条目已更新，请刷新后重试'); }
  breadcrumbs(owner: string, id: string) { const result: ReturnType<FilesStore['public']>[] = []; let item: Entry | undefined = this.get(owner, id); while (item) { result.unshift(this.public(item)); item = item.parentId ? this.get(owner, item.parentId) : undefined; } return result; }
  list(owner: string, query: URLSearchParams) {
    const view = query.get('view') || 'files'; if (!['files', 'favorites', 'recent', 'trash'].includes(view)) throw new FilesError(400, '视图无效');
    const parent = query.get('parentId') === 'desktop' ? this.desktop(owner) : this.folder(owner, query.get('parentId') || this.root(owner).id);
    let items = this.owned(owner).filter(item => item.protected !== 'root');
    if (view === 'trash') items = items.filter(item => item.deletedAt && item.trashRootId === item.id);
    else { items = items.filter(item => !item.deletedAt); if (view === 'files') items = items.filter(item => item.parentId === parent.id); if (view === 'favorites') items = items.filter(item => item.favorite); if (view === 'recent') items = items.filter(item => item.kind === 'file' && item.accessedAt); }
    const search = (query.get('search') || '').trim().toLocaleLowerCase(); if (search) items = items.filter(item => item.name.toLocaleLowerCase().includes(search));
    const sort = query.get('sort') || (view === 'recent' ? 'accessedAt' : 'name'); if (!['name', 'size', 'updatedAt', 'accessedAt'].includes(sort)) throw new FilesError(400, '排序字段无效');
    const direction = query.get('direction') === 'desc' ? -1 : 1;
    items.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'folder' ? -1 : 1) || direction * (sort === 'size' ? a.size - b.size : String(a[sort as keyof Entry] || '').localeCompare(String(b[sort as keyof Entry] || ''), 'zh-CN')) || a.id.localeCompare(b.id));
    const page = Math.max(1, Number(query.get('page')) || 1), pageSize = Math.min(200, Math.max(1, Number(query.get('pageSize')) || 100));
    return { items: items.slice((page - 1) * pageSize, page * pageSize).map(item => this.public(item)), total: items.length, parentId: parent.id, rootId: this.root(owner).id, desktopFolderId: this.desktop(owner).id, breadcrumbs: view === 'files' ? this.breadcrumbs(owner, parent.id) : [], quota: { used: this.usage(owner), limit: this.quota, maxFile: this.maxFile } };
  }
  async createFolder(owner: string, parentId: string, name: unknown) { return this.transaction(() => { this.folder(owner, parentId); return this.public(this.newEntry(owner, parentId, this.unique(owner, parentId, validName(name)), 'folder')); }); }
  async patch(owner: string, id: string, input: { name?: unknown; favorite?: unknown; version?: unknown }) { return this.transaction(() => { const entry = this.get(owner, id); if (input.version !== undefined && entry.version !== input.version) throw new FilesError(409, '条目已更新，请刷新后重试'); if (input.name !== undefined) { this.mutable(entry); entry.name = this.unique(owner, entry.parentId, validName(input.name), id); } if (input.favorite !== undefined) { if (typeof input.favorite !== 'boolean') throw new FilesError(400, '收藏状态无效'); entry.favorite = input.favorite; } this.touch(entry); return this.public(entry); }); }
  async move(owner: string, id: string, parentId: string, version?: unknown) { return this.transaction(() => { const entry = this.get(owner, id); this.mutable(entry, version); let target: Entry | undefined = this.folder(owner, parentId); while (target) { if (target.id === id) throw new FilesError(400, '不能移动到自身或子文件夹'); target = target.parentId ? this.get(owner, target.parentId) : undefined; } this.unique(owner, parentId, entry.name, id); entry.parentId = parentId; this.touch(entry); return this.public(entry); }); }
  async remove(owner: string, id: string, version?: unknown) { return this.transaction(() => { const entry = this.get(owner, id); this.mutable(entry, version); const ids = new Set([id]); let more = true; while (more) { more = false; for (const e of this.owned(owner)) if (!e.deletedAt && e.parentId && ids.has(e.parentId) && !ids.has(e.id)) { ids.add(e.id); more = true; } } const now = new Date().toISOString(); for (const e of this.owned(owner)) if (ids.has(e.id)) { e.deletedAt = now; e.trashRootId = id; this.touch(e); } return { ok: true }; }); }
  async restore(owner: string, id: string, version?: unknown) { return this.transaction(() => { const root = this.get(owner, id, true); this.mutable(root, version); if (!root.deletedAt || root.trashRootId !== id) throw new FilesError(400, '请选择回收站中的条目'); const parent = this.owned(owner).find(e => e.id === root.parentId && !e.deletedAt && e.kind === 'folder') || this.root(owner); root.parentId = parent.id; root.name = this.unique(owner, parent.id, root.name, id, true); for (const e of this.owned(owner)) if (e.trashRootId === id) { delete e.deletedAt; delete e.trashRootId; this.touch(e); } return this.public(root); }); }
  async permanent(owner: string, id: string, version?: unknown) { const keys = await this.transaction(() => { const root = this.get(owner, id, true); this.mutable(root, version); if (!root.deletedAt || root.trashRootId !== id) throw new FilesError(400, '只能永久删除回收站条目'); const entries = this.owned(owner).filter(e => e.trashRootId === id); const ids = new Set(entries.map(e => e.id)); this.state.entries = this.state.entries.filter(e => !ids.has(e.id)); return entries.flatMap(e => e.storageKey ? [e.storageKey] : []); }); await Promise.all(keys.map(key => rm(join(this.dir, 'objects', key), { force: true }))); return { ok: true }; }
  async access(owner: string, id: string, office = false) { return this.transaction(() => { const entry = this.get(owner, id); entry.accessedAt = new Date().toISOString(); if (office) entry.officeAccessedAt = entry.accessedAt; return { ok: true }; }); }
  async replaceContent(owner: string, id: string, version: number, data: Buffer) {
    if (data.length > this.maxFile) throw new FilesError(413, '文件超过单文件大小限制');
    const key = randomUUID(), path = join(this.dir, 'objects', key); let previous: string | undefined;
    try {
      const result = await this.transaction(async () => {
        const entry = this.get(owner, id); this.mutable(entry, version);
        if (entry.kind !== 'file') throw new FilesError(400, '只能编辑文件');
        if (this.usage(owner) - entry.size + data.length + (this.reserved.get(owner) || 0) > this.quota) throw new FilesError(413, '个人空间配额不足');
        await writeFile(path, data, { flag: 'wx' }); previous = entry.storageKey;
        entry.storageKey = key; entry.size = data.length; this.touch(entry); return this.public(entry);
      });
      // 元数据提交成功后才回收旧对象。清理失败不伪装成保存失败。
      if (previous) await rm(join(this.dir, 'objects', previous), { force: true }).catch(() => {});
      return result;
    } catch (error) { await rm(path, { force: true }); throw error; }
  }
  async upload(owner: string, parentId: string, inputName: unknown, length: number, input: Readable) {
    const name = validName(inputName); if (!Number.isSafeInteger(length) || length < 0) throw new FilesError(411, '上传必须提供有效文件长度'); if (length > this.maxFile) throw new FilesError(413, '文件超过单文件大小限制');
    // 预留只是进程内排队状态，不写元数据；避免磁盘失败时预留量无法释放。
    const reservation = this.tail.then(() => { this.folder(owner, parentId); const reserved = this.reserved.get(owner) || 0; if (this.usage(owner) + reserved + length > this.quota) throw new FilesError(413, '个人空间配额不足，请清理回收站后重试'); this.reserved.set(owner, reserved + length); });
    this.tail = reservation.catch(() => {}); await reservation;
    const key = randomUUID(), path = join(this.dir, 'objects', key); let bytes = 0;
    try {
      await pipeline(input, new Transform({ transform(chunk, _, callback) { bytes += chunk.length; callback(bytes > length ? new FilesError(413, '上传内容超过声明长度') : null, chunk); } }), createWriteStream(path, { flags: 'wx' }));
      if (bytes !== length) throw new FilesError(400, '文件上传不完整，请重试');
      const handle = await open(path, 'r'); const head = Buffer.alloc(512); let read = 0; try { read = (await handle.read(head, 0, 512, 0)).bytesRead; } finally { await handle.close(); }
      const type = sniff(name, head.subarray(0, read));
      return await this.transaction(() => { this.folder(owner, parentId); const entry = this.newEntry(owner, parentId, this.unique(owner, parentId, name, undefined, true), 'file'); Object.assign(entry, { size: bytes, storageKey: key, ...type }); return this.public(entry); });
    } catch (error) { await rm(path, { force: true }); throw error; }
    finally { this.reserved.set(owner, Math.max(0, (this.reserved.get(owner) || 0) - length)); }
  }
}
function sniff(name: string, head: Buffer): Pick<Entry, 'mimeType' | 'preview'> {
  if (/\.(html?|svg|xml|xhtml)$/i.test(name)) return { mimeType: 'application/octet-stream', preview: 'none' };
  if (head.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return { mimeType: 'image/png', preview: 'image' };
  if (head[0] === 255 && head[1] === 216 && head[2] === 255) return { mimeType: 'image/jpeg', preview: 'image' };
  if (['GIF87a','GIF89a'].includes(head.subarray(0,6).toString())) return { mimeType: 'image/gif', preview: 'image' };
  if (head.subarray(0,4).toString() === 'RIFF' && head.subarray(8,12).toString() === 'WEBP') return { mimeType: 'image/webp', preview: 'image' };
  if (head.subarray(0,5).toString() === '%PDF-') return { mimeType: 'application/pdf', preview: 'pdf' };
  if (/\.(txt|md|csv|json|log|yaml|yml|ini|toml)$/i.test(name) && !head.includes(0)) return { mimeType: 'text/plain; charset=utf-8', preview: 'text' };
  return { mimeType: 'application/octet-stream', preview: 'none' };
}

