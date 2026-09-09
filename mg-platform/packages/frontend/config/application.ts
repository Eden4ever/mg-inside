import symbols from '../icons/lucide.json' with { type: 'json' };
/** JSON 只声明界面结构；身份凭据、后端授权和可执行代码不属于应用配置。 */
export interface ApplicationPageConfig { id: string; path: string; title: string; description?: string; component: string; icon: string }
export interface ApplicationBrandConfig { name: string; icon?: string; description?: string; homePath?: string; logo?: { src: string; darkSrc?: string; alt?: string }; favicon?: string }
export interface ApplicationNavigationGroupConfig { id: string; label: string; pageIds: string[] }
export interface ApplicationNavigationParentConfig { id: string; label: string; icon: string; children: string[] }
export type ApplicationNavigationConfig = { defaultCollapsed: boolean } & (
  { mode: 'flat'; pageIds: string[] } |
  { mode: 'grouped'; groups: ApplicationNavigationGroupConfig[] } |
  { mode: 'tree'; parents: ApplicationNavigationParentConfig[] }
);
export interface ApplicationConfigBase {
  $schema?: string;
  schemaVersion: 1;
  appId: string;
  name: string;
  defaultPath: string;
  brand: ApplicationBrandConfig;
  header: { showTitle: boolean; showBrand?: boolean; showAccount?: boolean };
  browser?: { titleTemplate: string };
  pages: ApplicationPageConfig[];
}
export type ApplicationConfig = ApplicationConfigBase & ({ layout: 'standard'; navigation: ApplicationNavigationConfig } | { layout: 'reading'; navigation?: never });
export interface ApplicationRegistryKeys { components: readonly string[]; icons?: readonly string[]; assets?: readonly string[] }
const keyPattern = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const pathPattern = /^\/(?:[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*)?$/;
function fail(path: string, message: string): never { throw new Error(`应用配置 ${path}：${message}`); }
function object(value: unknown, path: string, allowed: string[], required = allowed): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(path, '必须是普通 JSON 对象');
  const result = value as Record<string, unknown>;
  for (const key of Object.keys(result)) if (!allowed.includes(key)) fail(`${path}.${key}`, '未知字段，请检查拼写');
  for (const key of required) if (!Object.hasOwn(result, key)) fail(`${path}.${key}`, '缺少必填字段');
  return result;
}
function text(value: unknown, path: string, max = 120, pattern?: RegExp): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || (pattern && !pattern.test(value))) fail(path, `必须是有效的非空字符串，最长 ${max} 字符${pattern ? '，且符合字段格式' : ''}`);
  return value;
}
function bool(value: unknown, path: string): boolean { if (typeof value !== 'boolean') fail(path, '必须是布尔值'); return value; }
function list(value: unknown, path: string, max: number, min = 1): unknown[] { if (!Array.isArray(value) || value.length < min || value.length > max) fail(path, `必须是包含 ${min} 至 ${max} 项的数组`); return value; }
function unique(values: string[], path: string) { const seen = new Set<string>(); values.forEach((value, index) => { if (seen.has(value)) fail(`${path}[${index}]`, `重复值 ${value}`); seen.add(value); }); }
function registered(key: string, keys: readonly string[], path: string, kind: string) { if (!keys.includes(key)) fail(path, `${kind}键 ${key} 未在应用白名单注册表中注册`); }

