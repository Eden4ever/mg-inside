import { desktop, platformSession } from '../desktop';
export interface SessionUser { userId: string; username: string | null; name: string; departmentName: string | null; avatarUrl?: string | null; role: string; authSource: string }
export interface AccountSecurityState { recentRecovery?: boolean; mfaEnabled: boolean; methods: string[]; email: string | null; totpBound: boolean; keys: Array<{ id: string; name: string; createdAt: string; lastUsedAt: string | null }> }
export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
export async function request<T>(path: string, options: RequestInit = {}, base = desktop.apiBase): Promise<T> {
  const mutation = !['GET', 'HEAD'].includes(options.method || 'GET');
  const end = mutation ? desktop.beginRequest() : () => {};
  try {
    const headers = new Headers(options.headers);
    if (typeof options.body === 'string') headers.set('Content-Type', 'application/json');
    if (mutation) headers.set('X-CSRF-Token', await platformSession.csrf());
    const response = await fetch(`${base}${path}`, { ...options, headers, credentials: 'include', signal: options.signal || AbortSignal.timeout(30000) });
    const data = response.status === 204 ? {} : await response.json();
    if (!response.ok) {
      if (response.status === 401) { platformSession.clear(); desktop.login(); }
      throw new ApiError(Array.isArray(data.message) ? data.message.join('；') : data.message || '操作失败，请稍后重试', response.status);
    }
    return data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new Error(error instanceof Error && error.message === '统一认证会话不可用' ? error.message : '暂时无法连接服务，请稍后重试');
  } finally { end(); }
}
const send = <T = unknown>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const api = {
  changePassword: (currentPassword: string, newPassword: string) => send('/auth/change-password', { currentPassword, newPassword }),
  accountSecurity: () => request<AccountSecurityState>('/account-security'),
  authorizeSecurity: (password: string, code?: unknown, method?: string) => send<{ token: string }>('/account-security/authorize', { password, code, method }),
  sendSecurityEmail: () => send('/account-security/authorize/email', {}),
  startEmailBinding: (token: string, address: string) => send<{ token: string }>('/account-security/email/start', { token, address }),
  confirmEmailBinding: (token: string, code: string) => send<{ ok: boolean }>('/account-security/email/confirm', { token, code }),
  removeEmailBinding: (token: string) => send('/account-security/email/remove', { token }),
  startTotp: (token: string) => send<{ token: string; secret: string; uri: string }>('/account-security/totp/start', { token }),
  confirmTotp: (token: string, code: string) => send<{ ok: boolean }>('/account-security/totp/confirm', { token, code }),
  removeTotp: (token: string) => send('/account-security/totp/remove', { token }),
  setMfa: (token: string, enabled: boolean, methods: string[]) => send<{ enabled: boolean; recoveryCodes: string[] }>('/account-security/mfa', { token, enabled, methods }),
};
