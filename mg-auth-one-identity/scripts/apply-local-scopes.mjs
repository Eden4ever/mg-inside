import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../mg-desktop-one/package.json', import.meta.url));
const { Client } = require('pg');
const settings = parseEnv(await readFile(new URL('../../mg-desktop-one/.runtime/local/identity.env', import.meta.url), 'utf8'));
const url = new URL(settings.DATABASE_URL);
assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.port, '15439'); assert.equal(url.pathname, '/identity_test');
assert.equal(url.searchParams.get('schema'), 'mg_desktop_local_identity'); url.searchParams.delete('schema');
const client = new Client({ connectionString: url.href });
try {
  await client.connect(); await client.query('BEGIN');
  await client.query('SET LOCAL search_path TO "mg_desktop_local_identity"');
  await client.query('SELECT pg_advisory_xact_lock(741028)'); await client.query('SELECT pg_advisory_xact_lock(741029)');
  const names = ['UserOrganization','ManagementScope','ScopeAdministrator','ScopeApplication','ScopeGrant'];
  const existing = await client.query('SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_name=ANY($2::text[])', ['mg_desktop_local_identity', names]);
  if (existing.rowCount === names.length) { await client.query('ROLLBACK'); console.log('范围授权表已存在，未重复迁移。'); }
  else {
    assert.equal(existing.rowCount, 0, '目标表部分存在，停止以避免覆盖结构');
    const count = 'SELECT (SELECT count(*) FROM "User")::int AS users, (SELECT count(*) FROM "UserRole")::int AS memberships, (SELECT count(*) FROM "ApplicationUser")::int AS grants, (SELECT count(*) FROM "Application")::int AS applications';
    const before = await client.query(count);
    await client.query(await readFile(new URL('../prisma/migrations/20260910090000_scoped_organization_access/migration.sql', import.meta.url), 'utf8'));
    const after = await client.query(count); assert.deepEqual(after.rows, before.rows);
    await client.query('COMMIT'); console.log(JSON.stringify({ created: names, preserved: after.rows[0] }));
  }
} catch (error) { await client.query('ROLLBACK').catch(() => {}); console.error('本地范围授权迁移失败，已回滚。', error.code || error.name); process.exitCode = 1; }
finally { await client.end(); }