/** 输入可以是 JSON 文本或 JSON 导入对象；校验后返回不含可执行内容的独立数据。 */
export function loadApplicationConfig(input: unknown, registry: ApplicationRegistryKeys): ApplicationConfig {
  if (typeof input === 'string') { try { input = JSON.parse(input); } catch { fail('$', 'JSON 格式无效'); } }
  const root = object(input, '$', ['$schema', 'schemaVersion', 'appId', 'name', 'defaultPath', 'brand', 'header', 'browser', 'pages', 'layout', 'navigation'], ['schemaVersion', 'appId', 'name', 'defaultPath', 'brand', 'header', 'pages', 'layout']);
  if (root.schemaVersion !== 1) fail('$.schemaVersion', '仅支持版本 1');
  if (root.layout !== 'standard' && root.layout !== 'reading') fail('$.layout', '必须为 standard 或 reading');
  if (root.layout === 'reading' && Object.hasOwn(root, 'navigation')) fail('$.navigation', 'reading 阅读布局使用业务内容目录，不配置通用导航');
  const brand = object(root.brand, '$.brand', ['name', 'icon', 'description', 'homePath', 'logo', 'favicon'], ['name']);
  const header = object(root.header, '$.header', ['showTitle', 'showBrand', 'showAccount'], ['showTitle']);
  function asset(value: unknown, path: string) { const key = text(value, path, 64, keyPattern); registered(key, registry.assets || [], path, '图片资源'); return key; }
  let logo: ApplicationBrandConfig['logo'];
  if (brand.logo !== undefined) {
    const value = object(brand.logo, '$.brand.logo', ['src', 'darkSrc', 'alt'], ['src']);
    logo = { src: asset(value.src, '$.brand.logo.src'), ...(value.darkSrc !== undefined ? { darkSrc: asset(value.darkSrc, '$.brand.logo.darkSrc') } : {}), ...(value.alt !== undefined ? { alt: text(value.alt, '$.brand.logo.alt') } : {}) };
  }
  let browser: ApplicationConfigBase['browser'];
  if (root.browser !== undefined) {
    const value = object(root.browser, '$.browser', ['titleTemplate']);
    const template = text(value.titleTemplate, '$.browser.titleTemplate', 200);
    if (!/\{(?:title|name)\}/.test(template) || /[{}]/.test(template.replace(/\{(?:title|name)\}/g, ''))) fail('$.browser.titleTemplate', '模板仅允许 {title} 和 {name} 占位符，且至少包含一个');
    browser = { titleTemplate: template };
  }
  const pages = list(root.pages, '$.pages', 100).map((value, index): ApplicationPageConfig => {
    const path = `$.pages[${index}]`, page = object(value, path, ['id', 'path', 'title', 'description', 'component', 'icon'], ['id', 'path', 'title', 'component', 'icon']);
    const component = text(page.component, `${path}.component`, 64, keyPattern);
    registered(component, registry.components, `${path}.component`, '页面组件');
    const icon = text(page.icon, `${path}.icon`, 64, keyPattern);
    registered(icon, Object.keys(symbols), `${path}.icon`, '图标');
    return { id: text(page.id, `${path}.id`, 64, keyPattern), path: text(page.path, `${path}.path`, 240, pathPattern), title: text(page.title, `${path}.title`), ...(page.description !== undefined ? { description: text(page.description, `${path}.description`, 300) } : {}), component, icon };
  });
  unique(pages.map(page => page.id), '$.pages.id'); unique(pages.map(page => page.path), '$.pages.path');
  const defaultPath = text(root.defaultPath, '$.defaultPath', 240, pathPattern);
  if (!pages.some(page => page.path === defaultPath)) fail('$.defaultPath', '必须指向已声明的页面路径');
  const homePath = brand.homePath === undefined ? undefined : text(brand.homePath, '$.brand.homePath', 240, pathPattern);
  if (homePath !== undefined && !pages.some(page => page.path === homePath)) fail('$.brand.homePath', '必须指向已声明的页面路径');
  let normalizedNavigation: ApplicationNavigationConfig | undefined;
  if (root.layout === 'standard') {
    const navigationBase = object(root.navigation, '$.navigation', ['mode', 'defaultCollapsed', 'pageIds', 'groups', 'parents'], ['mode', 'defaultCollapsed']);
    if (!['flat', 'grouped', 'tree'].includes(navigationBase.mode as string)) fail('$.navigation.mode', '必须为 flat、grouped 或 tree');
    const mode = navigationBase.mode as ApplicationNavigationConfig['mode'];
    const navigation = object(root.navigation, '$.navigation', ['mode', 'defaultCollapsed', mode === 'flat' ? 'pageIds' : mode === 'grouped' ? 'groups' : 'parents']);
    const seenPages = new Set<string>();
    function pageIds(value: unknown, path: string) {
      return list(value, path, 100).map((value, index) => {
        const id = text(value, `${path}[${index}]`, 64, keyPattern);
        if (!pages.some(page => page.id === id)) fail(`${path}[${index}]`, `页面 ${id} 不存在`);
        if (seenPages.has(id)) fail(`${path}[${index}]`, `导航页面 ${id} 重复引用`);
        seenPages.add(id); return id;
      });
    }
    const defaultCollapsed = bool(navigation.defaultCollapsed, '$.navigation.defaultCollapsed');
    if (mode === 'flat') normalizedNavigation = { mode, defaultCollapsed, pageIds: pageIds(navigation.pageIds, '$.navigation.pageIds') };
    else if (mode === 'grouped') {
      const groups = list(navigation.groups, '$.navigation.groups', 30).map((value, index) => {
        const path = `$.navigation.groups[${index}]`, group = object(value, path, ['id', 'label', 'pageIds']);
        return { id: text(group.id, `${path}.id`, 64, keyPattern), label: text(group.label, `${path}.label`), pageIds: pageIds(group.pageIds, `${path}.pageIds`) };
      });
      unique(groups.map(group => group.id), '$.navigation.groups.id'); normalizedNavigation = { mode, defaultCollapsed, groups };
    } else {
      const parents = list(navigation.parents, '$.navigation.parents', 30).map((value, index) => {
        const path = `$.navigation.parents[${index}]`, parent = object(value, path, ['id', 'label', 'icon', 'children']);
        const icon = text(parent.icon, `${path}.icon`, 64, keyPattern); registered(icon, Object.keys(symbols), `${path}.icon`, '图标');
        return { id: text(parent.id, `${path}.id`, 64, keyPattern), label: text(parent.label, `${path}.label`), icon, children: pageIds(parent.children, `${path}.children`) };
      });
      unique(parents.map(parent => parent.id), '$.navigation.parents.id'); normalizedNavigation = { mode, defaultCollapsed, parents };
    }
  }
  const icon = brand.icon === undefined ? undefined : text(brand.icon, '$.brand.icon', 64, keyPattern);
  if (icon) registered(icon, Object.keys(symbols), '$.brand.icon', '图标');
  const result: ApplicationConfigBase = {
    ...(root.$schema !== undefined ? { $schema: text(root.$schema, '$.$schema', 500) } : {}),
    schemaVersion: 1, appId: text(root.appId, '$.appId', 64, keyPattern), name: text(root.name, '$.name'), defaultPath,
    brand: { name: text(brand.name, '$.brand.name'), ...(icon ? { icon } : {}), ...(brand.description !== undefined ? { description: text(brand.description, '$.brand.description', 240) } : {}), ...(homePath ? { homePath } : {}), ...(logo ? { logo } : {}), ...(brand.favicon !== undefined ? { favicon: asset(brand.favicon, '$.brand.favicon') } : {}) },
    header: { showTitle: bool(header.showTitle, '$.header.showTitle'), ...(header.showBrand !== undefined ? { showBrand: bool(header.showBrand, '$.header.showBrand') } : {}), ...(header.showAccount !== undefined ? { showAccount: bool(header.showAccount, '$.header.showAccount') } : {}) }, ...(browser ? { browser } : {}), pages,
  };
  return normalizedNavigation ? { ...result, layout: 'standard', navigation: normalizedNavigation } : { ...result, layout: 'reading' };
}
