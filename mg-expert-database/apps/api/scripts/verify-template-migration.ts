import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

async function main() {
  const source = new URL(process.env.DATABASE_URL!);
  if (!['localhost', '127.0.0.1'].includes(source.hostname) || source.port !== '5437' || source.pathname !== '/mg_expert') throw new Error('仅允许本项目本地开发库。');
  const apply = process.argv.includes('--apply');
  const stamp = Date.now();
  const directory = resolve('artifacts', 'template-migration-' + stamp);
  mkdirSync(directory, { recursive: true });
  const container = 'mg-expert-database-postgres-1';
  const run = (...args: string[]) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  const dump = '/tmp/template-migration-' + stamp + '.dump';
  run('exec', container, 'pg_dump', '-U', 'mg_expert', '-d', 'mg_expert', '-n', 'public', '-Fc', '-f', dump);
  run('cp', container + ':' + dump, resolve(directory, 'local-before.dump'));
  const database = apply ? 'mg_expert' : 'mg_template_migration_' + stamp;
  if (!apply) {
    run('exec', container, 'createdb', '-U', 'mg_expert', database);
    run('exec', container, 'pg_restore', '-U', 'mg_expert', '-d', database, '--no-owner', '--clean', '--if-exists', dump);
  }
  source.pathname = '/' + database; source.searchParams.set('schema', 'public');
  const prisma = new PrismaClient({ datasources: { db: { url: source.toString() } } });
  async function fingerprint() {
    const result: Record<string, { count: number; sha256: string }> = {};
    for (const table of ['IndicatorNode', 'ResearchRecord', 'ResearchModule', 'Evidence', 'ResearchRevision', 'ResearchSummaryRevision']) {
      const data: any[] = await prisma.$queryRawUnsafe('SELECT * FROM "' + table + '" ORDER BY id');
      if (table === 'ResearchRevision') for (const row of data) { delete row.snapshot.template; delete row.snapshot.templateRevision; }
      result[table] = { count: data.length, sha256: createHash('sha256').update(JSON.stringify(data)).digest('hex') };
    }
    return result;
  }
  try {
    const before = await fingerprint();
    const cli = createRequire(import.meta.url).resolve('prisma/build/index.js');
    execFileSync(process.execPath, [cli, 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], { cwd: resolve('apps/api'), env: { ...process.env, DATABASE_URL: source.toString() }, stdio: 'pipe' });
    const after = await fingerprint();
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('迁移前后内容指纹不一致，请核对备份。');
    const templates = await prisma.indicatorLevelTemplate.count();
    const unlinked: any[] = await prisma.$queryRawUnsafe('SELECT count(*)::int AS count FROM "ResearchRevision" WHERE NOT (snapshot ? \'template\')');
    if (unlinked[0].count) throw new Error('仍有历史修订未关联模板。');
    writeFileSync(resolve(directory, 'verification.json'), JSON.stringify({ mode: apply ? 'local' : 'test-copy', database, templates, before, after, passed: true }, null, 2));
    console.log(JSON.stringify({ passed: true, database, templates, backup: resolve(directory, 'local-before.dump'), report: resolve(directory, 'verification.json') }));
  } finally { await prisma.$disconnect(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : '迁移校验失败'); process.exitCode = 1; });
