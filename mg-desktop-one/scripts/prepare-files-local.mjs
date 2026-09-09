import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
const runtime = resolve(import.meta.dirname, '../.runtime/local');
const identityEnv = await readFile(resolve(runtime, 'identity.env'), 'utf8');
if (!identityEnv.includes('15439') || !identityEnv.includes('mg_desktop_local_identity')) throw new Error('仅允许本地隔离认证环境');
const path = resolve(runtime, 'identity.json');
const config = JSON.parse(await readFile(path, 'utf8'));
let client = config.clients.find(item => item.client_id === 'files');
if (!client) {
  client = { client_id: 'files', client_name: '文件', client_secret: randomBytes(32).toString('hex'), redirect_uris: ['http://127.0.0.1:14350/api/auth/sso/callback'] };
  config.clients.push(client);
  await writeFile(path, JSON.stringify(config, null, 2));
}
await writeFile(resolve(runtime, 'files.env'), [
  'IDENTITY_ISSUER=http://127.0.0.1:14200', 'IDENTITY_CLIENT_ID=files', `IDENTITY_CLIENT_SECRET=${client.client_secret}`,
  'IDENTITY_ENABLED=true', 'IDENTITY_TOKEN_MODE=unified', 'FILES_PORT=14350',
  'DESKTOP_ORIGIN=http://127.0.0.1:4301', 'HOST=127.0.0.1', '',
].join('\n'));
console.log('本地文件应用凭据已配置，未输出密钥。');
