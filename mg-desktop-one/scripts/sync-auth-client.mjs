import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
const workspace = resolve(import.meta.dirname, '../..');
const canonical = resolve(workspace, 'mg-auth-one-identity/clients/unified-client.ts');
const targets = [
  'mg-token-one/mg-gateway/apps/gateway/src/modules/auth/unified-client.ts',
  'mg-expert-database/apps/api/src/unified-client.ts',
  'mg-desktop-one/apps/server/src/unified-client.ts',
  'mg-files-one/server/unified-client.ts',
];
const source = await readFile(canonical, 'utf8');
for (const target of targets) {
  const path = resolve(workspace, target);
  if (process.argv.includes('--check')) {
    if (await readFile(path, 'utf8') !== source) throw new Error(`认证客户端未同步：${target}`);
  } else { await mkdir(dirname(path), { recursive: true }); await writeFile(path, source); }
}
console.log(process.argv.includes('--check') ? '认证客户端副本一致。' : '认证客户端已同步到所有接入应用。');
