import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { join } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { FilesStore, FilesError } from './store.ts';
import { UnifiedIdentityClient, UnifiedAuthError, bearerToken, type UnifiedIdentity } from './unified-client.ts';
import { OfficeService, officeOptions, officeFormat } from './office.ts';
async function json(req: IncomingMessage) { let text = ''; for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > 16384) throw new FilesError(413, '请求数据过大'); } try { const result = text ? JSON.parse(text) : {}; if (!result || Array.isArray(result) || typeof result !== 'object') throw new Error(); return result; } catch { throw new FilesError(400, '请求格式无效'); } }
function send(res: ServerResponse, data: unknown, status = 200) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); }
export function createFilesServer(store: FilesStore, identity = new UnifiedIdentityClient()) {
  const office = new OfficeService(store, officeOptions());
  const officeReady = office.initialize();
  return createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; sandbox");
    try {
      const url = new URL(req.url || '/', 'http://localhost'); const path = url.pathname;
      if (path === '/health' && req.method === 'GET') return send(res, { ok: true });
      if (path.startsWith('/integrations/office/')) { await officeReady; if (await office.integration(req, res, url)) return; }
      if (!path.startsWith('/api/')) throw new FilesError(404, '接口不存在');
      const user: UnifiedIdentity = await identity.introspect(bearerToken(req.headers.authorization), path.startsWith('/api/office/') ? 'office-one' : 'files');
      if (!['GET', 'HEAD'].includes(req.method || 'GET')) { const csrf = req.headers['x-csrf-token']; const a = Buffer.from(typeof csrf === 'string' ? csrf : ''), b = Buffer.from(user.csrfToken); if (a.length !== b.length || !timingSafeEqual(a, b)) throw new FilesError(403, '安全校验失败，请刷新页面后重试'); }
      await store.ensureOwner(user.sub);
      if (path.startsWith('/api/office/')) {
        await officeReady;
        if (path === '/api/office/status' && req.method === 'GET') return send(res, { configured: !!office.options, engine: 'ONLYOFFICE Docs', maxFileBytes: store.maxFile });
        if (path === '/api/office/documents' && req.method === 'GET') {
          const view=url.searchParams.get('view')||'all';if(!['all','recent'].includes(view))throw new FilesError(400,'文档视图无效');
          return send(res, { items: store.owned(user.sub).filter(e => e.kind === 'file' && !e.deletedAt && officeFormat(e.name) && (view!=='recent'||e.officeAccessedAt)).sort((a,b) => (view==='recent' ? b.officeAccessedAt!.localeCompare(a.officeAccessedAt!) : b.updatedAt.localeCompare(a.updatedAt)) || a.id.localeCompare(b.id)).map(e => ({ ...store.public(e), editable: officeFormat(e.name)!.editable })) });
        }
        if (path === '/api/office/documents' && req.method === 'POST') {
          if (!office.options) throw new FilesError(503, 'Office 编辑服务尚未配置');
          const input = await json(req);
          const templates: Record<string, [string, string]> = { docx: ['document.docx', '未命名文档.docx'], xlsx: ['spreadsheet.xlsx', '未命名表格.xlsx'], pptx: ['presentation.pptx', '未命名演示文稿.pptx'] };
          if (typeof input.format !== 'string' || !Object.hasOwn(templates, input.format)) throw new FilesError(400, '文档类型无效');
          const [template, name] = templates[input.format];
          const data = await readFile(new URL(`./office-templates/${template}`, import.meta.url));
          return send(res, await store.upload(user.sub, store.root(user.sub).id, name, data.length, Readable.from(data)), 201);
        }
        const documentMatch = /^\/api\/office\/documents\/([0-9a-f-]{36})\/open$/.exec(path);
        if (documentMatch && req.method === 'POST') { const input = await json(req); return send(res, await office.open(user.sub, documentMatch[1], user.name, input.mode)); }
        const sessionMatch = /^\/api\/office\/sessions\/([0-9a-f-]{36})$/.exec(path);
        if (sessionMatch && req.method === 'GET') return send(res, office.status(user.sub, sessionMatch[1]));
        const saveMatch = /^\/api\/office\/sessions\/([0-9a-f-]{36})\/save$/.exec(path);
        if (saveMatch && req.method === 'POST') return send(res, await office.save(user.sub, saveMatch[1]));
        throw new FilesError(404, 'Office 接口不存在');
      }
      if (req.method === 'GET' && path === '/api/auth/me') return send(res, { id: user.sub, name: user.name, username: user.username });
      if (req.method === 'GET' && path === '/api/desktop') { const folder = store.desktop(user.sub); return send(res, { folderId: folder.id, trashCount: store.owned(user.sub).filter(e => !!e.deletedAt).length, items: store.owned(user.sub).filter(e => e.parentId === folder.id && !e.deletedAt).map(e => store.public(e)) }); }
      if (req.method === 'GET' && path === '/api/entries') return send(res, store.list(user.sub, url.searchParams));
      if (req.method === 'GET' && path === '/api/folders') return send(res, { items: store.owned(user.sub).filter(e => e.kind === 'folder' && !e.deletedAt).map(e => ({ ...store.public(e), label: store.breadcrumbs(user.sub, e.id).map(p => p.name).join(' / ') })) });
      if (req.method === 'POST' && path === '/api/folders') { const body = await json(req); return send(res, await store.createFolder(user.sub, body.parentId, body.name), 201); }
      if (req.method === 'POST' && path === '/api/uploads') return send(res, await store.upload(user.sub, url.searchParams.get('parentId') || '', url.searchParams.get('name'), Number(req.headers['content-length'] ?? NaN), req), 201);
      const match = /^\/api\/entries\/([0-9a-f-]{36})(?:\/(content|move|restore|access|permanent))?$/.exec(path);
      if (!match) throw new FilesError(404, '接口不存在');
      const [, id, action] = match;
      if (req.method === 'GET' && !action) return send(res, store.public(store.get(user.sub, id)));
      if (req.method === 'GET' && action === 'content') {
        const entry = store.get(user.sub, id); if (entry.kind !== 'file' || !entry.storageKey) throw new FilesError(400, '文件夹不能直接下载');
        res.setHeader('Content-Type', 'application/octet-stream'); res.setHeader('Content-Disposition', `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(entry.name).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())}`); res.setHeader('Content-Length', entry.size);
        const stream = createReadStream(join(store.dir, 'objects', entry.storageKey)); stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res); return;
      }
      const body = await json(req);
      if (req.method === 'PATCH' && !action) return send(res, await store.patch(user.sub, id, body));
      if (req.method === 'POST' && action === 'move') return send(res, await store.move(user.sub, id, body.parentId, body.version));
      if (req.method === 'POST' && action === 'restore') return send(res, await store.restore(user.sub, id, body.version));
      if (req.method === 'POST' && action === 'access') return send(res, await store.access(user.sub, id));
      if (req.method === 'DELETE' && !action) return send(res, await store.remove(user.sub, id, body.version));
      if (req.method === 'DELETE' && action === 'permanent') return send(res, await store.permanent(user.sub, id, body.version));
      throw new FilesError(405, '不支持此操作');
    } catch (error) { if (res.headersSent) { res.destroy(); return; } const known = error instanceof FilesError || error instanceof UnifiedAuthError; send(res, { message: known ? error.message : '文件服务暂时不可用，请稍后重试' }, known ? error.status : 500); }
  });
}

