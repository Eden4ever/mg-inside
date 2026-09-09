import fs from 'node:fs/promises';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { preview } from './match.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expert = path.resolve(process.env.MG_EXPERT_ROOT || 'C:/Projects/mg-expert-database');
const requireGateway = createRequire(path.join(root, 'mg-gateway/apps/gateway/package.json'));
const requireExpert = createRequire(path.join(expert, 'apps/api/package.json'));
const output = path.join(root, 'identity/private');
let stage = '读取本地配置';
let db, prisma;
try {
  const gatewayEnv = parseEnv(await fs.readFile(path.join(root, 'mg-gateway/apps/gateway/.env'), 'utf8'));
  const expertEnv = { ...parseEnv(await fs.readFile(path.join(expert, '.env'), 'utf8')) };
  // 可由机密管理器注入，优先于参考项目本地配置；不复制或落盘凭据。
  for (const key of ['WECOM_CORP_ID', 'WECOM_APP_SECRET', 'DATABASE_URL']) {
    if (process.env[key]) expertEnv[key] = process.env[key];
  }
  const corpId = expertEnv.WECOM_CORP_ID;
  const missing = ['WECOM_CORP_ID', 'WECOM_APP_SECRET', 'DATABASE_URL'].filter(key => !expertEnv[key]);
  if (missing.length) { stage = `缺少配置字段：${missing.join('、')}`; throw new Error('配置不完整'); }
  const data = { corpId, revocations: [], tokenUsers: [], expertUsers: [], members: [],
    scope: { gateway: '本地 .env 指向的数据源；尚未证明是生产实例', expert: '专家库 .env 指向的数据源；尚未证明是生产实例', directory: '当前企微应用可见范围，不保证覆盖全企业' } };
  stage = '只读读取 Token One 账号';
  db = await requireGateway('mysql2/promise').createConnection({
    host: gatewayEnv.DB_HOST || '127.0.0.1', port: Number(gatewayEnv.DB_PORT || 3306),
    user: gatewayEnv.DB_USERNAME, password: gatewayEnv.DB_PASSWORD, database: gatewayEnv.DB_DATABASE,
    connectTimeout: 8000,
  });
  await db.query('START TRANSACTION READ ONLY');
  const [config] = await db.query('SELECT corpid FROM wecom_config WHERE id = 1');
  const gatewayCorpId = config[0]?.corpid || gatewayEnv.WECOM_CORPID;
  const [users] = await db.query('SELECT id, displayName, role, status, syncSource, wecomUserId FROM users');
  data.tokenUsers = users.map(u => ({ id: u.id, name: u.displayName, role: u.role, active: u.status === 1, source: u.syncSource,
    // 不把缺少企业范围的旧绑定猜成参考项目的企业。
    identities: u.wecomUserId ? [{ corpId: gatewayCorpId || 'unknown', userId: u.wecomUserId }] : [] }));
  await db.rollback(); await db.end(); db = null;
  stage = '只读读取专家库账号和撤销记录';
  const { PrismaClient } = requireExpert('@prisma/client');
  prisma = new PrismaClient({ datasources: { db: { url: expertEnv.DATABASE_URL } }, log: [] });
  await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const users = await tx.user.findMany({ select: { id: true, displayName: true, role: true, status: true, authSource: true,
      wecomIdentities: { select: { corpId: true, externalUserId: true } } } });
    data.expertUsers = users.map(u => ({ id: u.id, name: u.displayName, role: u.role, active: u.status === 'active', source: u.authSource,
      identities: u.wecomIdentities.map(i => ({ corpId: i.corpId, userId: i.externalUserId })) }));
    data.revocations = (await tx.weComIdentityRevocation.findMany({ select: { corpId: true, externalUserId: true } }))
      .map(i => ({ corpId: i.corpId, userId: i.externalUserId }));
  });
  await prisma.$disconnect(); prisma = null;
  stage = '读取企微应用可见通讯录';
  async function api(endpoint, params) {
    const url = new URL(`https://qyapi.weixin.qq.com/cgi-bin/${endpoint}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const response = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: 'error' });
    if (!response.ok) throw new Error('企微 HTTP 请求失败');
    const result = await response.json();
    if (result.errcode !== 0) throw new Error(`企微错误码 ${Number(result.errcode)}`);
    return result;
  }
  const token = await api('gettoken', { corpid: corpId, corpsecret: expertEnv.WECOM_APP_SECRET });
  const directory = await api('user/list', { access_token: token.access_token, department_id: '1', fetch_child: '1' });
  if (!Array.isArray(directory.userlist)) throw new Error('目录不完整');
  data.members = directory.userlist.map(m => ({ userId: m.userid, name: m.name, active: m.status === 1 }));
  const result = preview(data);
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, 'account-preview.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ status: 'complete', totals: result.totals, output: 'identity/private/account-preview.json', scope: result.scope }));
} catch (error) {
  // 数据库驱动异常可能携带连接字符串；只输出阶段和错误类型。
  console.error(JSON.stringify({ status: 'blocked', stage, errorType: error?.constructor?.name || 'Error', notice: '未生成完整报告，未写入任何业务数据库。请检查该阶段的数据源或权限。' }));
  process.exitCode = 1;
} finally {
  if (db) { await db.rollback().catch(() => {}); await db.end().catch(() => {}); }
  if (prisma) await prisma.$disconnect().catch(() => {});
}
