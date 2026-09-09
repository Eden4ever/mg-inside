/** 两个应用共用的后端 OIDC 客户端；无浏览器令牌持久化。 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import * as oidc from 'openid-client';

export interface IdentityProfile { sub: string; identity_session: string; local_user_id: string | null; preferred_username?: string | null; name?: string; department?: string; auth_methods?: string[]; }
export const FLOW_COOKIE = 'mg_sso_flow';
export function identityEnabled() { return process.env.IDENTITY_ENABLED === 'true'; }
let configuration: Promise<oidc.Configuration> | undefined;
async function config() {
  if (!identityEnabled()) throw new Error('统一认证未启用');
  if (!configuration) configuration = (async () => {
    const issuer = new URL(process.env.IDENTITY_ISSUER || 'https://identity.meta-gravity.com');
    const secret = process.env.IDENTITY_CLIENT_SECRET || '';
    if (!process.env.IDENTITY_CLIENT_ID || secret.length < 32 || !process.env.IDENTITY_REDIRECT_URI) throw new Error('统一认证配置不完整');
    if (issuer.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(issuer.hostname))) throw new Error('认证地址必须使用 HTTPS');
    return oidc.discovery(issuer, process.env.IDENTITY_CLIENT_ID, undefined, oidc.ClientSecretPost(secret),
      issuer.protocol === 'http:' ? { execute: [oidc.allowInsecureRequests] } : undefined);
  })().catch(error => { configuration = undefined; throw error; });
  return configuration;
}
function key() {
  const value = process.env.IDENTITY_COOKIE_KEY || '';
  if (!/^[a-fA-F0-9]{64}$/.test(value)) throw new Error('统一认证 Cookie 密钥必须为 32 字节十六进制值');
  return Buffer.from(value, 'hex');
}
export function cookieValue(header: unknown) {
  if (typeof header !== 'string') return '';
  return header.split(';').map(p => p.trim()).find(p => p.startsWith(`${FLOW_COOKIE}=`))?.slice(FLOW_COOKIE.length + 1) || '';
}
export function flowCookie(value: string, maxAge = 600) {
  // 浏览器看到的是反向代理前的业务路径，指标库部署在子目录下。
  const callbackPath = new URL(process.env.IDENTITY_REDIRECT_URI || 'http://localhost/api/auth/sso/callback').pathname;
  const cookiePath = callbackPath.slice(0, callbackPath.lastIndexOf('/')) || '/';
  return `${FLOW_COOKIE}=${value}; Path=${cookiePath}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}
export async function startIdentity(returnTo = '/') {
  const client = await config();
  const verifier = oidc.randomPKCECodeVerifier(); const state = oidc.randomState(); const nonce = oidc.randomNonce();
  const payload = { verifier, state, nonce, returnTo: returnTo === '/admin/stats' ? returnTo : '/', expires: Date.now() + 600000 };
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final()]);
  const cookie = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
  const url = oidc.buildAuthorizationUrl(client, { redirect_uri: process.env.IDENTITY_REDIRECT_URI!, scope: 'openid profile', state, nonce,
    code_challenge: await oidc.calculatePKCECodeChallenge(verifier), code_challenge_method: 'S256' });
  return { url: url.href, cookie: flowCookie(cookie) };
}
export async function completeIdentity(requestUrl: string, cookie: string) {
  if (!cookie || cookie.length > 4096) throw new Error('登录请求已失效');
  const packed = Buffer.from(cookie, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', key(), packed.subarray(0, 12)); decipher.setAuthTag(packed.subarray(12, 28));
  const flow = JSON.parse(Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString());
  if (!(flow.expires > Date.now()) || flow.expires > Date.now() + 600000) throw new Error('登录请求已过期');
  const callback = new URL(process.env.IDENTITY_REDIRECT_URI!); callback.search = new URL(requestUrl, callback).search;
  const client = await config();
  const tokens = await oidc.authorizationCodeGrant(client, callback, { pkceCodeVerifier: flow.verifier, expectedState: flow.state, expectedNonce: flow.nonce });
  const claims = tokens.claims(); if (!claims?.sub) throw new Error('认证身份不完整');
  const info = await oidc.fetchUserInfo(client, tokens.access_token, claims.sub);
  const profile = { ...info, ...claims, local_user_id: info.local_user_id, identity_session: info.identity_session || claims.identity_session } as unknown as IdentityProfile;
  if (!(profile.local_user_id === null || typeof profile.local_user_id === 'string') || typeof profile.identity_session !== 'string' || !profile.identity_session ||
      (profile.auth_methods !== undefined && (!Array.isArray(profile.auth_methods) || !profile.auth_methods.every(m=>typeof m==='string')))) throw new Error('中心身份或会话缺失');
  return { profile, returnTo: flow.returnTo as string };
}
let machine: { token: string; expires: number } | undefined;
async function directory(path: string, body?: object) {
  const client = await config();
  if (!machine || machine.expires <= Date.now()) {
    const token = await oidc.clientCredentialsGrant(client, { scope: 'directory:read session:revoke' });
    machine = { token: token.access_token, expires: Date.now() + 60000 };
  }
  const url = new URL(path, client.serverMetadata().issuer);
  const response = await fetch(url, { method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(8000),
    headers: { Authorization: `Bearer ${machine.token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (!response.ok) { machine = undefined; throw new Error('用户同步或会话校验失败'); }
  const result = await response.json();
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('认证服务响应无效');
  return result as Record<string, unknown>;
}
export async function identitySessionActive(subject: string, sessionId: string): Promise<boolean> {
  const result = await directory('/api/directory/session', { subject, sessionId }); return result.active === true;
}
export async function identityEndSession(subject: string, sessionId: string): Promise<void> {
  const result = await directory('/api/directory/logout', { subject, sessionId });
  if (result.revoked !== true) throw new Error('统一身份退出未完成，请重试');
}
export interface DirectoryUser { subject: string; localUserId: string | null; username?: string | null; name: string; department: string | null; active: boolean; securityVersion: number; }
export async function identityDirectory(): Promise<DirectoryUser[]> {
  const rows: DirectoryUser[] = []; let snapshot: string | undefined; let offset = 0;
  for (let page = 0; page < 1000; page++) {
    const params = new URLSearchParams(snapshot ? { snapshot, offset: String(offset) } : {});
    const result = await directory(`/api/directory/users?${params}`);
    if (!Array.isArray(result.users) || typeof result.snapshot !== 'string' || (snapshot && result.snapshot !== snapshot)) throw new Error('同步响应无效');
    for (const user of result.users) {
      if (!user || typeof user.subject !== 'string' || !user.subject || !(user.localUserId === null || (typeof user.localUserId === 'string' && user.localUserId)) ||
          !(user.username == null || typeof user.username === 'string') ||
          typeof user.name !== 'string' || !(user.department === null || typeof user.department === 'string') ||
          typeof user.active !== 'boolean' || !Number.isInteger(user.securityVersion)) throw new Error('同步用户无效');
      if (rows.some(r=>r.subject===user.subject || (user.localUserId!==null && r.localUserId===user.localUserId))) throw new Error('同步身份重复');
      rows.push(user);
    }
    if (result.complete === true && result.nextOffset === null) return rows;
    if (typeof result.nextOffset !== 'number' || !Number.isInteger(result.nextOffset) || result.nextOffset <= offset) throw new Error('同步游标无效');
    snapshot = result.snapshot; offset = result.nextOffset;
  }
  throw new Error('同步数据超出单轮上限');
}
