import { desktop, platformSession } from './desktop';
export type ApplicationIcon = string;
export interface ManagedApplication { runtimeReady?: boolean }
export interface ManagedApplication { id: string; name: string; description: string; developer?: string; registeredVersion?: string; kind: 'system' | 'default' | 'internal' | 'external'; version?:string|null; editable: boolean; available: boolean; enabled?: boolean; revision?: number; createdAt?: string; updatedAt?: string; entryUrl: string; defaultPath: string; allowedPaths?: string[]; icon: ApplicationIcon; minWidth: number; minHeight: number; defaultMaximized?: boolean }
export interface ApplicationInput { name: string; url: string; description: string; developer: string; icon: ApplicationIcon }
export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const mutation = !['GET', 'HEAD'].includes(options.method || 'GET');
  const end = mutation ? desktop.beginRequest() : () => {};
  try {
    const headers = new Headers(options.headers);
    if (options.body) headers.set('Content-Type', 'application/json');
    if (mutation) headers.set('X-CSRF-Token', await platformSession.csrf());
    const response = await fetch(`${desktop.origin}${path}`, { ...options, headers, credentials: 'include', cache: 'no-store', signal: options.signal || AbortSignal.timeout(30000) });
    const data = response.status === 204 ? {} : await response.json();
    if (!response.ok) { if (response.status === 401) { platformSession.clear(); desktop.login(); } throw new Error(Array.isArray(data.message) ? data.message.join('；') : data.message || '请求未成功，请稍后重试'); }
    return data as T;
  } catch (error) {
    if (error instanceof Error && error.name !== 'TypeError') throw error;
    throw new Error('暂时无法连接应用服务，请稍后重试');
  } finally { end(); }
}
export function normalizeExternalUrl(value: string) {
  const raw = value.trim();
  if (!raw || raw.length > 2048 || /[\u0000-\u001f\u007f]/.test(raw)) throw new Error('请输入有效的网页地址，最长 2048 个字符');
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('请输入完整地址，例如 https://example.com'); }
  if (url.username || url.password) throw new Error('网页地址不能包含用户名或密码');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const allowLocal = import.meta.env.VITE_ALLOW_LOCAL_HTTP === 'true' || import.meta.env.DEV;
  if (url.protocol !== 'https:' && !(allowLocal && local && url.protocol === 'http:')) throw new Error('请使用 HTTPS 网页地址；开发环境仅允许本机 HTTP 地址');
  return url.href;
}
