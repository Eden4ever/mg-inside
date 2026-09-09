import { createRequire } from 'node:module';
import { parseEnv } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomBytes, generateKeyPairSync } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..'), workspace = resolve(root, '..');
const identityRoot = resolve(workspace, 'mg-auth-one-identity'), expertRoot = resolve(workspace, 'mg-expert-database');
const local = resolve(root, '.runtime/local'); await mkdir(local, { recursive: true });
const requireIdentity = createRequire(resolve(identityRoot, 'package.json'));
const source = parseEnv(await readFile(resolve(identityRoot, 'private/service-test/service.env'), 'utf8'));
const url = new URL(source.DATABASE_URL);
if (url.hostname !== '127.0.0.1' || url.port !== '15439' || url.pathname !== '/identity_test') throw new Error('只允许现有专用本地身份测试数据库');
url.searchParams.set('schema', 'mg_desktop_local_identity');
const identityUrl = url.href;
const identitySecretsPath = resolve(local, 'identity.json');
let secrets;
try { secrets = JSON.parse(await readFile(identitySecretsPath, 'utf8')); } catch (error) {
  if (error.code !== 'ENOENT') throw error;
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = privateKey.export({ format: 'jwk' }); Object.assign(jwk, { kid: randomBytes(8).toString('hex'), use: 'sig', alg: 'RS256' });
  secrets = { jwks: { keys: [jwk] }, cookieKeys: [randomBytes(32).toString('hex')], clients: ['token-one', 'expert-database', 'desktop-one'].map((client_id, i) => ({
    client_id, client_name: ['Token One', '指标知识库', '统一桌面'][i], client_secret: randomBytes(32).toString('hex'),
    redirect_uris: [client_id === 'desktop-one' ? 'http://127.0.0.1:4301/auth/callback' : `http://127.0.0.1:${14310 + i * 10}/api/auth/sso/callback`],
  })) };
  await writeFile(identitySecretsPath, JSON.stringify(secrets), { mode: 0o600 });
}
const identityEnv = { DATABASE_URL: identityUrl, IDENTITY_ISSUER: 'http://127.0.0.1:14200', IDENTITY_SECRETS_FILE: identitySecretsPath.replaceAll('\\','/'),
  AUTH_CONFIG_KEY_FILE: resolve(local, 'auth-config.key').replaceAll('\\','/'), DESKTOP_ORIGIN: 'http://127.0.0.1:4301', PORT: '14200', HOST: '127.0.0.1', WECOM_LOGIN_ENABLED: 'false', ZENTAO_ENABLED: 'false' };
