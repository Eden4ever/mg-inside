import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadApplicationConfig } from '../packages/frontend/config/application.ts';

const registry = { components: ['profile', 'security'], icons: ['user-round', 'lock-keyhole'] };
const valid = () => ({ schemaVersion: 1, layout: 'standard', appId: 'sample', name: '示例应用', defaultPath: '/profile', brand: { name: '示例', icon: 'user-round' }, header: { showTitle: true }, pages: [
  { id: 'profile', path: '/profile', title: '个人资料', component: 'profile', icon: 'user-round' },
  { id: 'security', path: '/security', title: '账号安全', component: 'security', icon: 'lock-keyhole' },
], navigation: { mode: 'flat', defaultCollapsed: true, pageIds: ['profile', 'security'] } });

test('JSON 文本与导入对象可加载，返回独立数据且保留配置顺序', () => {
  const source = valid(), result = loadApplicationConfig(JSON.stringify(source), registry);
  assert.deepEqual(result, source);
  const fromObject = loadApplicationConfig(source, registry);
  fromObject.navigation.pageIds.reverse();
  assert.deepEqual(source.navigation.pageIds, ['profile', 'security']);
  assert.throws(() => loadApplicationConfig('{', registry), /应用配置 \$：JSON 格式无效/);
});

test('三种模式边界明确，支持分组与严格两级树', () => {
  for (const navigation of [
    { mode: 'grouped', defaultCollapsed: true, groups: [{ id: 'me', label: '我的账号', pageIds: ['profile', 'security'] }] },
    { mode: 'tree', defaultCollapsed: true, parents: [{ id: 'me', label: '我的账号', icon: 'user-round', children: ['profile', 'security'] }] },
  ]) assert.deepEqual(loadApplicationConfig({ ...valid(), navigation }, registry).navigation, navigation);
  assert.throws(() => loadApplicationConfig({ ...valid(), navigation: { mode: 'flat', defaultCollapsed: true, pageIds: ['profile'], groups: [] } }, registry), /\$\.navigation.groups.*未知字段/);
  assert.throws(() => loadApplicationConfig({ ...valid(), navigation: { mode: 'tree', defaultCollapsed: true, parents: [{ id: 'nested', label: '错误嵌套', icon: 'user-round', children: [{ id: 'profile' }] }] } }, registry), /parents\[0\].children\[0\]/);
});

test('阅读布局与标准布局分开，reading 不伪装成导航模式', () => {
  const reading = valid(); reading.layout = 'reading'; delete reading.navigation;
  assert.equal(loadApplicationConfig(reading, registry).layout, 'reading');
  assert.equal(loadApplicationConfig(reading, registry).navigation, undefined);
  assert.throws(() => loadApplicationConfig({ ...valid(), layout: 'reading' }, registry), /navigation.*业务内容目录/);
  const standard = valid(); delete standard.navigation;
  assert.throws(() => loadApplicationConfig(standard, registry), /\$\.navigation/);
  const wrong = valid(); wrong.navigation.mode = 'reading';
  assert.throws(() => loadApplicationConfig(wrong, registry), /navigation.mode.*flat.*grouped.*tree/);
});

test('未知字段、缺失字段及错误版本均报中文路径，不能注入权限或凭据', () => {
  const cases = [
    [value => { value.token = 'secret'; }, /\$\.token.*未知字段/],
    [value => { value.header.showTtile = true; }, /\$\.header.showTtile.*未知字段/],
    [value => { value.pages[0].roles = ['admin']; }, /\$\.pages\[0\].roles.*未知字段/],
    [value => { delete value.name; }, /\$\.name.*缺少必填/],
    [value => { value.schemaVersion = 2; }, /\$\.schemaVersion.*仅支持版本 1/],
    [value => { value.navigation.defaultCollapsed = 'true'; }, /defaultCollapsed.*布尔值/],
    [value => { value.brand.name = ' '; }, /\$\.brand.name/],
  ];
  for (const [mutate, expected] of cases) { const input = valid(); mutate(input); assert.throws(() => loadApplicationConfig(input, registry), expected); }
  const input = valid(); Object.setPrototypeOf(input, { injected: true });
  assert.throws(() => loadApplicationConfig(input, registry), /普通 JSON 对象/);
});

test('页面与图标只接受白名单，路由拒绝外链、查询凭据与路径穿越', () => {
  for (const path of ['https://evil.example', '//evil.example', '/../secret', '/profile?token=a', '/profile#code', '/:any']) {
    const input = valid(); input.pages[0].path = path;
    assert.throws(() => loadApplicationConfig(input, registry), /\$\.pages\[0\].path/);
  }
  const input = valid(); input.pages[0].component = 'unregistered';
  assert.throws(() => loadApplicationConfig(input, registry), /component.*未在应用白名单注册表中注册/);
  input.pages[0].component = '../Remote.vue';
  assert.throws(() => loadApplicationConfig(input, registry), /\$\.pages\[0\].component/);
  const other = valid(); other.pages[0].icon = 'missing';
  assert.throws(() => loadApplicationConfig(other, registry), /icon.*未在应用白名单注册表中注册/);
});

