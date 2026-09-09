export const DESKTOP_PROTOCOL = 'mg-desktop-v1';
export interface DesktopApp {
  kind?: 'system' | 'default' | 'internal' | 'external';
  id: string; name: string; description: string; icon: 'knowledge' | 'token' | 'identity' | 'personal';
  entryUrl: string; defaultPath: string; allowedPaths: string[];
  minWidth: number; minHeight: number; defaultMaximized?: boolean;
}
export interface DesktopUser { avatarUrl?: string | null; id: string; name: string; username: string | null; role: string; department: string | null; }
export interface DesktopSession { user: DesktopUser; csrfToken: string; expiresAt: number; apps: DesktopApp[]; desktop?: { name: string }; }
export interface Rect { x: number; y: number; width: number; height: number; }
export type WindowMode = 'normal' | 'maximized' | 'left' | 'right';
export interface DesktopWindow {
  id: string; appId: string; title: string; path: string; rect: Rect; restoreRect: Rect;
  mode: WindowMode; minimized: boolean; ready: boolean; dirty: boolean; busy: boolean; error: string;
  appearance?: { backgroundColor: string; backgroundImage: string; color: string };
  dialog?: { parentWindowId: string; requestId: string; dialogId: string; params: Record<string, unknown> };
}
export interface DesktopDialogDefinition { id: string; title: string; path: string; width?: number; height?: number }
export interface DesktopDialogContext { dialogId: string; params: Record<string, unknown> }
export interface DesktopDialogResult { outcome: 'completed' | 'cancelled'; value?: unknown; message?: string }
/** 只允许有限的 JSON 数据；不通过消息传函数、DOM、循环引用或无限量业务数据。 */
export function isDialogData(value: unknown): boolean {
  const seen = new Set<object>();
  function visit(item: unknown, depth: number): boolean {
    if (depth > 8) return false;
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return true;
    if (typeof item === 'number') return Number.isFinite(item);
    if (!item || typeof item !== 'object' || seen.has(item)) return false;
    const proto = Object.getPrototypeOf(item);
    if (!Array.isArray(item) && proto !== Object.prototype && proto !== null) return false;
    seen.add(item);
    const valid = Object.keys(item).length <= 1024 && Object.values(item).every(child => visit(child, depth + 1));
    seen.delete(item); return valid;
  }
  try { return visit(value, 0) && new TextEncoder().encode(JSON.stringify(value)).length <= 16 * 1024; } catch { return false; }
}
export function isDialogParams(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) && isDialogData(value); }
export function isDialogResult(value: unknown): value is DesktopDialogResult {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !isDialogData(value)) return false;
  const result = value as Record<string, unknown>;
  return (result.outcome === 'completed' || result.outcome === 'cancelled') && (result.value === undefined || isDialogData(result.value))
    && (result.message === undefined || typeof result.message === 'string' && result.message.length <= 500);
}
export function validateDialogDefinitions(value: unknown): DesktopDialogDefinition[] {
  if (!Array.isArray(value) || value.length > 32) throw new Error('注册弹窗最多 32 个');
  const ids = new Set<string>();
  return value.map((item, index) => {
    const path = `dialogs[${index}]`;
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`${path} 必须是对象`);
    if (Object.keys(item).some(key => !['id', 'title', 'path', 'width', 'height'].includes(key))) throw new Error(`${path} 包含未知字段`);
    if (typeof item.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(item.id) || ids.has(item.id)) throw new Error(`${path}.id 无效或重复`);
    if (typeof item.title !== 'string' || !item.title.trim() || item.title.length > 120) throw new Error(`${path}.title 必须为 1–120 字符`);
    if (typeof item.path !== 'string' || item.path.length > 2000 || safeAppPath(item.path, '') !== item.path) throw new Error(`${path}.path 必须是规范的应用内部路径`);
    for (const key of ['width', 'height']) if (item[key] !== undefined && (!Number.isInteger(item[key]) || item[key] < 240 || item[key] > 2000)) throw new Error(`${path}.${key} 必须是 240–2000 的整数`);
    ids.add(item.id); return { id: item.id, title: item.title, path: item.path, ...(item.width === undefined ? {} : { width: item.width }), ...(item.height === undefined ? {} : { height: item.height }) };
  });
}
export interface DesktopMessage { protocol: typeof DESKTOP_PROTOCOL; windowId: string; type: string; requestId?: string; payload?: Record<string, unknown>; }
export function isDesktopMessage(value: unknown): value is DesktopMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return v.protocol === DESKTOP_PROTOCOL && typeof v.windowId === 'string' && v.windowId.length <= 100
    && typeof v.type === 'string' && v.type.length <= 64
    && (v.requestId === undefined || typeof v.requestId === 'string' && v.requestId.length <= 100)
    && (v.payload === undefined || !!v.payload && typeof v.payload === 'object' && !Array.isArray(v.payload));
}
/** 持久化只保留业务路径及明确的界面参数，过滤认证参数和 URL fragment。 */
export function safeAppPath(input: unknown, fallback = '/'): string {
  if (typeof input !== 'string' || input.length > 2000 || !input.startsWith('/') || input.startsWith('//') || /[\\\r\n]/.test(input)) return fallback;
  try {
    const url = new URL(input, 'https://desktop.invalid');
    if (url.origin !== 'https://desktop.invalid' || /(?:^|\/)\.\.(?:\/|$)/.test(decodeURIComponent(input.split('?')[0]!))) return fallback;
    const query = new URLSearchParams();
    for (const key of ['tab', 'module', 'view']) { const value = url.searchParams.get(key); if (value && /^[\w-]{1,80}$/.test(value)) query.set(key, value); }
    // 文件入口仅传资源 ID，服务端仍会校验文件所有者。
    const fileId = url.searchParams.get('open');
    if (fileId && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(fileId)) query.set('open', fileId);
    const intent = url.searchParams.get('intent');
    if (intent && ['new-folder', 'upload', 'rename', 'move'].includes(intent)) query.set('intent', intent);
    return url.pathname + (query.size ? `?${query}` : '');
  } catch { return fallback; }
}
export function appAllowsPath(app: DesktopApp, path: string): boolean {
  const pathname = safeAppPath(path).split('?')[0]!;
  return app.allowedPaths.some(prefix => pathname === prefix || prefix !== '/' && pathname.startsWith(`${prefix}/`));
}
