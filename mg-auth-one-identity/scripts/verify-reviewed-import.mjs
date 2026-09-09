import { PrismaClient } from '@prisma/client';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
if (!process.env.DATABASE_URL?.includes('127.0.0.1:15439/identity_test')) throw new Error('仅允许专用本地测试库');
const prisma = new PrismaClient({ log: [] });
const planPath = path.resolve(import.meta.dirname, '../private/service-test/import-plan.json');
const env = { ...process.env, IDENTITY_IMPORT_REVIEWED:'true', WECOM_CORP_ID:'test-corp', ZENTAO_BASE_URL:'https://pm.example',
 IDENTITY_BOOTSTRAP_USERNAME:'identity-admin', IDENTITY_BOOTSTRAP_PASSWORD:randomBytes(24).toString('hex') };
function run(script, args=[]) { return spawnSync(process.execPath,[path.join(import.meta.dirname,script),...args],{env,encoding:'utf8'}).status; }
try {
  assert.equal(await prisma.user.count(),0,'测试要求空库');
  assert.equal(run('bootstrap-admin.mjs'),0);
  await prisma.application.create({data:{clientId:'token-one',name:'测试应用'}});
  const makeUser=(name,externalUserId,clientId,localUserId)=>({displayName:name,externalUserId,corpId:'test-corp',memberships:[{clientId,localUserId}],zentaoAccounts:[]});
  const plan={review:'合成测试身份',reviewedAt:new Date().toISOString(),users:[makeUser('测试甲','one','token-one','7'),makeUser('测试乙','two','missing-app','9')]};
  await fs.writeFile(planPath,JSON.stringify(plan),{mode:0o600});
  assert.equal(run('import-reviewed-users.mjs',[planPath]),1,'第二项失败须整体回滚');
  assert.equal(await prisma.user.count(),1);assert.equal(await prisma.applicationUser.count(),0);
  plan.users[1].memberships[0].clientId='token-one';plan.users[0].zentaoAccounts=['test-one'];
  await fs.writeFile(planPath,JSON.stringify(plan),{mode:0o600});
  assert.equal(run('import-reviewed-users.mjs',[planPath]),0);
  assert.equal(await prisma.user.count(),3);assert.equal(await prisma.applicationUser.count(),2);
  assert.equal(await prisma.zentaoIdentity.count(),1);
  const members=await prisma.user.findMany({where:{roles:{none:{role:{key:'platform-admin'}}}},select:{username:true,passwordHash:true}});
  assert.ok(members.every(u=>!u.username&&!u.passwordHash),'员工必须经验证后自行设置中心密码');
  assert.equal(run('import-reviewed-users.mjs',[planPath]),1,'拒绝重复导入覆盖账号');
  assert.equal(await prisma.user.count(),3);
  console.log('核对清单导入：成功映射、失败整体回滚、首次设置及重复导入拒绝均通过');
} finally {await prisma.$disconnect();}
