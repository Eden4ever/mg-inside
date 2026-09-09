import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/password';
import { MODULE_KEYS } from '../src/contract';

const prisma = new PrismaClient();

async function createTree(versionId: string) {
  const credit = await prisma.indicatorNode.create({ data: { versionId, level: 1, code: 'CREDIT', name: '信用环境', sortOrder: 1 } });
  const supervision = await prisma.indicatorNode.create({ data: { versionId, parentId: credit.id, parentKey: credit.id, level: 2, code: 'CREDIT-SUP', name: '信用监管', sortOrder: 1 } });
  const penalty = await prisma.indicatorNode.create({ data: { versionId, parentId: supervision.id, parentKey: supervision.id, level: 3, code: '001', name: '受到行政处罚企业情况', sortOrder: 1 } });
  await prisma.indicatorNode.createMany({ data: [
    { versionId, parentId: supervision.id, parentKey: supervision.id, level: 3, code: '002', name: '信用修复办理时效', sortOrder: 2 },
    { versionId, parentId: supervision.id, parentKey: supervision.id, level: 3, code: '003', name: '“双公示”信息及时率', sortOrder: 3 },
  ] });
  const financing = await prisma.indicatorNode.create({ data: { versionId, level: 1, code: 'FINANCE', name: '融资支持', sortOrder: 2 } });
  const inclusive = await prisma.indicatorNode.create({ data: { versionId, parentId: financing.id, parentKey: financing.id, level: 2, code: 'FINANCE-INCLUSIVE', name: '普惠融资', sortOrder: 1 } });
  await prisma.indicatorNode.createMany({ data: [
    { versionId, parentId: inclusive.id, parentKey: inclusive.id, level: 3, code: '014', name: '政府采购合同融资规模', sortOrder: 1 },
    { versionId, parentId: inclusive.id, parentKey: inclusive.id, level: 3, code: '015', name: '普惠小微贷款余额增速', sortOrder: 2 },
  ] });
  const record = await prisma.researchRecord.create({ data: { versionId, indicatorNodeId: penalty.id, summary: '当前指标需重点核验行政处罚信息归集口径与修复办理时效。', modules: { create: MODULE_KEYS.map((moduleKey) => ({ moduleKey })) } }, include: { modules: true } });
  const portrait = record.modules.find((module) => module.moduleKey === 'portrait')!;
  await prisma.researchModule.update({ where: { id: portrait.id }, data: { status: 'in_progress', revisionNo: 1, values: { indicator_nature: '逆向指标', assessment_scope: '本地区受到行政处罚的企业', measurement_type: '比率类', assessment_cycle: '年度', time_dimension: '时期数' } } });
  await prisma.researchRevision.create({ data: { moduleId: portrait.id, revisionNo: 1, actorName: '系统种子', action: 'saved', snapshot: { values: { indicator_nature: '逆向指标' }, status: 'in_progress' } } });
  await prisma.evidence.create({ data: { recordId: record.id, moduleKey: 'portrait', fieldKeys: ['assessment_scope'], type: 'policy', title: '行政处罚信息归集口径说明（待业务核验示例）', verificationStatus: 'pending_verification' } });
  await prisma.aISuggestion.create({ data: { recordId: record.id, targetType: 'module', moduleKey: 'portrait', fieldKey: 'assessment_scope', content: '建议按省级统筹、市县执行两个层次补充考核对象与适用范围。', rationale: '当前范围描述尚未体现跨层级职责边界，需结合正式考核文件人工核验。', confidence: 'needs_verification', verificationItems: ['核对正式考核文件中的适用层级'], modelId: 'seed-placeholder', promptVersion: 'm0-contract' } });
}

async function main() {
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminPassword) throw new Error('执行种子前必须设置 SEED_ADMIN_PASSWORD。');
  await prisma.weComLoginState.deleteMany(); await prisma.authSession.deleteMany(); await prisma.weComIdentity.deleteMany(); await prisma.auditLog.deleteMany(); await prisma.aISuggestion.deleteMany(); await prisma.researchRevision.deleteMany(); await prisma.evidence.deleteMany(); await prisma.researchModule.deleteMany(); await prisma.researchRecord.deleteMany(); await prisma.indicatorNode.deleteMany(); await prisma.indicatorVersion.deleteMany(); await prisma.indicatorSystem.deleteMany(); await prisma.user.deleteMany();
  await prisma.user.create({ data: { username: process.env.SEED_ADMIN_USERNAME?.trim().toLowerCase() || 'admin', displayName: '系统管理员', passwordHash: await hashPassword(adminPassword), role: 'system_admin', status: 'active', authSource: 'local' } });
  const mainSystem = await prisma.indicatorSystem.create({ data: { name: '2026年度营商环境监测指标体系', code: 'HN-BEE-2026', region: '河南省' } });
  const mainVersion = await prisma.indicatorVersion.create({ data: { systemId: mainSystem.id, year: 2026, versionCode: 'V1.0', status: 'researching' } });
  await createTree(mainVersion.id);
  const citySystem = await prisma.indicatorSystem.create({ data: { name: '2026年度市县营商环境监测指标体系', code: 'CITY-BEE-2026', region: '全省市县' } });
  await prisma.indicatorVersion.create({ data: { systemId: citySystem.id, year: 2026, versionCode: 'V0.9', status: 'draft' } });
  const pilotSystem = await prisma.indicatorSystem.create({ data: { name: '开发区营商环境监测指标体系', code: 'PARK-BEE-2025', region: '试点开发区' } });
  await prisma.indicatorVersion.create({ data: { systemId: pilotSystem.id, year: 2025, versionCode: 'V1.3', status: 'published' } });
  console.log(`已写入种子数据：管理员账号与 ${mainSystem.code} / ${mainVersion.id}`);
}

main().catch((error) => { console.error(error); process.exit(1); }).finally(async () => prisma.$disconnect());
