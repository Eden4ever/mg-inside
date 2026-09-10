import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../mg-desktop-one/package.json',import.meta.url));
const { Client } = require('pg');
const settings = parseEnv(await readFile(new URL('../../mg-desktop-one/.runtime/local/identity.env',import.meta.url),'utf8'));
const url = new URL(settings.DATABASE_URL);
assert.equal(url.hostname,'127.0.0.1'); assert.equal(url.port,'15439'); assert.equal(url.pathname,'/identity_test');
assert.equal(url.searchParams.get('schema'),'mg_desktop_local_identity');
url.searchParams.delete('schema');
const client = new Client({connectionString:url.href});
try {
  await client.connect(); await client.query('BEGIN');
  await client.query('SET LOCAL search_path TO "mg_desktop_local_identity"');
  await client.query('SELECT pg_advisory_xact_lock(741029)');
  const names = ['Division','Organization','OrganizationPlaque','DivisionMapping'];
  const existing = await client.query('SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_name=ANY($2::text[])',['mg_desktop_local_identity',names]);
  if(existing.rowCount===names.length){await client.query('ROLLBACK');console.log('四张组织区划表已存在，未重复执行迁移。');}
  else {
    assert.equal(existing.rowCount,0,'存在部分目标表，停止执行以避免覆盖已有结构');
    const before = await client.query('SELECT (SELECT count(*) FROM "User")::int AS users, (SELECT count(*) FROM "Role")::int AS roles, (SELECT count(*) FROM "Application")::int AS applications');
    const sql = await readFile(new URL('../prisma/migrations/20260909200000_division_organization/migration.sql',import.meta.url),'utf8');
    await client.query(sql);
    const after = await client.query('SELECT (SELECT count(*) FROM "User")::int AS users, (SELECT count(*) FROM "Role")::int AS roles, (SELECT count(*) FROM "Application")::int AS applications');
    assert.deepEqual(after.rows,before.rows);await client.query('COMMIT');
    console.log(JSON.stringify({schema:'mg_desktop_local_identity',created:names,preserved:after.rows[0]}));
  }
} catch(error) {await client.query('ROLLBACK').catch(()=>{}); console.error('本地组织区划迁移失败，事务已回滚。',error.code||error.name);process.exitCode=1;}
finally {await client.end();}
