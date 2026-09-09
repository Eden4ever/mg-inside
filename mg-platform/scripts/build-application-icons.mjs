import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

// 固定版本官方包只用于构建；运行时不依赖图标 CDN。
const archive = process.argv[2];
if (!archive) throw new Error('请提供 lucide-static@1.43.0 的 npm 包路径。');
const directory = new URL('../packages/frontend/assets/app-icons/', import.meta.url);
const catalog = JSON.parse(readFileSync(new URL('../packages/frontend/config/application-catalog.json', import.meta.url), 'utf8'));
// 应用只能选择色板名，不注入 CSS、渐变参数或 SVG。
const palettes = {
  green: ['#2dcc65', '#12ad46'], orange: ['#ffb13e', '#f58916'], gold: ['#ffda47', '#e8b829'],
  blue: ['#5198df', '#3475bf'], sky: ['#68a6cf', '#4b82ac'],
  violet: ['#9274d7', '#7353bd'], indigo: ['#7a7dce', '#565ab0'],
  lavender: ['#aa92d4', '#8068b0'], teal: ['#54a997', '#318475'],
  'slate-blue': ['#7a98c4', '#536fa0'], ocean: ['#72a4ad', '#477b85'],
  slate: ['#9ba9ba', '#718095'], neutral: ['#c5cdd8', '#a8b4c4'],
};
const icons = Object.fromEntries(Object.entries(catalog.applications).map(([id, app]) => [id, app.icon]));
for (const [id, icon] of Object.entries(catalog.shellIcons)) {
  if (Object.hasOwn(icons, id)) throw new Error(`图标 ID 重复：${id}`);
  icons[id] = icon;
}
const read = path => execFileSync('tar', ['-xOf', archive, `package/${path}`], { encoding: 'utf8' });
const metadata = JSON.parse(read('package.json'));
if (metadata.name !== 'lucide-static' || metadata.version !== '1.43.0') throw new Error('图标包版本不匹配。');
writeFileSync(new URL('LICENSE-lucide.txt', directory), read('LICENSE'));
const manifest = {};
for (const [id, icon] of Object.entries(icons)) {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`图标 ID 无效：${id}`);
  if (!icon) continue;
  const { name: symbol, palette, image, imageViewport, badge } = icon;
  if (!/^[a-z0-9-]+$/.test(symbol) || !Object.hasOwn(palettes, palette)
    || Object.keys(icon).some(key => !['name', 'palette', 'image', 'imageViewport', 'badge'].includes(key))) throw new Error(`图标配置无效：${id}`);
  if (image !== undefined && (!/^[a-z0-9-]+\.(?:png|webp|svg)$/.test(image)
    || !existsSync(new URL(image, directory)) || Object.hasOwn(icons, image.replace(/\.svg$/, '')))) {
    throw new Error(`自定义图标必须是现有的本地图片资源键：${id}`);
  }
  if (imageViewport !== undefined && (!image || !Array.isArray(imageViewport) || imageViewport.length !== 4 || imageViewport.some(v => !Number.isFinite(v) || v < 0 || v > 100) || imageViewport[2] < 40 || imageViewport[3] < 40 || imageViewport[0] + imageViewport[2] > 100 || imageViewport[1] + imageViewport[3] > 100)) throw new Error(`图片可见边界配置无效：${id}`);
  if (badge !== undefined && !['console', 'docs'].includes(badge)) throw new Error(`子标识无效：${id}`);
  const original = read(`icons/${symbol}.svg`);
  const body = original.match(/<svg\b[^>]*>([\s\S]*?)<\/svg>/)?.[1];
  if (!body || /<script|<foreignObject|href=/i.test(body)) throw new Error(`SVG 内容无效：${symbol}`);
  const [top, bottom] = palettes[palette];
  // 64px 统一底板、15px 圆角与 16px 图形边界。渐变及内沿只作轻微层次。
  const mark = id === 'placeholder' ? '' : `<g transform="translate(16 16) scale(1.333333)" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</g>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><defs><linearGradient id="surface" x2="0.3" y2="1"><stop stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient><linearGradient id="inner" x2="0" y2="1"><stop stop-color="#fff" stop-opacity=".24"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#14253f" stop-opacity=".13"/></linearGradient></defs><rect width="64" height="64" rx="15" fill="url(#surface)"/><rect x=".75" y=".75" width="62.5" height="62.5" rx="14.25" fill="none" stroke="url(#inner)" stroke-width="1.5"/>${mark}</svg>\n`;
  writeFileSync(new URL(`${id}.svg`, directory), svg);
  manifest[id] = { src: `${id}.svg`, inset: 0, shape: 'original', symbol, palette, ...(badge ? { badge: `badge-${badge}.svg` } : {}), ...(image ? { image, ...(imageViewport ? { imageViewport } : {}) } : {}) };
}
for (const [badge, symbol] of [['console', 'sliders-horizontal'], ['docs', 'file-text']]) {
  const body = read(`icons/${symbol}.svg`).match(/<svg\b[^>]*>([\s\S]*?)<\/svg>/)?.[1];
  writeFileSync(new URL(`badge-${badge}.svg`, directory), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><linearGradient id="badge" x2="0" y2="1"><stop stop-color="#fff"/><stop offset="1" stop-color="#d9efff"/></linearGradient></defs><rect x="1" y="1" width="30" height="30" rx="8" fill="url(#badge)" stroke="#8bc5ee"/><g transform="translate(6 6) scale(.833333)" fill="none" stroke="#1764a4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>\n`);
}
const assetFiles = [...new Set(Object.values(manifest).flatMap(icon => [icon.src, icon.image, icon.badge].filter(Boolean)))];
const registry = assetFiles.map((file, index) => `import asset${index} from './${file}?url';`).join('\n') + '\nexport default {\n' + assetFiles.map((file, index) => `  '${file}': asset${index},`).join('\n') + '\n} as Readonly<Record<string, string>>;\n';
writeFileSync(new URL('registry.ts', directory), registry);
writeFileSync(new URL('manifest.json', directory), JSON.stringify(manifest, null, 2) + '\n');
console.log(`已从公共目录生成 ${Object.keys(manifest).length} 个统一图标。`);
