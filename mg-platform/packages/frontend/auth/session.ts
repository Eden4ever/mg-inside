/** 仅获取会话元数据和 CSRF；访问令牌始终保留在 HttpOnly Cookie/服务端。 */
export function createPlatformSession(options: { origin: string; onExpired: () => void }) {
  const origin = new URL(options.origin).origin;
  let csrfToken = '';
  let generation = 0;
  let pending: Promise<string> | undefined;
  return {
    clear() { generation++; csrfToken = ''; pending = undefined; },
    async csrf(): Promise<string> {
      if (csrfToken) return csrfToken;
      if (pending) return pending;
      const revision = generation;
      const request = (async () => {
        const response = await fetch(`${origin}/api/session`, { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(15000) });
        if (!response.ok) {
          if (response.status === 401) options.onExpired();
          throw new Error('统一认证会话不可用');
        }
        const data = await response.json() as { csrfToken?: unknown };
        if (typeof data.csrfToken !== 'string' || !data.csrfToken) throw new Error('统一认证会话缺少 CSRF 信息');
        if (revision !== generation) throw new Error('登录状态已更新，请重试');
        csrfToken = data.csrfToken;
        return csrfToken;
      })();
      pending = request;
      try { return await request; } finally { if (pending === request) pending = undefined; }
    },
  };
}
