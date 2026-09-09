import type { RegisteredApp } from './config';

/** 读取业务自身的角色，不能用统一身份管理员角色代替业务管理员。 */
export async function hasRequiredRole(app: RegisteredApp, token: string): Promise<boolean> {
  if (!app.requiredRole) return true;
  try {
    const mePath = app.id === 'token-one-console' ? '/auth/me/token-one-console' : '/auth/me';
    const response = await fetch(`${app.upstream}${mePath}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000), redirect: 'error' });
    if (!response.ok) return false;
    const result = await response.json() as { role?: string; user?: { role?: string } };
    const role = app.id === 'identity' ? result.user?.role : result.role;
    return role === app.requiredRole;
  } catch { return false; }
}
