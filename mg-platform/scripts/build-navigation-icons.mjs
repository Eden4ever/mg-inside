import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
const archive = process.argv[2];
if (!archive) throw new Error('请提供 lucide-static@1.43.0 包路径');
const names = ['square','user-round','lock-keyhole','settings','bell','folder','monitor','clock','star','trash-2','layout-grid','chart-no-axes-combined','cable','box','users-round','key-round','file-text','messages-square','wallet','gauge','send','book-open','book-open-text','shield-check','server','chevron-left','chevron-right','panel-left-close','panel-left-open'];
const output = new URL('../packages/frontend/icons/', import.meta.url);
mkdirSync(output, { recursive: true });
const symbols = {};
for (const name of names) {
  const svg = execFileSync('tar', ['-xOf', archive, `package/icons/${name}.svg`], { encoding: 'utf8' });
  symbols[name] = [...svg.matchAll(/<(path|circle|rect|line|polyline|polygon|ellipse)\s+([^>]*?)\s*\/>/g)].map(([, tag, attributes]) => [tag, Object.fromEntries([...attributes.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]))]);
  if (!symbols[name].length) throw new Error(`未识别图标 ${name}`);
}
writeFileSync(new URL('lucide.json', output), JSON.stringify(symbols, null, 2) + '\n');
