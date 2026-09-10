import { createHash, randomBytes } from 'node:crypto';
import { encryptSecret, decryptSecret } from './security-secrets.js';
import { applicationAccess, effectiveApplications, canInspectAudience } from './application-access.js';
import { kernelApplication } from './kernel-applications.js';

const digest = value => createHash('sha256').update(value).digest('hex');
const challenge = value => createHash('sha256').update(value).digest('base64url');
const validToken = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const desktopId = () => process.env.IDENTITY_DESKTOP_CLIENT_ID || 'desktop-one';
const hours = (value, fallback) => Number.isFinite(Number(value)) ? Math.min(168, Math.max(1, Number(value))) : fallback;

/** 内部应用共享中心 AuthSession 的原始令牌，不生成应用登录凭据。 */
export function createUnifiedTokens({ prisma, auth, clients, issuer }) {
  async function inspect(token, appId) {
    if (!validToken(token) || typeof appId !== 'string') return { active: false };
    let authenticated;
    try { authenticated = await auth.authenticateToken(token); }
    catch (error) { if (error?.getStatus?.() === 401) return { active: false }; throw error; }
    const session = await prisma.authSession.findUnique({ where: { tokenHash: digest(token) }, include: { user: true } });
    if (!session || session.id !== authenticated.session.id || session.revokedAt || session.expiresAt <= new Date()
      || session.user.status !== 'active' || session.securityVersion !== session.user.securityVersion) return { active: false };
    if (!await kernelApplication(appId)) return { active: false };
    const access = await applicationAccess(prisma, session.userId, appId);
    if (!access.effective) return { active: false };
    // 拆分授权目标仍复用原 Token 业务身份映射，映射存在不表示获得门户授权。
    const tokenMapping = ['token-one-console', 'token-one-docs'].includes(appId)
      ? await prisma.applicationUser.findUnique({ where: { clientId_userId: { clientId: 'token-one', userId: session.userId } } }) : null;
    return { active: true, iss: issuer, aud: appId, sub: session.userId, sid: session.id,
      username: session.user.username, name: session.user.displayName, department: session.user.departmentName,
      avatarUrl: authenticated.user.avatarUrl ?? null, role: authenticated.user.role, roles: authenticated.user.roles,
      authorizationSources: access.sources.filter(source => source.type !== 'scope'),
      scopeAuthorizationSources: access.sources.filter(source => source.type === 'scope'),
      localUserId: access.localUserId || tokenMapping?.localUserId || null, securityVersion: session.user.securityVersion,
      amr: session.authMethods, authTime: Math.floor(session.verifiedAt.getTime() / 1000),
      exp: Math.floor(session.expiresAt.getTime() / 1000), csrfToken: session.csrfToken };
  }

  async function issueCode(token, query) {
    const { client_id: clientId, redirect_uri: redirectUri, state, code_challenge: codeChallenge } = query;
    const client = clients.find(c => c.client_id === clientId);
    if (clientId !== desktopId() || !client?.redirect_uris.includes(redirectUri)
      || typeof state !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(state)
      || !validToken(codeChallenge) || query.code_challenge_method !== 'S256') return null;
    const profile = await inspect(token, clientId);
    if (!profile.active) return null;
    const code = randomBytes(32).toString('base64url');
    const id = digest(code);
    await prisma.oidcRecord.deleteMany({ where: { model: 'UnifiedCode', expiresAt: { lt: new Date() } } });
    await prisma.oidcRecord.create({ data: { model: 'UnifiedCode', id,
      payload: { clientId, redirectUri, codeChallenge, encryptedToken: encryptSecret(token, `unified-code:${id}`) },
      expiresAt: new Date(Date.now() + 60_000) } });
    const callback = new URL(redirectUri);
    callback.searchParams.set('code', code); callback.searchParams.set('state', state);
    return callback.href;
  }

  async function exchange(clientId, input) {
    if (clientId !== desktopId() || !validToken(input.code) || typeof input.code_verifier !== 'string'
      || !/^[A-Za-z0-9._~-]{43,128}$/.test(input.code_verifier)) return null;
    const id = digest(input.code);
    const record = await prisma.$transaction(async tx => {
      const row = await tx.oidcRecord.findUnique({ where: { model_id: { model: 'UnifiedCode', id } } });
      if (!row || row.consumedAt || row.expiresAt <= new Date() || row.payload.clientId !== clientId
        || row.payload.redirectUri !== input.redirect_uri || row.payload.codeChallenge !== challenge(input.code_verifier)) return null;
      const result = await tx.oidcRecord.updateMany({ where: { model: 'UnifiedCode', id, consumedAt: null, expiresAt: { gt: new Date() } },
        data: { consumedAt: Math.floor(Date.now() / 1000) } });
      return result.count === 1 ? row : null;
    });
    if (!record) return null;
    const token = decryptSecret(record.payload.encryptedToken, `unified-code:${id}`);
    const profile = await inspect(token, clientId);
    if (!profile.active) return null;
    return { access_token: token, token_type: 'Bearer', expires_in: Math.max(0, profile.exp - Math.floor(Date.now() / 1000)), profile };
  }

  async function renew(token) {
    const profile = await inspect(token, desktopId());
    if (!profile.active) return null;
    const session = await prisma.authSession.findUnique({ where: { id: profile.sid } });
    if (!session) return null;
    // 延长同一枚令牌的有效期，绝对期限要求重新认证；并发续期不产生多枚令牌。
    const maximum = session.createdAt.getTime() + hours(process.env.UNIFIED_SESSION_MAX_HOURS, 72) * 3_600_000;
    const expiresAt = new Date(Math.min(maximum, Date.now() + hours(process.env.SESSION_TTL_HOURS, 12) * 3_600_000));
    if (expiresAt <= new Date()) return null;
    await prisma.authSession.updateMany({ where: { id: profile.sid, tokenHash: digest(token), revokedAt: null,
      expiresAt: { gt: new Date(), lt: expiresAt } }, data: { expiresAt } });
    const current = await inspect(token, desktopId());
    return current.active ? { access_token: token, token_type: 'Bearer', profile: current } : null;
  }

  return { inspect, issueCode, exchange, renew };
}

