import type { DesktopApp } from '../../../mg-platform/packages/frontend/desktop-contracts/src/index';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
if (process.env.NODE_ENV !== 'test') throw new Error('旧 Node 目录仅供隔离测试，运行服务请使用 Java 内核');
const presentation = JSON.parse(readFileSync(resolve(process.env.DESKTOP_CONFIG_FILE || '../mg-platform/packages/frontend/config/application-catalog.json'), 'utf8'));
if (typeof presentation.name !== 'string' || !presentation.name.trim() || presentation.name.length > 80) throw new Error('桌面名称配置无效');
export const desktopPresentation = { name: presentation.name.trim() };
// 基础入口明确列举；新增应用不会自动获得豁免。
export const essentialApplicationIds = new Set(['personal-center', 'files']);
export interface RegisteredApp extends DesktopApp { upstream: string; authorizationAppId?: string; allowedApiPaths?: string[]; requiredRole?: string; runtimePolicy?: Record<string, unknown>; }
function origin(name: string, fallback: string) {
  const url = new URL(process.env[name] || fallback);
  if (url.username || url.password || url.hash || url.search
    || (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)))) throw new Error(`${name} 配置无效`);
  return url.href.replace(/\/$/, '');
}
export const desktopOrigin = new URL(origin('DESKTOP_ORIGIN', 'http://127.0.0.1:4301')).origin;
export const identityOrigin = new URL(origin('IDENTITY_ISSUER', 'http://127.0.0.1:14200')).origin;
function filesUpstream() {
  const value = process.env.FILES_API_URL || 'http://127.0.0.1:14350/api';
  const url = new URL(value);
  if (url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname)
    && !url.username && !url.password && !url.hash && !url.search) return url.href.replace(/\/$/, '');
  return origin('FILES_API_URL', value);
}
function resourceUpstream() {
  const value = process.env.RESOURCE_API_URL || 'http://127.0.0.1:14370/api', url = new URL(value);
  if (url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname)
    && !url.username && !url.password && !url.hash && !url.search) return url.href.replace(/\/$/, '');
  return origin('RESOURCE_API_URL', value);
}
// 注意：这份清单不是运行目录的来源。Java 内核已替代生产 Node 桌面后端，平台应用注册的唯一来源是
// SERVICE_DATABASE_URL 指向的 desktop_applications 表，见 mg-platform-kernel/docs/application-registration.md。
// 这里保留的是旧 Node 实现，仅用于本地联调与跨语言对照验证；在此新增或修改应用不会影响线上目录，
// 线上变更必须走 `java -jar app.jar desktop-applications migrate <manifest.json>` 或受控的数据库变更流程。
export const registry: RegisteredApp[] = [
  { id: 'service-manager', name: '服务管理', description: '服务目录、API 出口与调用记录', icon: 'knowledge',
    entryUrl: origin('SERVICE_WEB_URL', 'http://127.0.0.1:14381'), upstream: `${identityOrigin}/api`,
    allowedApiPaths: ['/auth/me'], defaultPath: '/services', allowedPaths: ['/services','/activity','/register'], minWidth: 820, minHeight: 560 },
  { id: 'resource-manager', name: '资源管理', description: '资源池、服务器与应用部署状态', icon: 'knowledge',
    entryUrl: origin('RESOURCE_WEB_URL', 'http://127.0.0.1:14371'),
    upstream: resourceUpstream(),
    allowedApiPaths: ['/overview', '/resources'], defaultPath: '/pools',
    allowedPaths: ['/pools', '/servers', '/deployments', '/audit'], minWidth: 820, minHeight: 560 },
  { id: 'low-alt-cockpit', name: '低空驾驶舱', description: '区域低空运行总览、任务调度与空域监管', icon: 'knowledge',
    entryUrl: origin('LOW_ALT_COCKPIT_WEB_URL', 'https://lowalt.meta-gravity.com'),
    upstream: origin('LOW_ALT_COCKPIT_API_URL', 'https://lowalt.meta-gravity.com/cockpit/api'),
    allowedApiPaths: [], defaultPath: '/cockpit/', allowedPaths: ['/cockpit'],
    minWidth: 1024, minHeight: 640, defaultMaximized: true },
  { id: 'office-one', name: 'Office One', description: '在线文档、表格与演示文稿', icon: 'knowledge',
    entryUrl: origin('OFFICE_WEB_URL', 'http://127.0.0.1:14361'), upstream: `${filesUpstream()}/office`,
    allowedApiPaths: ['/status', '/documents', '/sessions'],
    defaultPath: '/documents', allowedPaths: ['/documents'], minWidth: 820, minHeight: 560 },
  { id: 'files', name: '文件', description: '个人文件与桌面', icon: 'knowledge',
    entryUrl: origin('FILES_WEB_URL', 'http://127.0.0.1:14351'), upstream: filesUpstream(),
    defaultPath: '/my-files', allowedPaths: ['/my-files', '/recent', '/favorites', '/trash', '/dialogs'], minWidth: 760, minHeight: 480 },
  { id: 'personal-center', name: '个人中心', description: '个人资料、账号安全与全局偏好', icon: 'personal',
    entryUrl: origin('PERSONAL_WEB_URL', 'http://127.0.0.1:14331'), upstream: `${identityOrigin}/api`, authorizationAppId: 'personal-center',
    allowedApiPaths: ['/auth/me', '/auth/change-password', '/auth/logout', '/account-security'],
    defaultPath: '/profile', allowedPaths: ['/profile', '/security', '/preferences', '/notifications'], minWidth: 680, minHeight: 480 },
  { id: 'app-manager', name: '应用管理', description: '管理个人外链应用', icon: 'knowledge',
    entryUrl: origin('APP_MANAGER_WEB_URL', 'http://127.0.0.1:14341'), upstream: `${identityOrigin}/api`, allowedApiPaths: ['/auth/me'],
    defaultPath: '/applications', allowedPaths: ['/applications'], minWidth: 760, minHeight: 480 },
  { id: 'expert-database', name: '指标知识库', description: '指标体系、依据材料与研究工作台', icon: 'knowledge',
    entryUrl: origin('EXPERT_WEB_URL', 'http://127.0.0.1:14321'), upstream: origin('EXPERT_API_URL', 'http://127.0.0.1:14320/api'),
    defaultPath: '/systems', allowedPaths: ['/systems', '/semantic-libraries', '/model-management', '/mail-settings', '/users', '/profile'],
    minWidth: 900, minHeight: 520, defaultMaximized: true },
  { id: 'token-one', name: 'Token One', description: '模型服务、API 调试与使用管理', icon: 'token',
    entryUrl: origin('TOKEN_WEB_URL', 'http://127.0.0.1:14311'), upstream: origin('TOKEN_API_URL', 'http://127.0.0.1:14310/api'),
    defaultPath: '/dashboard', allowedPaths: ['/dashboard', '/my-usage', '/playground'], minWidth: 700, minHeight: 480 },
  { id: 'token-one-console', name: 'Token One 控制台', description: '模型、用户、额度与网关管理', icon: 'token',
    entryUrl: origin('TOKEN_WEB_URL', 'http://127.0.0.1:14311'), upstream: origin('TOKEN_API_URL', 'http://127.0.0.1:14310/api'),
    defaultPath: '/admin/stats', allowedPaths: ['/admin'], minWidth: 900, minHeight: 520 },
  { id: 'token-one-docs', name: 'Token One 文档', description: '接入说明、接口文档与开发指南', icon: 'knowledge',
    entryUrl: origin('TOKEN_WEB_URL', 'http://127.0.0.1:14311'), upstream: origin('TOKEN_API_URL', 'http://127.0.0.1:14310/api'), allowedApiPaths: ['/auth/me/token-one-docs', '/public/models'],
    defaultPath: '/docs', allowedPaths: ['/docs'], minWidth: 760, minHeight: 480 },
  { id: 'identity', name: '统一身份', description: '账号安全与应用访问授权', icon: 'identity',
    requiredRole: 'system_admin',
    entryUrl: origin('IDENTITY_WEB_URL', identityOrigin), upstream: `${identityOrigin}/api`,
    defaultPath: '/', allowedPaths: ['/', '/admin', '/roles', '/applications', '/settings', '/access-denied'], minWidth: 680, minHeight: 480 },
];
for (const app of registry) {
  app.runtimePolicy = { apiMode: 'compatibility',
    ...(app.id === 'identity' ? { rolePointer: '/user/role' } : {}),
    ...(['token-one-console','token-one-docs'].includes(app.id) ? { versionOwnerAppId: 'token-one' } : {}),
    ...(app.id === 'token-one-console' ? { rolePath: '/auth/me/token-one-console' } : {}),
    ...(app.id === 'token-one-docs' ? { allowedApiMethods: ['GET','HEAD'] } : {}) };
  const display = presentation.applications?.[app.id];
  if (!display || typeof display.name !== 'string' || !display.name.trim() || display.name.length > 80 || typeof display.description !== 'string') throw new Error(`应用展示配置无效：${app.id}`);
  app.name = display.name.trim(); app.description = display.description;
  app.kind = essentialApplicationIds.has(app.id) ? 'default' : ['app-manager', 'identity','service-manager'].includes(app.id) ? 'system' : 'internal';
}
export const allowedOrigins = new Set([desktopOrigin, ...registry.map(app => new URL(app.entryUrl).origin)]);
export function publicApp({ upstream: _upstream, authorizationAppId: _authorizationAppId, allowedApiPaths: _allowedApiPaths, requiredRole: _requiredRole, runtimePolicy: _runtimePolicy, ...app }: RegisteredApp): DesktopApp { return app; }
export function allowsApiPath(app: RegisteredApp, path: string): boolean {
  if (!app.allowedApiPaths) return true;
  try {
    const normalized = decodeURIComponent(new URL(path, 'https://application.invalid').pathname);
    if (!/^\/[A-Za-z0-9/_-]*$/.test(normalized)) return false;
    return app.allowedApiPaths.some(prefix => normalized === prefix || normalized.startsWith(`${prefix}/`));
  } catch { return false; }
}
