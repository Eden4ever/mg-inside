import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import assert from 'node:assert/strict';
const identityEnv = parseEnv(await readFile('.runtime/local/identity.env', 'utf8'));
const expertEnv = parseEnv(await readFile('.runtime/local/expert.env', 'utf8'));
const account = JSON.parse(await readFile('.runtime/local/account.json', 'utf8'));
assert.equal(account.username, 'desktop-preview');
for (const [env, schema] of [[identityEnv, 'mg_desktop_local_identity'], [expertEnv, 'mg_desktop_local_expert']]) {
  const url = new URL(env.DATABASE_URL); assert.equal(url.searchParams.get('schema'), schema); assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
}
const Identity = createRequire(new URL('../../mg-auth-one-identity/package.json', import.meta.url))('@prisma/client').PrismaClient;
const Expert = createRequire(new URL('../../mg-expert-database/apps/api/package.json', import.meta.url))('@prisma/client').PrismaClient;
const identity = new Identity({ datasources: { db: { url: identityEnv.DATABASE_URL } } });
const expert = new Expert({ datasources: { db: { url: expertEnv.DATABASE_URL } } });
try {
  const central = await identity.user.findUnique({ where: { username: account.username }, select: { id: true, status: true } });
  assert.equal(central?.status, 'active');
  const user = await expert.user.findUnique({ where: { username: account.username }, select: { id: true, identitySubject: true, identityIssuer: true, role: true } });
  assert.ok(user); assert.equal(user.identitySubject, central.id); assert.equal(user.identityIssuer, expertEnv.IDENTITY_ISSUER);
  await expert.user.update({ where: { id: user.id }, data: { role: 'system_admin' } });
  await mkdir('.runtime/demo-permissions', { recursive: true });
  await writeFile('.runtime/demo-permissions/expert.json', JSON.stringify({ username: account.username, previousRole: user.role, role: 'system_admin', verifiedIdentityMapping: true }, null, 2));
  console.log('本地演示账户知识库权限已核验并设置为系统管理员。');
} finally { await Promise.all([identity.$disconnect(), expert.$disconnect()]); }
