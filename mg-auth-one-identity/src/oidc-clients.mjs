import { randomBytes, timingSafeEqual } from 'node:crypto';
import { encryptSecret, decryptSecret } from './security-secrets.js';
import { desktopClientId } from './application-access.js';
import { kernelApplication } from './kernel-applications.js';

export function callbackUris(value, production = process.env.NODE_ENV === 'production') {
  if (!Array.isArray(value) || !value.length || value.length > 8 || new Set(value).size !== value.length) throw new Error('回调地址需要 1 至 8 个且不可重复');
  return value.map(uri => {
    if (typeof uri !== 'string' || uri.length > 2048 || /[\s*\\]/.test(uri)) throw new Error('回调地址无效');
    const url = new URL(uri);
    if (url.hash || url.username || url.password || !(url.protocol === 'https:' || !production && url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) throw new Error('回调地址必须为精确 HTTPS 地址');
    return uri;
  });
}

// 老客户端在显式迁移前继续使用部署文件；新增客户端始终读数据库。
export function clientRepository(prisma, legacy = []) {
  async function row(id) { return prisma.oidcClient.findUnique({ where: { clientId: id } }); }
  async function find(id) {
    const stored = await row(id);
    const source = stored ? { client_id: id, client_secret: decryptSecret(stored.encryptedSecret, `oidc:${id}`), redirect_uris: stored.redirectUris } : legacy.find(c => c.client_id === id);
    if (!source || stored && !stored.enabled) return undefined;
    const app = id === desktopClientId() ? undefined : await kernelApplication(id);
    if (id !== desktopClientId() && (!app?.enabled || !app.runtimeReady)) return undefined;
    return { ...source, client_name: app?.name || '统一桌面', grant_types: ['authorization_code', 'client_credentials'], response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_post', scope: 'openid profile directory:read session:revoke', require_pkce: true };
  }
  return { find, row, legacyIds: new Set(legacy.map(c => c.client_id)) };
}

export function installClientManagement(server, { prisma, auth, clients, machine }) {
  server.post('/api/unified/client-registration', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (await machine(req, reply) !== desktopClientId()) return reply.sent ? undefined : reply.code(403).send({ message: '仅平台内核可管理客户端' });
    const input = req.body || {};
    let actor;
    try { actor = await auth.authenticateToken(input.token); } catch { return reply.code(401).send({ message: '操作人登录已失效' }); }
    const csrf = typeof input.csrfToken === 'string' ? Buffer.from(input.csrfToken) : Buffer.alloc(0);
    const expected = Buffer.from(actor.session.csrfToken);
    if (actor.user.role !== 'system_admin' || csrf.length !== expected.length || !timingSafeEqual(csrf, expected)) return reply.code(403).send({ message: '需要平台管理员权限和有效请求校验' });
    const id = input.clientId;
    if (typeof id !== 'string' || !/^[a-z][a-z0-9-]{1,63}$/.test(id) || id === desktopClientId()) return reply.code(400).send({ message: '此客户端不支持界面配置' });
    if (clients.legacyIds.has(id) && !await clients.row(id)) return reply.code(409).send({ message: '此客户端需要先完成现有配置迁移' });
    const app = await kernelApplication(id);
    if (!app || app.kind !== 'internal') return reply.code(400).send({ message: '应用尚未在内核登记为内部应用' });
    if (input.action === 'status') {
      const current = await clients.row(id);
      return { configured: Boolean(current), revision: current?.revision ?? 0, redirectUris: current?.redirectUris ?? [] };
    }
    if (!['create', 'rotate', 'update'].includes(input.action) || typeof input.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(input.requestId)) return reply.code(400).send({ message: '客户端请求无效' });
    let uris;
    try { if (input.action !== 'rotate') uris = callbackUris(input.redirectUris); } catch { return reply.code(400).send({ message: '回调地址无效' }); }
    const secret = randomBytes(32).toString('hex');
    try {
      return await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(741029)::text`;
        const existing = await tx.oidcClient.findUnique({ where: { clientId: id } });
        if (input.action === 'create' && existing) {
          if (existing.registrationId !== input.requestId || JSON.stringify(existing.redirectUris) !== JSON.stringify(uris)) return reply.code(409).send({ message: '客户端已登记且配置不一致' });
          return { configured: true, revision: existing.revision, secretAvailable: false };
        }
        if (input.action !== 'create' && (!existing || input.expectedRevision !== existing.revision)) return reply.code(409).send({ message: '客户端已更新，请刷新后再试' });
        const changedSecret = input.action !== 'update';
        const data = { redirectUris: uris || existing.redirectUris, encryptedSecret: changedSecret ? encryptSecret(secret, `oidc:${id}`) : existing.encryptedSecret };
        const saved = existing ? await tx.oidcClient.update({ where: { clientId: id }, data: { ...data, revision: { increment: 1 } } })
          : await tx.oidcClient.create({ data: { clientId: id, registrationId: input.requestId, ...data } });
        if (!existing) {
          await tx.application.upsert({ where: { clientId: id }, create: { clientId: id }, update: {} });
          await tx.applicationUser.upsert({ where: { clientId_userId: { clientId: id, userId: actor.user.userId } }, create: { clientId: id, userId: actor.user.userId, enabled: true }, update: { enabled: true } });
        }
        await tx.auditLog.create({ data: { actorUserId: actor.user.userId, actorName: actor.user.name, actorRole: actor.user.role, action: `oidc_client.${input.action}`, targetType: 'OidcClient', targetId: id, detail: { revision: saved.revision, redirectUris: saved.redirectUris } } });
        return { configured: true, revision: saved.revision, secretAvailable: changedSecret, ...(changedSecret ? { clientSecret: secret } : {}) };
      });
    } catch (error) {
      if (error?.code === 'P2002') return reply.code(409).send({ message: '注册请求已被其他应用使用' });
      throw error;
    }
  });
}
