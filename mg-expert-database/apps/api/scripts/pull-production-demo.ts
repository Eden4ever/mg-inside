import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient, Prisma } from '@prisma/client';

const models = ['indicatorSystem', 'indicatorVersion', 'indicatorNode', 'researchRecord', 'researchModule', 'evidence', 'researchRevision', 'researchSummaryRevision', 'aISuggestion', 'researchAssignment'] as const;
const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');
const url = new URL(process.env.DATABASE_URL || '');
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.port !== '5437' || url.pathname !== '/mg_expert' || (url.searchParams.get('schema') || 'public') !== 'public') {
  throw new Error('仅允许写入本地 localhost:5437/mg_expert 的 public Schema。');
}

async function main() {
  // SSH Agent 完成认证；远端仅执行一致性快照读取，不导出认证数据。
  const remote = `set -eu
set -a
. /etc/mg-expert-database/api.env
set +a
cd /opt/mg-expert-database/current/apps/api
node <<'NODE'
const {PrismaClient}=require('@prisma/client');
const p=new PrismaClient();
(async()=>{
 const data=await p.$transaction(async tx=>{
   const result={users:await tx.user.findMany({select:{id:true},orderBy:{id:'asc'}})};
   for(const model of ${JSON.stringify(models)}) result[model]=await tx[model].findMany();
   return result;
 },{isolationLevel:'RepeatableRead',timeout:120000});
 console.log(JSON.stringify(data));
})().catch(()=>{console.error('生产数据读取失败');process.exitCode=1}).finally(()=>p.$disconnect());
NODE
`;
  const result = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', 'root@43.139.78.226', 'bash -s'], { input: remote, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, timeout: 150000 });
  if (result.status !== 0) throw new Error('SSH 读取失败，请检查 Agent 和生产连接。');
  const data = JSON.parse(result.stdout);
  const counts = Object.fromEntries(models.map(model => [model, data[model].length]));
  console.log('生产业务数据数量：', JSON.stringify(counts));
  console.log('本地指标体系数量：', await prisma.indicatorSystem.count());
  if (!apply) return;

  const backupDir = resolve('../../artifacts', `demo-import-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  mkdirSync(backupDir, { recursive: true });
  const dump = spawnSync('docker', ['compose', 'exec', '-T', 'postgres', 'pg_dump', '-U', 'mg_expert', '-d', 'mg_expert', '-Fc'], { cwd: resolve('../..'), maxBuffer: 128 * 1024 * 1024 });
  if (dump.status !== 0 || dump.stdout.length < 100) throw new Error('本地备份失败，取消导入。');
  writeFileSync(resolve(backupDir, 'local-before.dump'), dump.stdout, { flag: 'wx' });
  const names = new Map<string, string>(data.users.map((u: {id: string}, i: number) => [u.id, `演示用户${i + 1}`]));
  const userId = (id: string | null) => id ? `demo-${id}` : null;
  await prisma.$transaction(async tx => {
    await tx.researchAssignment.deleteMany();
    await tx.researchSummaryRevision.deleteMany();
    await tx.aISuggestion.deleteMany();
    await tx.researchRevision.deleteMany();
    await tx.evidence.deleteMany();
    await tx.researchModule.deleteMany();
    await tx.researchRecord.deleteMany();
    for (const level of [3, 2, 1]) await tx.indicatorNode.deleteMany({ where: { level } });
    await tx.indicatorVersion.deleteMany();
    await tx.indicatorSystem.deleteMany();
    for (const u of data.users) await tx.user.upsert({ where: { id: userId(u.id)! }, create: { id: userId(u.id)!, displayName: names.get(u.id)!, role: 'reader', status: 'disabled', authSource: 'demo' }, update: {} });
    for (const model of models) {
      const rows = data[model].map((source: Record<string, any>) => {
        const row = { ...source };
        for (const key of ['actorUserId', 'decidedByUserId', 'assignedByUserId', 'userId']) if (key in row) row[key] = userId(row[key]);
        if ('actorName' in row) row.actorName = names.get(source.actorUserId) || '演示操作员';
        return row;
      });
      if (model === 'indicatorNode') {
        for (const level of [1, 2, 3]) await tx.indicatorNode.createMany({ data: rows.filter((row: any) => row.level === level) });
      } else if (rows.length) {
        await (tx[model] as any).createMany({ data: rows });
      }
    }
  }, { timeout: 120000 });
  const actual: Record<string, number> = {};
  for (const model of models) actual[model] = await (prisma[model] as any).count();
  if (JSON.stringify(actual) !== JSON.stringify(counts)) throw new Error('导入后数量核验未通过。');
  writeFileSync(resolve(backupDir, 'summary.json'), JSON.stringify({ importedAt: new Date().toISOString(), counts: actual, credentialsImported: false, localBackup: 'local-before.dump' }, null, 2));
  console.log('导入和数量核验完成；本地原有登录账号保留。备份目录：', backupDir);
}
main().catch(() => { console.error('导入未完成，请保留备份并检查连接或数据约束。'); process.exitCode = 1; }).finally(() => prisma.$disconnect());
