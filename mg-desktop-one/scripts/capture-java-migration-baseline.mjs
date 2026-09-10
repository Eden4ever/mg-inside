import { readdir, readFile, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { createHash } from 'node:crypto';

// 只归档源码、锁文件和公开部署定义，不读取运行数据或机密配置。
const root = resolve(import.meta.dirname, '..');
const release = new Date().toISOString().replaceAll(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const output = join(root, '.runtime', 'java-migration-baselines', release);
await mkdir(join(root, '.runtime', 'java-migration-baselines'), { recursive: true });
await mkdir(output, { recursive: false });
const entries = [];
async function copy(source, destination) {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (['node_modules', 'target', '.runtime', 'dist', '__pycache__'].includes(entry.name)) continue;
    const path = join(source, entry.name), target = join(destination, entry.name);
    if (entry.isDirectory()) await copy(path, target);
    else if (entry.isFile() && !entry.name.endsWith('.env')) {
      const bytes = await readFile(path);
      entries.push({ path: relative(output, target).replaceAll('\\', '/'), sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length });
      await copyFile(path, target);
    }
  }
}
for (const folder of ['apps/server', 'apps/web/src', 'docs']) await copy(join(root, folder), join(output, folder));
await copy(resolve(root, '../mg-platform/packages/frontend/services'), join(output, 'platform-services'));
for (const file of ['package.json', 'package-lock.json', 'deploy/compose.yaml', 'deploy/desktop.Dockerfile']) {
  const bytes = await readFile(join(root, file));
  const target = join(output, file);
  await mkdir(resolve(target, '..'), { recursive: true });
  await writeFile(target, bytes, { flag: 'wx' });
  entries.push({ path: file, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length });
}
await writeFile(join(output, 'manifest.json'), JSON.stringify({ capturedAt: new Date().toISOString(), entries }, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ output, files: entries.length }));