export function installUnifiedTokenRoutes(server, { prisma, auth, clients, issuer, machine }) {
  const tokens = createUnifiedTokens({ prisma, auth, clients, issuer });
  const noStore = reply => reply.headers({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  async function caller(req, reply, scope) { noStore(reply); return machine(req, reply, scope); }
  async function target(req, reply, scope = 'directory:read') {
    const clientId = await caller(req, reply, scope); if (!clientId) return null;
    const appId = req.body?.targetAppId || req.body?.app_id || clientId;
    if (typeof appId !== 'string' || !canInspectAudience(clientId, appId)) { reply.code(403).send({ message: '不能查询其他应用的身份' }); return null; }
    return appId;
  }
  server.post('/api/unified/introspect', async (req, reply) => {
    const appId = await target(req, reply); if (!appId) return;
    return tokens.inspect(req.body?.token, appId);
  });
  server.post('/api/unified/revoke', async (req, reply) => {
    const appId = await target(req, reply, 'session:revoke'); if (!appId) return;
    const result = await tokens.inspect(req.body?.token, appId);
    if (result.active) await auth.logout(result.sid);
    return { revoked: true };
  });
  server.post('/api/unified/renew', async (req, reply) => {
    if (await caller(req, reply) !== desktopId()) { if (!reply.sent) reply.code(403).send({ message: '仅统一入口可以续期' }); return; }
    const result = await tokens.renew(req.body?.token);
    return result || reply.code(401).send({ message: '登录已到期，请重新认证' });
  });
  server.post('/api/unified/exchange', async (req, reply) => {
    const clientId = await caller(req, reply); if (!clientId) return;
    const result = await tokens.exchange(clientId, req.body || {});
    return result || reply.code(400).send({ message: '登录返回码无效或已使用' });
  });
  server.post('/api/unified/applications', async (req, reply) => {
    if (await caller(req, reply) !== desktopId()) { if (!reply.sent) reply.code(403).send({ message: '仅统一入口可以读取授权应用' }); return; }
    const profile = await tokens.inspect(req.body?.token, desktopId());
    if (!profile.active) return reply.code(401).send({ message: '登录已失效' });
    const memberships = await effectiveApplications(prisma, profile.sub);
    return { applications: memberships.filter(m => m.effective).map(m => ({ id: m.clientId, name: m.name, sources: m.sources, foundation: m.foundation })) };
  });
  server.get('/api/unified/authorize', async (req, reply) => {
    noStore(reply);
    const q = req.query || {};
    const client = clients.find(c => c.client_id === desktopId());
    if (q.client_id !== desktopId() || !client?.redirect_uris.includes(q.redirect_uri)
      || typeof q.state !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(q.state)
      || !validToken(q.code_challenge) || q.code_challenge_method !== 'S256') return reply.code(400).send({ message: '桌面登录请求无效' });
    const token = String(req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith('mg_identity_session='))?.slice(20);
    const profile = await tokens.inspect(token, desktopId());
    if (!profile.active) return reply.redirect(`/login?next=${encodeURIComponent(req.url)}`, 303);
    const url = await tokens.issueCode(token, q);
    return url ? reply.redirect(url, 303) : reply.code(403).send({ message: '桌面访问未授权' });
  });
  return tokens;
}
