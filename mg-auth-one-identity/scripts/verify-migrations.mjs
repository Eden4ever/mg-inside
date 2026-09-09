import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
if (!process.env.DATABASE_URL?.includes('127.0.0.1:15439/identity_test')) throw new Error('仅允许专用本地测试库');
const url = new URL(process.env.DATABASE_URL); const schema = `migration_test_${Date.now()}`;
url.searchParams.set('schema', schema);
const root = path.resolve(import.meta.dirname, '..');
const env = { ...process.env, DATABASE_URL: url.href };
const args = [path.join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'];
try {
  for (let i = 0; i < 2; i++) execFileSync(process.execPath, args, { cwd: root, env, stdio: 'pipe' });
  const prisma = new PrismaClient({ datasourceUrl: url.href });
  try {
    await prisma.user.create({ data: { displayName: '迁移验证', role: 'member' } });
    let blocked = false;
    try { await prisma.user.create({ data: { displayName: '迁移验证', role: 'member' } }); } catch (e) { blocked = e.code === 'P2002'; }
    if (!blocked) throw new Error('未阻止同名身份');
    console.log('空库迁移、重复部署与同名唯一约束验证通过');
  } finally { await prisma.$disconnect(); }
} catch { console.error('隔离库迁移验证失败'); process.exitCode = 1; }