test('默认页、导航引用与重复页面、分组 ID 有交叉校验', () => {
  const cases = [
    [value => { value.defaultPath = '/missing'; }, /defaultPath.*已声明/],
    [value => { value.navigation.pageIds = ['missing']; }, /pageIds\[0\].*不存在/],
    [value => { value.navigation.pageIds = ['profile', 'profile']; }, /pageIds\[1\].*重复引用/],
    [value => { value.pages[1].id = 'profile'; }, /pages.id.*重复值/],
    [value => { value.pages[1].path = '/profile'; }, /pages.path.*重复值/],
    [value => { value.navigation = { mode: 'grouped', defaultCollapsed: true, groups: [{ id: 'same', label: '一', pageIds: ['profile'] }, { id: 'same', label: '二', pageIds: ['security'] }] }; }, /groups.id.*重复值/],
    [value => { value.navigation = { mode: 'tree', defaultCollapsed: true, parents: [{ id: 'first', label: '一', icon: 'user-round', children: ['profile'] }, { id: 'second', label: '二', icon: 'lock-keyhole', children: ['profile'] }] }; }, /children\[0\].*重复引用/],
  ];
  for (const [mutate, expected] of cases) { const input = valid(); mutate(input); assert.throws(() => loadApplicationConfig(input, registry), expected); }
});

test('JSON Schema 提供三种互斥导航结构，全部对象拒绝未声明字段', () => {
  const schema = JSON.parse(readFileSync(new URL('../packages/frontend/config/application.schema.json', import.meta.url), 'utf8'));
  assert.equal(schema.properties.schemaVersion.const, 1);
  assert.deepEqual(schema.properties.navigation.oneOf.map(branch => branch.properties.mode.const), ['flat', 'grouped', 'tree']);
  function inspect(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'object') { assert.equal(node.additionalProperties, false); assert.ok(Array.isArray(node.required)); }
    for (const child of Object.values(node)) inspect(child);
  }
  inspect(schema);
  assert.deepEqual(schema.$defs.parent.properties.children.items, { $ref: '#/$defs/key' });
});

test('品牌图片、页签与显示项兼容旧配置，资源只引用注册键', () => {
  const input = valid();
  input.brand = { ...input.brand, logo: { src: 'company', darkSrc: 'companyDark', alt: '企业 Logo' }, favicon: 'appIcon', homePath: '/security' };
  input.header = { showTitle: true, showBrand: false, showAccount: false };
  input.browser = { titleTemplate: '{title} | {name}' };
  input.pages[0].description = '账号的基础信息';
  const resources = { ...registry, assets: ['company', 'companyDark', 'appIcon'] };
  assert.deepEqual(loadApplicationConfig(input, resources), input);
  assert.throws(() => loadApplicationConfig(input, registry), /brand.logo.src.*图片资源.*未在应用白名单/);
  for (const src of ['https://external.example/logo.svg', 'data:image/svg+xml,hi', '../logo.svg']) {
    assert.throws(() => loadApplicationConfig({ ...input, brand: { ...input.brand, logo: { src } } }, resources), /brand.logo.src/);
  }
  assert.throws(() => loadApplicationConfig({ ...input, brand: { ...input.brand, homePath: '/missing' } }, resources), /brand.homePath.*已声明/);
  assert.throws(() => loadApplicationConfig({ ...input, header: { ...input.header, showAccount: 'false' } }, resources), /header.showAccount.*布尔值/);
  assert.throws(() => loadApplicationConfig({ ...input, brand: { ...input.brand, logo: { src: 'company', onclick: 'run()' } } }, resources), /logo.onclick.*未知字段/);
});

test('页签标题模板只支持固定占位符', async () => {
  const { applicationDocumentTitle } = await import('../packages/frontend/config/document.ts');
  assert.equal(applicationDocumentTitle(valid(), '个人资料'), '个人资料 · 示例应用');
  const input = valid(); input.browser = { titleTemplate: '{name} / {title}' };
  assert.equal(applicationDocumentTitle(loadApplicationConfig(input, registry), '安全'), '示例应用 / 安全');
  for (const template of ['{code}', '{title', '固定且没有变量', '{title} {account.token}']) {
    assert.throws(() => loadApplicationConfig({ ...input, browser: { titleTemplate: template } }, registry), /browser.titleTemplate/);
  }
});


test('应用自定义图标注册表不能绕过公共 Lucide 白名单', () => {
  const registryOverride = { components: registry.components, icons: ['arbitrary-component'] };
  assert.equal(loadApplicationConfig(valid(), registryOverride).pages[0].icon, 'user-round');
  for (const area of ['page', 'brand', 'parent']) {
    const value = valid();
    if (area === 'page') value.pages[0].icon = 'arbitrary-component';
    if (area === 'brand') value.brand.icon = 'arbitrary-component';
    if (area === 'parent') value.navigation = { mode: 'tree', defaultCollapsed: true, parents: [{ id: 'root', label: '目录', icon: 'arbitrary-component', children: ['profile'] }] };
    assert.throws(() => loadApplicationConfig(value, registryOverride), /图标键 arbitrary-component.*未在应用白名单/);
  }
});
