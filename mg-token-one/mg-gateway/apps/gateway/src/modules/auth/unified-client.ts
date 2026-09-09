/** 权威版本由统一认证维护，业务项目通过同步脚本获取。仅在服务端使用。 */
export interface UnifiedIdentity {
  active: true; iss: string; aud: string; sub: string; sid: string;
  username: string | null; name: string; department: string | null; avatarUrl?: string | null;
  role: string; localUserId: string | null; securityVersion: number;
  roles?: Array<{ id: string; key?: string | null; name: string }>;
  authorizationSources?: Array<{ type: 'user' } | { type: 'role'; roleId: string; name: string }>;
  amr: string[]; authTime: number; exp: number; csrfToken: string;
}
export interface UnifiedClientConfig { issuer: string; clientId: string; clientSecret: string; }
export class UnifiedAuthError extends Error {
  constructor(public readonly status: 401 | 503, message: string) { super(message); this.name = 'UnifiedAuthError'; }
}
export function unifiedIdentityEnabled(): boolean {
  return process.env.IDENTITY_ENABLED === 'true' && process.env.IDENTITY_TOKEN_MODE !== 'legacy';
}
export function bearerToken(header: unknown): string {
  const token = typeof header === 'string' && /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header)?.[1];
  if (!token) throw new UnifiedAuthError(401, '统一登录令牌缺失或无效');
  return token;
}
export function desktopLoginUrl(appId: string, path = '/'): string {
  const origin = new URL(process.env.DESKTOP_ORIGIN || 'https://desktop.meta-gravity.com');
  validateOrigin(origin);
  const url = new URL('/auth/start', origin);
  const route = typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') && !/[\\\r\n]/.test(path) ? path : '/';
  url.searchParams.set('app', appId); url.searchParams.set('path', route);
  return url.href;
}
function validateOrigin(url: URL): void {
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/'
    || (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)))) {
    throw new UnifiedAuthError(503, '统一认证来源配置无效');
  }
}
export class UnifiedIdentityClient {
  private machine?: { token: string; expires: number };
  private acquiring?: Promise<string>;
  constructor(private readonly options?: UnifiedClientConfig) {}
  private config(): UnifiedClientConfig {
    const config = this.options || { issuer: process.env.IDENTITY_ISSUER || 'https://identity.meta-gravity.com',
      clientId: process.env.IDENTITY_CLIENT_ID || '', clientSecret: process.env.IDENTITY_CLIENT_SECRET || '' };
    validateOrigin(new URL(config.issuer));
    if (!config.clientId || config.clientSecret.length < 32) throw new UnifiedAuthError(503, '统一认证服务凭据配置不完整');
    return { ...config, issuer: new URL(config.issuer).origin };
  }
  private async serviceToken(): Promise<string> {
    if (this.machine && this.machine.expires > Date.now()) return this.machine.token;
    if (this.acquiring) return this.acquiring;
    this.acquiring = (async () => {
      const c = this.config();
      let response: Response;
      try { response = await fetch(`${c.issuer}/token`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: c.clientId, client_secret: c.clientSecret, scope: 'directory:read session:revoke' }) }); }
      catch { throw new UnifiedAuthError(503, '统一认证服务暂时不可用'); }
      if (!response.ok) throw new UnifiedAuthError(503, '统一认证服务身份验证失败');
      const result = await response.json() as Record<string, unknown>;
      if (typeof result.access_token !== 'string' || typeof result.expires_in !== 'number' || result.expires_in <= 0) throw new UnifiedAuthError(503, '统一认证服务响应无效');
      this.machine = { token: result.access_token, expires: Date.now() + Math.max(0, Math.min(60, result.expires_in - 5)) * 1000 };
      return this.machine.token;
    })();
    try { return await this.acquiring; } finally { this.acquiring = undefined; }
  }
  private async request(path: string, body: object): Promise<Record<string, any>> {
    const c = this.config();
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.serviceToken();
      let response: Response;
      try { response = await fetch(`${c.issuer}/api/unified/${path}`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
      catch { throw new UnifiedAuthError(503, '统一认证服务暂时不可用'); }
      if (response.status === 401 && attempt === 0) { this.machine = undefined; continue; }
      if (!response.ok) throw new UnifiedAuthError(response.status === 400 || response.status === 401 ? 401 : 503, '统一认证请求未通过');
      const result = await response.json();
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw new UnifiedAuthError(503, '统一认证响应格式无效');
      return result;
    }
    throw new UnifiedAuthError(503, '统一认证服务身份已失效');
  }
  async introspect(token: string, appId = this.config().clientId): Promise<UnifiedIdentity> {
    bearerToken(`Bearer ${token}`);
    const result = await this.request('introspect', { token, app_id: appId });
    if (result.active !== true) throw new UnifiedAuthError(401, '统一登录已失效或没有应用访问权限');
    return this.profile(result, appId);
  }
  private profile(result: Record<string, any>, appId: string): UnifiedIdentity {
    if (result.active !== true || result.iss !== this.config().issuer || result.aud !== appId
      || typeof result.sub !== 'string' || !result.sub || typeof result.sid !== 'string' || !result.sid
      || typeof result.name !== 'string' || !result.name.trim() || typeof result.role !== 'string'
      || !(result.username === null || typeof result.username === 'string')
      || !(result.department === null || typeof result.department === 'string')
      || !(result.localUserId === null || typeof result.localUserId === 'string')
      || !Number.isSafeInteger(result.exp) || result.exp <= Date.now() / 1000
      || !Number.isSafeInteger(result.securityVersion) || !Number.isSafeInteger(result.authTime)
      || !Array.isArray(result.amr) || !result.amr.every((m: unknown) => typeof m === 'string')
      || result.avatarUrl !== undefined && result.avatarUrl !== null && (typeof result.avatarUrl !== 'string' || result.avatarUrl.length > 2048 || !/^https:\/\//.test(result.avatarUrl))
      || result.roles !== undefined && (!Array.isArray(result.roles) || !result.roles.every((r: any) => r && typeof r.id === 'string' && typeof r.name === 'string' && (r.key === undefined || r.key === null || typeof r.key === 'string')))
      || result.authorizationSources !== undefined && (!Array.isArray(result.authorizationSources) || !result.authorizationSources.every((s: any) => s && (s.type === 'user' || s.type === 'role' && typeof s.roleId === 'string' && typeof s.name === 'string')))
      || typeof result.csrfToken !== 'string' || !result.csrfToken) throw new UnifiedAuthError(503, '统一身份契约校验失败');
    return result as UnifiedIdentity;
  }
  async revoke(token: string, appId = this.config().clientId): Promise<void> {
    bearerToken(`Bearer ${token}`);
    if ((await this.request('revoke', { token, app_id: appId })).revoked !== true) throw new UnifiedAuthError(503, '统一退出未完成');
  }
  async exchange(code: string, verifier: string, redirectUri: string): Promise<{ token: string; profile: UnifiedIdentity }> {
    const result = await this.request('exchange', { code, code_verifier: verifier, redirect_uri: redirectUri });
    const token = bearerToken(`Bearer ${result.access_token}`);
    return { token, profile: this.profile(result.profile || {}, this.config().clientId) };
  }
  async renew(token: string): Promise<{ token: string; profile: UnifiedIdentity }> {
    bearerToken(`Bearer ${token}`);
    const result = await this.request('renew', { token });
    if (result.access_token !== token) throw new UnifiedAuthError(503, '续期未保持统一令牌一致性');
    return { token, profile: this.profile(result.profile || {}, this.config().clientId) };
  }
  async applications(token: string): Promise<Array<{ id: string; name: string }>> {
    bearerToken(`Bearer ${token}`);
    const result = await this.request('applications', { token });
    if (!Array.isArray(result.applications) || !result.applications.every((app: any) => typeof app.id === 'string' && typeof app.name === 'string')) throw new UnifiedAuthError(503, '授权应用目录无效');
    return result.applications;
  }
}
export const unifiedIdentity = new UnifiedIdentityClient();
