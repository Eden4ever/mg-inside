import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/password';
import { MODULE_KEYS } from '../src/contract';

const prisma = new PrismaClient();

async function main() {
  if (!process.env.SEED_ADMIN_PASSWORD) throw new Error('执行演示数据补全前必须设置 SEED_ADMIN_PASSWORD。');
  const passwordHash = await hashPassword(process.env.SEED_ADMIN_PASSWORD);
  await prisma.user.upsert({ where: { username: 'admin' }, update: { displayName: '系统管理员', passwordHash, role: 'system_admin', status: 'active' }, create: { username: 'admin', displayName: '系统管理员', passwordHash, role: 'system_admin', status: 'active' } });
  const system = await prisma.indicatorSystem.upsert({ where: { code: 'HN-BEE-2026' }, update: {}, create: { name: '2026年度营商环境监测指标体系', code: 'HN-BEE-2026', region: '河南省' } });
  const version = await prisma.indicatorVersion.upsert({ where: { systemId_year_versionCode: { systemId: system.id, year: 2026, versionCode: 'V1.0' } }, update: {}, create: { systemId: system.id, year: 2026, versionCode: 'V1.0', status: 'researching' } });
  const node = async (level: number, code: string, name: string, parentId: string | null, sortOrder: number) => prisma.indicatorNode.upsert({ where: { versionId_parentKey_code: { versionId: version.id, parentKey: parentId || '__root__', code } }, update: {}, create: { versionId: version.id, parentId, parentKey: parentId || '__root__', level, code, name, sortOrder } });
  const level1 = await node(1, 'CREDIT', '信用环境', null, 1);
  const level2 = await node(2, 'CREDIT-SUP', '信用监管', level1.id, 1);
  const level3 = await node(3, '001', '受到行政处罚企业情况', level2.id, 1);
  await node(3, '002', '信用修复办理时效', level2.id, 2);
  await prisma.researchRecord.upsert({ where: { versionId_indicatorNodeId: { versionId: version.id, indicatorNodeId: level3.id } }, update: {}, create: { versionId: version.id, indicatorNodeId: level3.id, summary: null, modules: { create: MODULE_KEYS.map((moduleKey) => ({ moduleKey })) } } });
  console.log(`演示数据已确保：${system.code} / ${version.id}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
