import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const workspace = resolve(root, '..');
const identityRoot = resolve(workspace, 'mg-auth-one-identity');
const requireIdentity = createRequire(resolve(identityRoot, 'package.json'));
const { PrismaClient } = requireIdentity('@prisma/client');
const { hashPassword } = requireIdentity('./dist/password.js');
const ts = requireIdentity('typescript');
const runtime = resolve(root, '.runtime/p0');
await mkdir(runtime, { recursive: true });
const env = parseEnv(await readFile(resolve(identityRoot, 'private/service-test/service.env'), 'utf8'));
if (!env.DATABASE_URL?.includes('127.0.0.1:15439/identity_test')) throw new Error('P0 验证仅允许专用身份测试库');
const secrets = JSON.parse(await readFile(env.IDENTITY_SECRETS_FILE, 'utf8'));
const suffix = randomBytes(8).toString('hex');
const desktopId = `desktop-p0-${suffix}`;
const freePort = await new Promise((resolvePort, reject) => {
  const server = createServer(); server.on('error', reject);
  server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolvePort(port)); });
});
const origin = `http://127.0.0.1:${freePort}`;
const desktop = { client_id: desktopId, client_secret: randomBytes(32).toString('hex'), redirect_uris: ['http://127.0.0.1:14300/auth/callback'] };
secrets.clients = [...secrets.clients.filter(c => ['token-one', 'expert-database'].includes(c.client_id)), desktop];
assert.equal(secrets.clients.length, 3);
const secretsPath = resolve(runtime, `identity-${suffix}.json`);
const fixturePath = resolve(runtime, `fixture-${suffix}.json`);
await writeFile(secretsPath, JSON.stringify(secrets), { mode: 0o600 });
await writeFile(resolve(runtime, 'unified-client.cjs'), ts.transpileModule(await readFile(resolve(identityRoot, 'clients/unified-client.ts'), 'utf8'),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText);
const { UnifiedIdentityClient } = createRequire(import.meta.url)(resolve(runtime, 'unified-client.cjs'));
const client = c => new UnifiedIdentityClient({ issuer: origin, clientId: c.client_id, clientSecret: c.client_secret });
const desktopClient = client(desktop);
const tokenClient = client(secrets.clients.find(c => c.client_id === 'token-one'));
const expertClient = client(secrets.clients.find(c => c.client_id === 'expert-database'));
const prisma = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
let server, user;
const report = { stage: 'P0', startedAt: new Date().toISOString(), checks: [], passed: false };
const record = message => { report.checks.push(message); console.log(message); };
const processOptions = { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] };
let serverOutput = '';
async function run(cmd, args, cwd, extraEnv = {}) {
  const child = spawn(cmd, args, { ...processOptions, cwd, env: { ...process.env, ...extraEnv } });
  let output = ''; child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
  const code = await new Promise((resolveCode, reject) => { child.once('error', reject); child.once('exit', resolveCode); });
  if (code !== 0) throw new Error(`业务验证失败（${cwd}）：${output.slice(-7000)}`);
  console.log(output.trim());
}
try {
  server = spawn(process.execPath, ['dist/main.js'], { ...processOptions, cwd: identityRoot,
    env: { ...process.env, ...env, PORT: String(freePort), IDENTITY_ISSUER: origin, IDENTITY_SECRETS_FILE: secretsPath,
      IDENTITY_DESKTOP_CLIENT_ID: desktopId, NODE_ENV: 'development' } });
  server.stdout.on('data', d => { serverOutput += d; }); server.stderr.on('data', d => { serverOutput += d; });
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw new Error('测试认证进程退出：' + serverOutput.slice(-2000));
    try { const response = await fetch(`${origin}/health`); if (response.ok && (await response.json()).issuer === origin) { ready = true; break; } } catch {}
    await new Promise(r => setTimeout(r, 150));
  }
  assert.ok(ready, '测试认证服务未就绪');
  const password = randomBytes(24).toString('base64url');
  user = await prisma.user.create({ data: { username: `desktop-${suffix}`, displayName: `统一桌面测试-${suffix}`, passwordHash: await hashPassword(password), role: 'member' } });
  for (const c of secrets.clients.filter(c => c.client_id !== desktopId)) await prisma.applicationUser.create({ data: { clientId: c.client_id, userId: user.id, enabled: true } });
  const login = await fetch(`${origin}/api/auth/login`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: user.username, password }) });
  assert.equal(login.status, 200);
  const logged = await login.json();
  const cookie = login.headers.getSetCookie().find(c => c.startsWith('mg_identity_session=')).split(';')[0];
  const token = decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1));
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  const centerMe = await fetch(`${origin}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(centerMe.status, 200); assert.equal((await centerMe.json()).user.userId, user.id);
  const profiles = await Promise.all([desktopClient.introspect(token), tokenClient.introspect(token), expertClient.introspect(token), desktopClient.introspect(token, 'identity')]);
  assert.ok(profiles.every(p => p.sub === user.id && p.sid === profiles[0].sid && p.csrfToken === logged.csrfToken));
  record('同一中心令牌通过桌面、身份管理、Token One 和知识库四方身份校验');
  const before = await prisma.authSession.count({ where: { userId: user.id } });
  assert.equal(before, 1);
  await assert.rejects(tokenClient.introspect(token, 'expert-database'));
  await assert.rejects(expertClient.introspect(randomBytes(32).toString('base64url')));
  await assert.rejects(new UnifiedIdentityClient({ issuer: origin, clientId: desktopId, clientSecret: randomBytes(32).toString('hex') }).introspect(token));
  record('错误令牌、错误服务凭据和跨应用冒充查询均被拒绝');
  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(32).toString('base64url');
  const query = new URLSearchParams({ client_id: desktopId, redirect_uri: desktop.redirect_uris[0], state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
  const authorize = async cookieHeader => fetch(`${origin}/api/unified/authorize?${query}`, { redirect: 'manual', headers: cookieHeader ? { Cookie: cookieHeader } : {} });
  const unsigned = await authorize(); assert.equal(unsigned.status, 303); assert.ok(unsigned.headers.get('location').startsWith('/login?next='));
  const redirected = await authorize(cookie); assert.equal(redirected.status, 303);
  const callback = new URL(redirected.headers.get('location')); assert.equal(callback.searchParams.get('state'), state);
  assert.ok(!callback.href.includes(token));
  const code = callback.searchParams.get('code');
  await assert.rejects(desktopClient.exchange(code, randomBytes(32).toString('base64url'), desktop.redirect_uris[0]));
  await assert.rejects(desktopClient.exchange(code, verifier, 'https://untrusted.example/callback'));
  const exchanged = await Promise.allSettled([desktopClient.exchange(code, verifier, desktop.redirect_uris[0]), desktopClient.exchange(code, verifier, desktop.redirect_uris[0])]);
  assert.equal(exchanged.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(exchanged.find(r => r.status === 'fulfilled').value.token, token);
  query.set('redirect_uri', 'https://untrusted.example/callback'); assert.equal((await authorize(cookie)).status, 400);
  record('一次性登录返回码保持原令牌；PKCE、回调白名单、并发重放检查通过');
  const renewals = await Promise.all([desktopClient.renew(token), desktopClient.renew(token)]);
  assert.ok(renewals.every(r => r.token === token)); assert.equal(await prisma.authSession.count({ where: { userId: user.id } }), before);
  record('并发续期共用原令牌且未生成额外登录会话');
  const appIds = (await desktopClient.applications(token)).map(a => a.id);
  assert.deepEqual(appIds.sort(), ['expert-database', 'token-one']);
  await prisma.applicationUser.update({ where: { clientId_userId: { clientId: 'expert-database', userId: user.id } }, data: { enabled: false } });
  await assert.rejects(expertClient.introspect(token)); await tokenClient.introspect(token);
  await prisma.applicationUser.update({ where: { clientId_userId: { clientId: 'expert-database', userId: user.id } }, data: { enabled: true } });
  await prisma.user.update({ where: { id: user.id }, data: { status: 'disabled' } });
  await assert.rejects(tokenClient.introspect(token)); await assert.rejects(expertClient.introspect(token));
  await prisma.user.update({ where: { id: user.id }, data: { status: 'active' } });
  record('应用撤权即时拒绝对应应用，停用账号即时拒绝所有应用');
  const sessionRecord = await prisma.authSession.findUniqueOrThrow({ where: { id: profiles[0].sid } });
  await prisma.authSession.update({ where: { id: sessionRecord.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  await assert.rejects(desktopClient.introspect(token)); await assert.rejects(desktopClient.renew(token));
  await prisma.authSession.update({ where: { id: sessionRecord.id }, data: { expiresAt: sessionRecord.expiresAt } });
  await prisma.user.update({ where: { id: user.id }, data: { securityVersion: { increment: 1 } } });
  await assert.rejects(tokenClient.introspect(token)); await assert.rejects(expertClient.introspect(token));
  await prisma.user.update({ where: { id: user.id }, data: { securityVersion: sessionRecord.securityVersion } });
  record('过期令牌不能续期，账号安全版本变化使旧令牌失效');
  const fixture = { issuer: origin, token, subject: user.id, sid: profiles[0].sid, clients: secrets.clients };
  await writeFile(fixturePath, JSON.stringify(fixture), { mode: 0o600 });
  const businessEnv = { UNIFIED_P0_FIXTURE: fixturePath, UNIFIED_P0_STAGE: 'active' };
  const gatewayRoot = resolve(workspace, 'mg-token-one/mg-gateway/apps/gateway');
  const expertRoot = resolve(workspace, 'mg-expert-database/apps/api');
  const gatewayArgs = ['--env-file-if-exists=.env', '-r', 'ts-node/register', '-r', 'tsconfig-paths/register', '--test', 'test/unified-token.e2e.spec.ts'];
  const expertArgs = [resolve(expertRoot, 'node_modules/vitest/vitest.mjs'), 'run', 'test/unified-token.integration.spec.ts', '--maxWorkers=1'];
  await run(process.execPath, gatewayArgs, gatewayRoot, businessEnv);
  await run(process.execPath, expertArgs, expertRoot, businessEnv);
  record('真实 MySQL/PostgreSQL 业务认证通过，身份映射和历史权限额度保持，未签发业务会话');
  await tokenClient.revoke(token);
  for (const c of [desktopClient, tokenClient, expertClient]) await assert.rejects(c.introspect(token));
  assert.equal((await fetch(`${origin}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).status, 401);
  await run(process.execPath, gatewayArgs, gatewayRoot, { ...businessEnv, UNIFIED_P0_STAGE: 'revoked' });
  await run(process.execPath, expertArgs, expertRoot, { ...businessEnv, UNIFIED_P0_STAGE: 'revoked' });
  record('从 Token One 撤销后，中心、桌面、两业务真实认证入口均拒绝旧令牌');
  report.passed = true;
} finally {
  if (server && server.exitCode === null) { server.kill(); await new Promise(resolveExit => { if (server.exitCode !== null) resolveExit(); else server.once('exit', resolveExit); }); }
  if (user) { await prisma.applicationUser.deleteMany({ where: { userId: user.id } }); await prisma.user.delete({ where: { id: user.id } }); }
  await prisma.application.deleteMany({ where: { clientId: desktopId } });
  await prisma.oidcRecord.deleteMany({ where: { model: 'UnifiedCode', payload: { path: ['clientId'], equals: desktopId } } });
  await prisma.$disconnect();
  await unlink(secretsPath).catch(() => {}); await unlink(fixturePath).catch(() => {});
  report.finishedAt = new Date().toISOString();
  await writeFile(resolve(runtime, 'verification.json'), JSON.stringify(report, null, 2));
}
