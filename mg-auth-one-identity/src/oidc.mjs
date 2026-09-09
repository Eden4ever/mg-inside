import Provider from 'oidc-provider';
import fs from 'node:fs/promises';
import { databaseAdapter } from './oidc-adapter.mjs';
import { installUnifiedTokenRoutes } from './unified-token.mjs';
import { applicationAccess } from './application-access.js';
import { ensurePlatformAdministratorRole } from './platform-role.js';

export async function installIdentity(server, prisma, auth, issuer) {
  await ensurePlatformAdministratorRole(prisma);
  const secrets = JSON.parse(await fs.readFile(process.env.IDENTITY_SECRETS_FILE || './secrets/identity.json', 'utf8'));
  if (!Array.isArray(secrets.cookieKeys) || !secrets.cookieKeys.length || secrets.cookieKeys.some(k => typeof k !== 'string' || k.length < 32) || !secrets.jwks?.keys?.length) throw new Error('身份服务密钥配置不完整');
  const clients = secrets.clients;
  if (!Array.isArray(clients) || !clients.length || new Set(clients.map(c => c.client_id)).size !== clients.length) throw new Error('应用列表无效');
  for (const client of clients) {
    if (!client.client_id || typeof client.client_secret !== 'string' || client.client_secret.length < 32 || !client.redirect_uris?.length) throw new Error('应用配置不完整');
    for (const uri of client.redirect_uris) {
      const url = new URL(uri);
      if (url.hash || url.username || url.password || uri.includes('*') || (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && ['127.0.0.1', 'localhost'].includes(url.hostname)))) throw new Error('应用回调地址无效');
    }
    await prisma.application.upsert({ where: { clientId: client.client_id }, create: { clientId: client.client_id, name: client.client_name || client.client_id }, update: {} });
  }
  // 同一 Token 服务的三个界面使用独立授权目标，不额外复制机器密钥。
  for (const [clientId, name] of [['identity', '统一身份'], ['personal-center', '个人中心'], ['files', '文件'], ['app-manager', '应用管理'],
    ...(clients.some(c => c.client_id === 'token-one') ? [['token-one-console', 'Token One 控制台'], ['token-one-docs', 'Token One 文档']] : [])]) {
    await prisma.application.upsert({ where: { clientId }, create: { clientId, name }, update: {} });
  }
  const provider = new Provider(issuer, {
    adapter: databaseAdapter(prisma), jwks: secrets.jwks, cookies: { keys: secrets.cookieKeys,
      names: { session: 'mg_identity_oidc', interaction: 'mg_identity_interaction', resume: 'mg_identity_resume' } },
    clients: clients.map(c => ({ ...c, grant_types: ['authorization_code', 'client_credentials'], response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_post', scope: 'openid profile directory:read session:revoke', require_pkce: true })),
    features: { devInteractions: { enabled: false }, clientCredentials: { enabled: true }, revocation: { enabled: true } },
    scopes: ['openid', 'profile', 'directory:read', 'session:revoke'],
    pkce: { required: () => true },
    claims: { openid: ['sub', 'identity_session'], profile: ['name', 'preferred_username', 'department', 'local_user_id', 'auth_methods'] },
    ttl: { AccessToken: 300, ClientCredentials: 120, AuthorizationCode: 60, IdToken: 300, Interaction: 600, Session: 43200, Grant: 43200 },
    interactions: { url: (_ctx, interaction) => `/interaction/${interaction.uid}` },
    findAccount: async (ctx, accountId, token) => {
      const user = await prisma.user.findUnique({ where: { id: accountId } });
      const clientId = ctx.oidc.client?.clientId;
      const membership = clientId && await applicationAccess(prisma, accountId, clientId);
      if (!user || user.status !== 'active' || !membership?.effective) return undefined;
      const grantId = token?.grantId || ctx.oidc.entities?.Grant?.jti || ctx.oidc.session?.grantIdFor(clientId);
      const link = grantId && await prisma.oidcSessionLink.findUnique({ where: { grantId } });
      if (token) {
        const session = link && await prisma.authSession.findFirst({ where: { id: link.sessionId, userId: accountId, revokedAt: null, expiresAt: { gt: new Date() } } });
        if (!session || session.securityVersion !== user.securityVersion || link.clientId !== clientId) return undefined;
      }
      return { accountId, claims: async () => ({ sub: user.id, name: user.displayName, preferred_username: user.username, department: user.departmentName,
        local_user_id: membership.localUserId, identity_session: link?.sessionId,
        auth_methods: link ? (await prisma.authSession.findUnique({where:{id:link.sessionId}}))?.authMethods || [] : [] }) };
    },
  });
  provider.proxy = process.env.NODE_ENV === 'production';
  provider.on('server_error', () => console.error('OIDC 请求失败，请检查认证服务状态'));

  server.get('/interaction/:uid', async (req, reply) => {
    try {
      const interaction = await provider.interactionDetails(req.raw, reply.raw);
      let login;
      try { login = await auth.authenticate(req.headers.cookie); }
      catch { return reply.redirect(`/?interaction=${encodeURIComponent(interaction.uid)}`); }
      const clientId = String(interaction.params.client_id);
      const membership = await applicationAccess(prisma, login.user.userId, clientId);
      if (!membership.effective) return reply.code(403).send({ message: '当前账号尚未获此应用授权，请联系管理员。' });
      const grant = interaction.grantId ? await provider.Grant.find(interaction.grantId) : new provider.Grant({ accountId: login.user.userId, clientId });
      grant.addOIDCScope('openid profile');
      const grantId = await grant.save();
      await prisma.oidcSessionLink.upsert({ where: { grantId }, create: { grantId, sessionId: login.session.id, userId: login.user.userId, clientId },
        update: { sessionId: login.session.id } });
      // 在授权结果的持久会话中记录中心 Session；后续应用可在线检查撤销状态。
      reply.hijack();
      await provider.interactionFinished(req.raw, reply.raw, { login: { accountId: login.user.userId, remember: true,
        ts: Math.floor(Date.now() / 1000), amr: ['central_session'] }, consent: { grantId } }, { mergeWithLastSubmission: false });
    } catch { if (!reply.sent) return reply.code(401).send({ message: '登录请求已失效，请返回应用重新登录。' }); }
  });

  // 即使 OIDC 自身会话尚存，也必须验证中心 Session 与应用授权。
  provider.use(async (ctx, next) => {
    if (ctx.path === '/auth' && ctx.method === 'GET') {
      try {
        const login = await auth.authenticate(ctx.req.headers.cookie);
        const session = await provider.Session.get(ctx);
        const clientId = new URL(ctx.req.url, issuer).searchParams.get('client_id');
        const grantId = clientId && session.grantIdFor(clientId);
        const link = grantId && await prisma.oidcSessionLink.findUnique({ where: { grantId } });
        if (session.accountId && (session.accountId !== login.user.userId || (grantId && link?.sessionId !== login.session.id))) await session.destroy();
      } catch {
        // 禁止旧 OIDC Cookie 绕过已撤销的中心 Session。
        const session = await provider.Session.get(ctx);
        await session.destroy();
      }
    }
    await next();
  });

  async function machine(req, reply, scope = 'directory:read') {
    const raw = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];
    const token = raw && await provider.ClientCredentials.find(raw);
    const app = token && await prisma.application.findUnique({ where: { clientId: token.clientId } });
    if (!token || !token.scope?.split(' ').includes(scope) || !app?.enabled) {
      reply.code(401).send({ message: '应用凭据无效' }); return null;
    }
    return app.clientId;
  }
  server.get('/api/directory/users', async (req, reply) => {
    const clientId = await machine(req, reply); if (!clientId) return;
    const { snapshot, offset = '0' } = req.query;
    const start = Number(offset);
    if (!Number.isSafeInteger(start) || start < 0) return reply.code(400).send({ message: '游标无效' });
    let record;
    if (snapshot) record = await prisma.directorySnapshot.findFirst({ where: { id: snapshot, clientId, expiresAt: { gt: new Date() } } });
    else {
      if (start !== 0) return reply.code(400).send({ message: '缺少快照' });
      await prisma.directorySnapshot.deleteMany({ where: { expiresAt: { lt: new Date() } } });
      // 历史映射留存撤销记录；只同步曾关联或当前由角色授权的用户，不暴露整个中心名录。
      const rows = await prisma.user.findMany({ where: { OR: [
        { applications: { some: { clientId } } },
        { roles: { some: { role: { applications: { some: { clientId, enabled: true } } } } } },
      ] }, orderBy: { id: 'asc' } });
      const profiles = await Promise.all(rows.map(async user => {
        const access = await applicationAccess(prisma, user.id, clientId);
        return { subject: user.id, localUserId: access.localUserId, username: user.username, name: user.displayName,
          department: user.departmentName, active: access.effective, securityVersion: user.securityVersion };
      }));
      record = await prisma.directorySnapshot.create({ data: { clientId, rows: profiles, expiresAt: new Date(Date.now() + 300000) } });
    }
    if (!record) return reply.code(410).send({ message: '同步快照失效，请重新开始' });
    return { snapshot: record.id, users: record.rows.slice(start, start + 100),
      nextOffset: start + 100 < record.rows.length ? start + 100 : null, complete: start + 100 >= record.rows.length };
  });
  server.post('/api/directory/session', async (req, reply) => {
    const clientId = await machine(req, reply); if (!clientId) return;
    const { subject, sessionId } = req.body || {};
    if (typeof subject !== 'string' || typeof sessionId !== 'string') return reply.code(400).send({ message: '参数无效' });
    const session = await prisma.authSession.findFirst({ where: { id: sessionId, userId: subject, revokedAt: null, expiresAt: { gt: new Date() } }, include: { user: true } });
    const membership = await applicationAccess(prisma, subject, clientId);
    return { active: Boolean(session && session.user.status === 'active' && session.securityVersion === session.user.securityVersion && membership.effective) };
  });
  server.post('/api/directory/logout', async (req, reply) => {
    const clientId = await machine(req, reply, 'session:revoke'); if (!clientId) return;
    const { subject, sessionId } = req.body || {};
    if (typeof subject !== 'string' || typeof sessionId !== 'string') return reply.code(400).send({ message: '参数无效' });
    // 业务应用只能撤销曾向自己签发授权的会话，不能仅凭员工 ID 注销其他设备。
    const link = await prisma.oidcSessionLink.findFirst({ where: { clientId, userId: subject, sessionId } });
    if (!link) return reply.code(403).send({ message: '该会话不属于此应用' });
    await auth.logout(sessionId);
    return { revoked: true };
  });
  installUnifiedTokenRoutes(server, { prisma, auth, clients, issuer, machine });
  server.get('/health', async () => { await prisma.$queryRaw`SELECT 1`; return { status: 'ready', issuer }; });
  const pages = ['/', '/login', '/admin', '/applications', '/roles', '/access-denied', '/account', '/settings'];
  for (const page of pages) server.get(page, async (_req, reply) => reply.type('text/html').send(await fs.readFile(new URL('./public/index.html', import.meta.url), 'utf8')));
  server.get('/assets/:file', async (req, reply) => {
    const file = req.params.file;
    if (!/^[A-Za-z0-9_.-]+$/.test(file)) return reply.code(404).send();
    const ext = file.split('.').pop();
    const types = { js: 'application/javascript', css: 'text/css', svg: 'image/svg+xml', woff2: 'font/woff2', png: 'image/png' };
    if (!types[ext]) return reply.code(404).send();
    try { return reply.type(types[ext]).send(await fs.readFile(new URL(`./public/assets/${file}`, import.meta.url))); }
    catch { return reply.code(404).send(); }
  });
  // 原始请求交给标准 OIDC 实现，避免框架先消费 token endpoint 表单。
  server.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/') && !req.url.startsWith('/interaction/') && !req.url.startsWith('/assets/') && ![...pages, '/health'].includes(req.url.split('?')[0])) {
      reply.hijack(); await provider.callback()(req.raw, reply.raw);
    }
  });
  server.all('/*', async (_req, reply) => reply.code(404).send({ message: '接口不存在' }));
}
