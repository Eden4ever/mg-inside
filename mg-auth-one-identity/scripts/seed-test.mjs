import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../dist/password.js';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
if (!process.env.DATABASE_URL?.includes('127.0.0.1:15439/identity_test')) throw new Error('仅允许专用本地测试库');
const prisma = new PrismaClient();
const password = randomBytes(24).toString('base64url');
const user = await prisma.user.create({ data: { username: `test-${Date.now()}`, displayName: '联调测试用户', role: 'member', passwordHash: await hashPassword(password), status: 'active' } });
for (const [i, clientId] of ['token-one', 'expert-database'].entries()) {
  await prisma.application.upsert({ where: { clientId }, create: { clientId, name: clientId }, update: {} });
  await prisma.applicationUser.create({ data: { clientId, userId: user.id, localUserId: i === 0 ? '7' : 'original-expert-id', enabled: true } });
}
await fs.writeFile(new URL('../private/service-test/user.json', import.meta.url), JSON.stringify({ username: user.username, password, id: user.id }), { mode: 0o600 });
await prisma.$disconnect(); console.log('已创建专用测试身份和两应用映射');
