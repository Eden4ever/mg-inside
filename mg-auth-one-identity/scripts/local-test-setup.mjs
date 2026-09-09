import { randomBytes, generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const privateDir = path.resolve(root, 'private/service-test');
let exists = false;
try { execFileSync('docker', ['container', 'inspect', 'mg-identity-service-test-db'], { stdio: 'ignore' }); exists = true; } catch {}
if (exists) throw new Error('专用测试容器已存在，请先停止；不会覆盖现有测试密钥');
await fs.mkdir(privateDir, { recursive: true });
const password = randomBytes(32).toString('hex');
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = privateKey.export({ format: 'jwk' }); Object.assign(jwk, { kid: randomBytes(8).toString('hex'), use: 'sig', alg: 'RS256' });
const clients = ['token-one', 'expert-database'].map((client_id, i) => ({ client_id, client_secret: randomBytes(32).toString('hex'),
  redirect_uris: [`http://127.0.0.1:${18881 + i}/callback`] }));
await fs.writeFile(path.join(privateDir, 'identity.json'), JSON.stringify({ jwks: { keys: [jwk] }, cookieKeys: [randomBytes(32).toString('hex')], clients }), { mode: 0o600 });
await fs.writeFile(path.join(privateDir, 'postgres.env'), `POSTGRES_DB=identity_test\nPOSTGRES_USER=identity_test\nPOSTGRES_PASSWORD=${password}\n`, { mode: 0o600 });
await fs.writeFile(path.join(privateDir, 'service.env'), `DATABASE_URL=postgresql://identity_test:${password}@127.0.0.1:15439/identity_test\nIDENTITY_ISSUER=http://127.0.0.1:4200\nIDENTITY_SECRETS_FILE=${path.join(privateDir, 'identity.json').replaceAll('\\', '/')}\nAUTH_CONFIG_KEY_FILE=${path.join(privateDir, 'auth-config.key').replaceAll('\\', '/')}\nWECOM_LOGIN_ENABLED=false\n`, { mode: 0o600 });
execFileSync('docker', ['run', '--detach', '--rm', '--name', 'mg-identity-service-test-db', '--env-file', path.join(privateDir, 'postgres.env'), '-p', '127.0.0.1:15439:5432', 'postgres:17-alpine'], { stdio: 'inherit' });
let ready = false;
for (let attempt = 0; attempt < 40; attempt++) {
  try {
    // 指定 TCP，避免 PostgreSQL 初始化期间临时 Unix socket 被误判为就绪。
    execFileSync('docker', ['exec', 'mg-identity-service-test-db', 'pg_isready', '-h', '127.0.0.1', '-U', 'identity_test', '-d', 'identity_test'], { stdio: 'ignore' });
    ready = true; break;
  } catch { await new Promise(resolve => setTimeout(resolve, 500)); }
}
if (!ready) throw new Error('专用测试数据库未及时就绪');
