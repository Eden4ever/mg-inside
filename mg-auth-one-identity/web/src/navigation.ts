const managementPaths = new Set(['/', '/admin', '/applications', '/roles', '/divisions', '/organizations', '/account', '/settings', '/access-denied']);

/** 登录返回值只接受管理路由，不接受外部地址、桌面挂载前缀或认证端点。 */
export function managementReturnPath(input: unknown): string {
  if (typeof input !== 'string' || !input.startsWith('/') || input.startsWith('//') || /[\\\r\n]/.test(input)) return '/';
  try {
    const url = new URL(input, 'https://identity.invalid');
    if (url.origin !== 'https://identity.invalid' || !managementPaths.has(url.pathname)) return '/';
    const query = new URLSearchParams();
    for (const key of ['user', 'role', 'tab']) {
      const value = url.searchParams.get(key);
      if (value && /^[A-Za-z0-9_-]{1,100}$/.test(value)) query.set(key, value);
    }
    return url.pathname + (query.size ? `?${query}` : '');
  } catch { return '/'; }
}

/** PKCE 返回路径仅交给当前认证域名，具体 client/redirect_uri 仍由中心校验。 */
export function identityAuthorizePath(input: unknown, origin: string): string | null {
  if (typeof input !== 'string' || !input.startsWith('/api/unified/authorize?') || /[\\\r\n]/.test(input)) return null;
  try {
    const url = new URL(input, origin);
    return url.origin === origin && url.pathname === '/api/unified/authorize' ? url.pathname + url.search : null;
  } catch { return null; }
}