function serialize(values) { return Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(String(value))}`).join('\n') + '\n'; }
await writeFile(resolve(local, 'identity.env'), serialize(identityEnv), { mode: 0o600 });
execFileSync(process.execPath, [requireIdentity.resolve('prisma/build/index.js'), 'db', 'push', '--skip-generate', '--schema', resolve(identityRoot, 'prisma/schema.prisma')],
  { cwd: identityRoot, env: { ...process.env, ...identityEnv }, windowsHide: true, stdio: 'pipe' });
const { PrismaClient } = requireIdentity('@prisma/client'); const db = new PrismaClient({ datasourceUrl: identityUrl });
let account;
try { account = JSON.parse(await readFile(resolve(local, 'account.json'), 'utf8')); } catch (error) {
  if (error.code !== 'ENOENT') throw error;
  account = { username: 'desktop-preview', password: randomBytes(24).toString('base64url') };
  await writeFile(resolve(local, 'account.json'), JSON.stringify(account), { mode: 0o600 });
}
try {
  const { hashPassword } = requireIdentity('./dist/password.js');
  const user = await db.user.upsert({ where: { username: account.username }, update: {}, create: {
    username: account.username, displayName: '桌面体验', passwordHash: await hashPassword(account.password), role: 'system_admin' } });
  for (const client of secrets.clients) {
    await db.application.upsert({ where: { clientId: client.client_id }, update: {}, create: { clientId: client.client_id, name: client.client_name } });
    await db.applicationUser.upsert({ where: { clientId_userId: { clientId: client.client_id, userId: user.id } }, update: {},
      create: { clientId: client.client_id, userId: user.id, enabled: true } });
  }
} finally { await db.$disconnect(); }
const desktopClient = secrets.clients.find(c => c.client_id === 'desktop-one');
const desktopEnv = { IDENTITY_ENABLED: 'true', IDENTITY_ISSUER: identityEnv.IDENTITY_ISSUER, IDENTITY_CLIENT_ID: desktopClient.client_id,
  IDENTITY_CLIENT_SECRET: desktopClient.client_secret, DESKTOP_ORIGIN: 'http://127.0.0.1:4301', PORT: '4300' };
await writeFile(resolve(local, 'desktop.env'), serialize(desktopEnv), { mode: 0o600 });
const expertSource = parseEnv(await readFile(resolve(expertRoot, '.env'), 'utf8'));
const expertUrl = new URL(expertSource.DATABASE_URL);
if (!['127.0.0.1', 'localhost'].includes(expertUrl.hostname) || expertUrl.port !== '5437') throw new Error('只允许本地知识库数据库');
expertUrl.searchParams.set('schema', 'mg_desktop_local_expert');
const expertClient = secrets.clients.find(c => c.client_id === 'expert-database');
const expertEnv = { DATABASE_URL: expertUrl.href, IDENTITY_ENABLED: 'true', IDENTITY_TOKEN_MODE: 'unified', IDENTITY_ISSUER: identityEnv.IDENTITY_ISSUER,
  IDENTITY_CLIENT_ID: expertClient.client_id, IDENTITY_CLIENT_SECRET: expertClient.client_secret, IDENTITY_REDIRECT_URI: expertClient.redirect_uris[0],
  IDENTITY_COOKIE_KEY: randomBytes(32).toString('hex'), DESKTOP_ORIGIN: desktopEnv.DESKTOP_ORIGIN, PORT: '14320', HOST: '127.0.0.1',
  WECOM_LOGIN_ENABLED: 'false', WEB_ORIGIN: 'http://127.0.0.1:14321', AUTH_CONFIG_KEY_FILE: resolve(local, 'expert-auth.key').replaceAll('\\','/') };
await writeFile(resolve(local, 'expert.env'), serialize(expertEnv), { mode: 0o600 });
const requireExpert = createRequire(resolve(expertRoot, 'apps/api/package.json'));
execFileSync(process.execPath, [requireExpert.resolve('prisma/build/index.js'), 'db', 'push', '--skip-generate', '--schema', resolve(expertRoot, 'apps/api/prisma/schema.prisma')],
  { cwd: expertRoot, env: { ...process.env, ...expertEnv }, windowsHide: true, stdio: 'pipe' });
const gatewayRoot = resolve(workspace, 'mg-token-one/mg-gateway/apps/gateway');
const gatewaySource = parseEnv(await readFile(resolve(gatewayRoot, '.env'), 'utf8'));
if (!['127.0.0.1', 'localhost'].includes(gatewaySource.DB_HOST || '127.0.0.1')) throw new Error('只允许本地模型网关数据库');
const mysql = createRequire(resolve(gatewayRoot, 'package.json'))('mysql2/promise');
const connection = await mysql.createConnection({ host: gatewaySource.DB_HOST || '127.0.0.1', port: Number(gatewaySource.DB_PORT || 13306), user: gatewaySource.DB_USERNAME || 'root', password: gatewaySource.DB_PASSWORD || '' });
await connection.query('CREATE DATABASE IF NOT EXISTS `mg_desktop_local_token` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'); await connection.end();
const tokenClient = secrets.clients.find(c => c.client_id === 'token-one');
const tokenEnv = { DB_HOST: gatewaySource.DB_HOST || '127.0.0.1', DB_PORT: gatewaySource.DB_PORT || '13306', DB_USERNAME: gatewaySource.DB_USERNAME || 'root',
  DB_PASSWORD: gatewaySource.DB_PASSWORD || '', DB_DATABASE: 'mg_desktop_local_token', DB_SYNCHRONIZE: 'true', NODE_ENV: 'development',
  IDENTITY_ENABLED: 'true', IDENTITY_TOKEN_MODE: 'unified', IDENTITY_ISSUER: identityEnv.IDENTITY_ISSUER, IDENTITY_CLIENT_ID: tokenClient.client_id,
  IDENTITY_CLIENT_SECRET: tokenClient.client_secret, IDENTITY_REDIRECT_URI: tokenClient.redirect_uris[0], IDENTITY_COOKIE_KEY: randomBytes(32).toString('hex'),
  DESKTOP_ORIGIN: desktopEnv.DESKTOP_ORIGIN, PORT: '14310', HOST: '127.0.0.1', JWT_SECRET: randomBytes(32).toString('hex'), ENCRYPTION_KEY: randomBytes(32).toString('hex') };
const tokenEnvPath = resolve(local, 'token.env');
try { const prior = parseEnv(await readFile(tokenEnvPath, 'utf8')); tokenEnv.ENCRYPTION_KEY = prior.ENCRYPTION_KEY || tokenEnv.ENCRYPTION_KEY; tokenEnv.JWT_SECRET = prior.JWT_SECRET || tokenEnv.JWT_SECRET; } catch (error) { if (error.code !== 'ENOENT') throw error; }
await writeFile(tokenEnvPath, serialize(tokenEnv), { mode: 0o600 });
await writeFile(resolve(local, 'web.env'), serialize({ VITE_DESKTOP_ORIGIN: desktopEnv.DESKTOP_ORIGIN, VITE_IDENTITY_TOKEN_MODE: 'unified', VITE_TOKEN_PROXY: 'http://127.0.0.1:14310' }));
console.log('独立本地体验环境已准备；凭据仅保存在 .runtime/local，未修改原应用数据库。');
