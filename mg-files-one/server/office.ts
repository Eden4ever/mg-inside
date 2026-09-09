import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { FilesStore, FilesError } from './store.ts';

export const officeFormats: Record<string, { type: string; editable: boolean }> = {
  docx: { type: 'word', editable: true }, xlsx: { type: 'cell', editable: true }, pptx: { type: 'slide', editable: true },
  doc: { type: 'word', editable: false }, xls: { type: 'cell', editable: false }, ppt: { type: 'slide', editable: false },
};
export const officeFormat = (name: string) => officeFormats[name.split('.').at(-1)?.toLowerCase() || ''];
type Session = { id: string; owner: string; fileId: string; version: number; key: string; mode: 'edit' | 'view'; expires: number; savedAt?: string; lastDigest?: string; closed?: boolean; error?: string; savedRequests?: string[] };
export interface OfficeOptions { secret: string; publicUrl: string; internalUrl: string; callbackBase: string; }
export function officeOptions(): OfficeOptions | undefined {
  if (!process.env.OFFICE_DOCUMENT_SERVER_URL) return;
  const options = { secret: process.env.OFFICE_JWT_SECRET || '', publicUrl: process.env.OFFICE_DOCUMENT_SERVER_URL, internalUrl: process.env.OFFICE_DOCUMENT_SERVER_INTERNAL_URL || process.env.OFFICE_DOCUMENT_SERVER_URL, callbackBase: process.env.OFFICE_CALLBACK_BASE || '' };
  if (options.secret.length < 32) throw new Error('Office JWT 密钥至少为 32 个字符');
  for (const value of [options.publicUrl, options.internalUrl, options.callbackBase]) {
    const u = new URL(value); if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw new Error('Office 服务地址无效');
  }
  return options;
}
export function signOffice(payload: object, secret: string) {
  const content = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
  return `${content}.${createHmac('sha256', secret).update(content).digest('base64url')}`;
}
export function verifyOffice(token: unknown, secret: string): any {
  try {
    if (typeof token !== 'string' || token.length > 65536) throw 0;
    const [head, body, signature, extra] = token.split('.'); if (extra || !head || !body || !signature) throw 0;
    const header = JSON.parse(Buffer.from(head, 'base64url').toString()); if (header.alg !== 'HS256') throw 0;
    const expected = createHmac('sha256', secret).update(`${head}.${body}`).digest(), actual = Buffer.from(signature, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(expected, actual)) throw 0;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.exp !== undefined && (typeof payload.exp !== 'number' || payload.exp <= Date.now()/1000)) throw 0;
    return payload;
  } catch { throw new FilesError(403, 'Office 签名无效或已过期'); }
}
export async function officeJson(req: IncomingMessage) {
  let bytes = 0; const chunks: Buffer[] = [];
  for await (const chunk of req) { bytes += chunk.length; if (bytes > 128 * 1024) throw new FilesError(413, 'Office 请求过大'); chunks.push(Buffer.from(chunk)); }
  try { const result = JSON.parse(Buffer.concat(chunks).toString() || '{}'); if (!result || typeof result !== 'object' || Array.isArray(result)) throw 0; return result; } catch { throw new FilesError(400, 'Office 请求格式无效'); }
}
export class OfficeService {
  sessions = new Map<string, Session>();
  tail: Promise<unknown> = Promise.resolve();
  constructor(public store: FilesStore, public options?: OfficeOptions) {}
  async initialize() {
    await mkdir(join(this.store.dir, 'office'), { recursive: true });
    try { const sessions = JSON.parse(await readFile(join(this.store.dir, 'office', 'sessions.json'), 'utf8')); for (const session of sessions) if (session.expires > Date.now()) this.sessions.set(session.id, session); } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
  }
  private settings() { if (!this.options) throw new FilesError(503, 'Office 编辑服务尚未配置'); return this.options; }
  private session(id: string) { const session = this.sessions.get(id); if (!session || session.expires <= Date.now()) throw new FilesError(410, '编辑会话已过期，请重新打开文件'); return session; }
  private async persist() { const path = join(this.store.dir, 'office', 'sessions.json'), temp = `${path}.${randomUUID()}.tmp`; await writeFile(temp, JSON.stringify([...this.sessions.values()].filter(s => s.expires > Date.now())), { mode: 0o600 }); await rename(temp, path); }
  private run<T>(fn: () => Promise<T>) { const pending = this.tail.then(fn); this.tail = pending.catch(() => {}); return pending; }
  async open(owner: string, fileId: string, name: string, requested: unknown) {
    const options = this.settings(), file = this.store.get(owner, fileId), format = officeFormat(file.name);
    if (file.kind !== 'file' || !format) throw new FilesError(415, '请选择 Word、Excel 或 PowerPoint 文件');
    if (!['edit', 'view', undefined].includes(requested as any)) throw new FilesError(400, '打开模式无效');
    const mode = format.editable && requested !== 'view' ? 'edit' : 'view';
    return this.run(async () => {
      // 同一用户同一文件共用编辑 key，避免多窗口各自保存覆盖。
      let session = [...this.sessions.values()].find(s => s.owner === owner && s.fileId === fileId && s.version === file.version && !s.closed && s.expires > Date.now() && s.mode === mode);
      if (!session) { const id = randomUUID(); session = { id, owner, fileId, version: file.version, key: `office-${id}`, mode, expires: Date.now() + 8 * 60 * 60 * 1000 }; this.sessions.set(id, session); await this.persist(); }
      const base = `${options.callbackBase.replace(/\/$/, '')}/integrations/office/${session.id}`;
      const capability = signOffice({ scope: 'document-read', sid: session.id, key: session.key, exp: Math.floor(session.expires/1000) }, options.secret);
      const config = { documentType: format.type, type: 'desktop', width: '100%', height: '100%', document: { title: file.name, fileType: file.name.split('.').at(-1)!.toLowerCase(), key: session.key, url: `${base}/document?token=${capability}`, permissions: { edit: mode === 'edit', download: true, print: true, review: mode === 'edit' } }, editorConfig: { mode, lang: 'zh-CN', callbackUrl: `${base}/callback`, user: { id: owner, name }, customization: { forcesave: true, autosave: true } } };
      // 打开历史归属文件所有者；记录访问不改变内容版本或修改时间。
      await this.store.access(owner,fileId,true);
      return { sessionId: session.id, file: this.store.public(file), mode, documentServerUrl: options.publicUrl, config: { ...config, token: signOffice(config, options.secret) } };
    });
  }
  status(owner: string, id: string) { const session = this.session(id); if (session.owner !== owner) throw new FilesError(404, '会话不存在'); return { savedAt: session.savedAt, version: session.version, closed: !!session.closed, error: session.error, savedRequests: session.savedRequests || [] }; }
  async save(owner: string, id: string) {
    const session = this.session(id), options = this.settings();
    if (session.owner !== owner) throw new FilesError(404, '会话不存在');
    if (session.mode !== 'edit' || session.closed) throw new FilesError(409, '当前会话不可编辑');
    const requestId = randomUUID(), command = { c: 'forcesave', key: session.key, userdata: requestId };
    const response = await fetch(`${options.internalUrl.replace(/\/$/, '')}/coauthoring/CommandService.ashx`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...command, token: signOffice(command, options.secret) }), redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new FilesError(502, '暂时无法请求保存');
    const result = await response.json() as {error: number};
    if (![0,4].includes(result.error)) throw new FilesError(502, '编辑服务未接受保存请求，请稍后重试');
    return { queued: result.error === 0, unchanged: result.error === 4, requestId };
  }
  async integration(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const match = /^\/integrations\/office\/([0-9a-f-]{36})\/(document|callback)$/.exec(url.pathname); if (!match) return false;
    const options = this.settings(), session = this.session(match[1]);
    if (match[2] === 'document' && req.method === 'GET') {
      const payload = verifyOffice(url.searchParams.get('token'), options.secret);
      if (payload.scope !== 'document-read' || payload.sid !== session.id || payload.key !== session.key) throw new FilesError(403, '文档读取凭据不匹配');
      const file = this.store.get(session.owner, session.fileId); if (file.version !== session.version || !file.storageKey) throw new FilesError(409, '文件已变更，请重新打开');
      res.setHeader('Content-Type', 'application/octet-stream'); res.setHeader('Content-Length', file.size);
      const input = createReadStream(join(this.store.dir, 'objects', file.storageKey)); input.on('error', () => res.destroy()); res.on('close', () => input.destroy()); input.pipe(res); return true;
    }
    if (match[2] !== 'callback' || req.method !== 'POST') throw new FilesError(405, '不支持此操作');
    const body = await officeJson(req);
    const signed = verifyOffice(body.token || req.headers.authorization?.replace(/^Bearer /, ''), options.secret);
    const payload = signed.payload || signed;
    if (payload.key !== session.key || ![1,2,3,4,6,7].includes(payload.status)) throw new FilesError(403, '编辑回调不匹配');
    await this.run(async () => {
      try {
      if (session.closed && payload.status === 2) return; // 已完成保存的重复回调幂等确认。
      if ([2,6].includes(payload.status)) {
        if (session.mode !== 'edit' || session.closed) throw new FilesError(409, '编辑会话已关闭或为只读');
        const download = new URL(payload.url), publicBase = new URL(options.publicUrl), internal = new URL(options.internalUrl);
        const base = download.origin === publicBase.origin ? publicBase : internal;
        const prefix = base.pathname.replace(/\/$/, '');
        const relative = download.pathname.startsWith(prefix + '/') ? download.pathname.slice(prefix.length) : '';
        if (download.origin !== publicBase.origin && download.origin !== internal.origin || download.username || download.password || download.hash || !relative.startsWith('/cache/files/')) throw new FilesError(403, '编辑结果来源无效');
        // 浏览器地址映射到固定服务地址；拒绝重定向，不接收任意下载来源。
        const source = new URL(internal.pathname.replace(/\/$/, '') + relative + download.search, internal.origin);
        const response = await fetch(source, { redirect: 'error', signal: AbortSignal.timeout(30000) });
        if (!response.ok || !response.body) throw new FilesError(502, '暂时无法读取编辑结果');
        const chunks: Uint8Array[] = []; let size = 0;
        for await (const chunk of response.body as any) { size += chunk.length; if (size > this.store.maxFile) throw new FilesError(413, '编辑后的文件超过大小限制'); chunks.push(chunk); }
        const data = Buffer.concat(chunks);
        if (data.length < 4 || data.readUInt32LE(0) !== 0x04034b50) throw new FilesError(415, '编辑结果不是有效的 Office 文件');
        const digest = createHmac('sha256', options.secret).update(data).digest('hex');
        if (session.lastDigest !== digest) { const saved = await this.store.replaceContent(session.owner, session.fileId, session.version, data); session.version = saved.version; session.lastDigest = digest; session.savedAt = new Date().toISOString(); }
        // 只有签名回调且文件已落盘，才确认对应保存请求；重复内容也确认本次请求。
        if (typeof payload.userdata === 'string' && /^[0-9a-f-]{36}$/.test(payload.userdata)) {
          session.savedRequests = [...new Set([...(session.savedRequests || []), payload.userdata])].slice(-32);
        }
        session.error = undefined; if (payload.status === 2) session.closed = true;
      } else if (payload.status === 4) session.closed = true;
      else if ([3,7].includes(payload.status)) session.error = '编辑器报告保存失败，请保留当前窗口并重试';
      await this.persist();
      } catch (error) {
        session.error = error instanceof FilesError ? error.message : '保存回文件失败，请保留当前窗口并重试';
        await this.persist();
        throw error;
      }
    });
    res.setHeader('Content-Type', 'application/json'); res.end('{"error":0}'); return true;
  }
}
