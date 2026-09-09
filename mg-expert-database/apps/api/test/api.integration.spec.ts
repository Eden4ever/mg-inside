import ExcelJS from 'exceljs';
import { TOTP } from 'otpauth';
import { MailConfigService } from '../src/mail-config';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { parseEnv } from 'node:util';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { SemanticService } from '../src/semantic.service';
import { ZhipuEmbedding } from '../src/zhipu-embedding';
import { CatalogService } from '../src/catalog.service';
import { AuthService, hashPassword, sha256 } from '../src/auth';
import { MODULE_DEFINITIONS } from '../src/contract';
import { createApiApplication } from '../src/main';
import { PrismaService } from '../src/prisma.service';
import { activeModules } from '../src/templates.service';
import { activeDefinitions } from '../src/semantic-source';
import * as identityClient from '../src/identity-client';
import { applyIdentityUser } from '../src/identity-projection';
import { IdentitySyncService } from '../src/identity.controller';

// 每个集成用例包含多次真实数据库及 HTTP 操作，不使用单元测试的 5 秒总预算。
describe('M1-M3 API integration', { timeout: 20_000 }, () => {
  let app: NestFastifyApplication;
  let catalog: CatalogService;
  let prisma: PrismaService;
  let systemId: string;
  let versionId: string;
  let level2Id: string;
  let level3Id: string;
  const sessions: Record<string, { cookie: string; csrf: string }> = {};
  const adminActor = { userId: 'test-admin', name: '测试管理员', role: 'system_admin' as const };

  const request = (method: any, url: string, payload?: unknown, role = 'system_admin') => {
    const session = sessions[role];
    return app.inject({
      method,
      url,
      headers: {
        'content-type': 'application/json',
        ...(session ? { cookie: session.cookie, ...(method === 'GET' ? {} : { 'x-csrf-token': session.csrf }) } : {}),
      },
      payload: payload === undefined ? undefined : JSON.stringify(payload),
    });
  };

  const login = async (username: string, role = username) => {
    const response = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ username, password: 'Integration!2026' }) });
    expect(response.statusCode).toBe(200);
    const setCookie = response.headers['set-cookie'];
    sessions[role] = { cookie: String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0]!, csrf: response.json().csrfToken };
  };

  const createVersionTree = async (prefix: string) => {
    const system = await request('POST', '/api/systems', { name: `${prefix}体系`, code: prefix, region: '测试区域', year: 2026, versionCode: 'V1' });
    expect(system.statusCode).toBe(201);
    const createdVersionId = system.json().version.id as string;
    const level1 = await request('POST', `/api/indicator-versions/${createdVersionId}/nodes`, { level: 1, code: `${prefix}-L1`, name: `${prefix}一级` });
    const level2 = await request('POST', `/api/indicator-versions/${createdVersionId}/nodes`, { level: 2, parentId: level1.json().id, code: `${prefix}-L2`, name: `${prefix}二级` });
    const level3 = await request('POST', `/api/indicator-versions/${createdVersionId}/nodes`, { level: 3, parentId: level2.json().id, code: `${prefix}-L3`, name: `${prefix}三级` });
    return { systemId: system.json().id as string, versionId: createdVersionId, level1Id: level1.json().id as string, level2Id: level2.json().id as string, level3Id: level3.json().id as string };
  };

  it('体系编辑和删除检查权限及名称确认，级联清理目录并保留审计', async () => {
    const target = await createVersionTree('DELETE-SYSTEM');
    const url = `/api/systems/${target.systemId}`;
    const recordUrl = `/api/indicator-versions/${target.versionId}/indicators/${target.level3Id}`;
    expect((await request('PATCH', `${recordUrl}/modules/portrait`, { expectedRevisionNo: 0, values: [{ fieldKey: 'indicator_nature', value: '正向指标' }] })).statusCode).toBe(200);
    const evidence = await request('POST', `${recordUrl}/modules/portrait/evidence`, { type: 'case', title: '删除测试依据', excerpt: '测试内容', verificationStatus: 'pending_verification', fieldKeys: ['indicator_nature'] });
    expect(evidence.statusCode).toBe(201);
    const record = await prisma.researchRecord.findUniqueOrThrow({ where: { indicatorNodeId: target.level3Id } });
    expect((await request('PATCH', url, { name: '改名', region: '' }, 'reader')).statusCode).toBe(403);
    expect((await request('DELETE', url, { confirmName: 'DELETE-SYSTEM体系' }, 'reader')).statusCode).toBe(403);
    expect((await request('PATCH', url, { name: ' ', region: '' })).statusCode).toBe(400);
    expect((await request('PATCH', url, { name: '新体系名称', region: '新区' })).statusCode).toBe(200);
    expect((await request('GET', url)).json()).toMatchObject({ name: '新体系名称', region: '新区' });
    expect((await request('DELETE', url, { confirmName: 'DELETE-SYSTEM体系' })).statusCode).toBe(400);
    const library = await prisma.semanticLibrary.create({ data: { versionId: target.versionId, name: '关联库' } });
    expect((await request('DELETE', url, { confirmName: '新体系名称' })).statusCode).toBe(409);
    expect(await prisma.indicatorNode.count({ where: { versionId: target.versionId } })).toBe(3);
    await prisma.semanticLibrary.delete({ where: { id: library.id } });
    expect((await request('DELETE', url, { confirmName: '新体系名称' })).statusCode).toBe(204);
    expect(await prisma.indicatorNode.count({ where: { versionId: target.versionId } })).toBe(0);
    expect(await prisma.researchRecord.count({ where: { id: record.id } })).toBe(0);
    expect(await prisma.researchModule.count({ where: { recordId: record.id } })).toBe(0);
    expect(await prisma.evidence.count({ where: { id: evidence.json().id } })).toBe(0);
    expect(await prisma.indicatorLevelTemplate.count({ where: { systemId: target.systemId } })).toBe(0);
    expect(await prisma.indicatorSystemAccess.count({ where: { systemId: target.systemId } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { targetId: target.systemId, action: 'system.deleted' } })).toBe(1);
    expect((await request('GET', url)).statusCode).toBe(404);
  });

  it('自动指标编码并发唯一，兼容外部编码，改名排序不改变编码', async () => {
    const target = await createVersionTree('AUTO-CODE');
    const url = `/api/indicator-versions/${target.versionId}/nodes`;
    expect((await request('POST', url, { level: 1, name: '标准指标', code: 'IND-000005' })).statusCode).toBe(201);
    const results = await Promise.all(Array.from({ length: 3 }, (_, i) => request('POST', url, { level: 1, name: `自动指标${i}` })));
    results.forEach(result => expect(result.statusCode).toBe(201));
    expect(results.map(result => result.json().code).sort()).toEqual(['IND-000006', 'IND-000007', 'IND-000008']);
    const first = results[0]!.json();
    const updated = await request('PATCH', `${url}/${first.id}`, { name: '修改名称', sortOrder: 9 });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().code).toBe(first.code);
    const child = await request('POST', url, { level: 2, parentId: first.id, name: '下级指标' });
    expect(child.statusCode).toBe(201);
    expect(child.json().code).toBe('IND-000009');
    expect((await request('POST', url, { level: 1, name: '非法编码', code: 12 })).statusCode).toBe(400);
    expect((await request('POST', url, { level: 1, name: '越权' }, 'reader')).statusCode).toBe(403);
  });

  beforeAll(async () => {
    const sourceUrl = process.env.DATABASE_URL || parseEnv(readFileSync(resolve(process.cwd(), '../../.env'), 'utf8')).DATABASE_URL!;
    const testUrl = new URL(sourceUrl);
    if (!['localhost', '127.0.0.1'].includes(testUrl.hostname) || testUrl.port !== '5437' || testUrl.pathname !== '/mg_expert') throw new Error('集成测试仅允许本项目本地测试数据库。');
    const testSchema = process.env.TEST_DATABASE_SCHEMA || 'mg_expert_test';
    if (!/^mg_expert_test(?:_[a-z0-9_]+)?$/.test(testSchema)) throw new Error('测试 schema 名称无效');
    testUrl.searchParams.set('schema', testSchema);
    process.env.DATABASE_URL = testUrl.toString();
    const prismaCli = createRequire(__filename).resolve('prisma/build/index.js');
    execFileSync(process.execPath, [prismaCli, 'db', 'execute', '--stdin', '--schema', resolve(process.cwd(), 'prisma', 'schema.prisma')], { env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL }, input: `CREATE SCHEMA IF NOT EXISTS "${testSchema}";`, stdio: ['pipe', 'pipe', 'pipe'] });
    execFileSync(process.execPath, [prismaCli, 'db', 'push', '--skip-generate', '--schema', resolve(process.cwd(), 'prisma', 'schema.prisma')], { env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL }, stdio: 'pipe' });
    app = await createApiApplication(); catalog = app.get(CatalogService); prisma = app.get(PrismaService);
    await prisma.weComLoginState.deleteMany(); await prisma.authSession.deleteMany(); await prisma.weComIdentity.deleteMany(); await prisma.auditLog.deleteMany(); await prisma.researchSummaryRevision.deleteMany(); await prisma.researchRevision.deleteMany(); await prisma.evidence.deleteMany(); await prisma.researchModule.deleteMany(); await prisma.researchRecord.deleteMany(); await prisma.indicatorNode.deleteMany(); await prisma.indicatorVersion.deleteMany(); await prisma.indicatorSystem.deleteMany(); await prisma.user.deleteMany();
    const passwordHash = await hashPassword('Integration!2026');
    await prisma.user.createMany({ data: [
      { username: 'system_admin', displayName: '系统管理员', passwordHash, role: 'system_admin' },
      { username: 'catalog_manager', displayName: '指标管理员', passwordHash, role: 'catalog_manager' },
      { username: 'researcher', displayName: '研究员', passwordHash, role: 'researcher' },
      { username: 'unassigned_researcher', displayName: '未授权研究员', passwordHash, role: 'researcher' },
      { username: 'reviewer', displayName: '审核员', passwordHash, role: 'reviewer' },
      { username: 'publisher', displayName: '发布员', passwordHash, role: 'publisher' },
      { username: 'reader', displayName: '只读用户', passwordHash, role: 'reader' },
      { username: 'ai_service', displayName: 'AI 服务', passwordHash, role: 'ai_service' },
    ] });
    await Promise.all(['system_admin', 'catalog_manager', 'researcher', 'unassigned_researcher', 'reviewer', 'publisher', 'reader', 'ai_service'].map((role) => login(role)));
    const system = await request('POST', '/api/systems', { name: '集成测试体系', code: 'API-TEST-2026', region: '测试区域', year: 2026, versionCode: 'V1' });
    expect(system.statusCode).toBe(201); systemId = system.json().id; versionId = system.json().version.id;
    const accessUsers = await prisma.user.findMany({ where: { role: { not: 'system_admin' } } });
    await prisma.indicatorSystemAccess.createMany({ data: accessUsers.map((user) => ({
      systemId,
      userId: user.id,
      canView: true,
      canResearch: ['researcher', 'ai_service'].includes(user.role),
      canManageCatalog: user.role === 'catalog_manager',
      canReview: user.role === 'reviewer',
      canPublish: user.role === 'publisher',
    })) });
    const level1 = await request('POST', `/api/indicator-versions/${versionId}/nodes`, { level: 1, code: 'L1', name: '一级指标' });
    const level2 = await request('POST', `/api/indicator-versions/${versionId}/nodes`, { level: 2, parentId: level1.json().id, code: 'L2', name: '二级指标' }); level2Id = level2.json().id;
    const level3 = await request('POST', `/api/indicator-versions/${versionId}/nodes`, { level: 3, parentId: level2Id, code: 'L3', name: '三级指标' }); level3Id = level3.json().id;
    const researcher = await prisma.user.findUniqueOrThrow({ where: { username: 'researcher' } });
    await prisma.researchAssignment.create({ data: { versionId, indicatorNodeId: level3Id, userId: researcher.id, assignedByUserId: researcher.id } });
  }, 60000);

  it('新建体系只需名称，自动生成唯一内部编码及默认版本，地区可选', async () => {
    const first = await request('POST', '/api/systems', { name: '  精简体系  ' });
    const second = await request('POST', '/api/systems', { name: '精简体系', region: '  ', maxLevel: 6 });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ name: '精简体系', region: '', version: { year: new Date().getFullYear(), versionCode: 'V1.0' } });
    expect(second.json()).toMatchObject({ region: '', version: { year: new Date().getFullYear(), versionCode: 'V1.0' } });
    expect(first.json().code).toMatch(/^SYS-[0-9a-f-]{36}$/);
    expect(second.json().code).not.toBe(first.json().code);
    const saved = await prisma.indicatorSystem.findUniqueOrThrow({ where: { id: first.json().id }, include: { templates: true, accesses: true } });
    expect(saved.maxLevel).toBe(3);
    expect(saved.templates.filter(template => template.level <= saved.maxLevel)).toHaveLength(3);
    expect(saved.accesses).toEqual(expect.arrayContaining([expect.objectContaining({ systemRole: 'creator', canView: true, canResearch: true, canManageCatalog: true })]));
    expect((await prisma.indicatorSystem.findUniqueOrThrow({ where: { id: second.json().id } })).maxLevel).toBe(6);
  });

  it('迁移撤销历史误绑及会话，保留明确绑定和企业微信独立账号', () => {
    const schema = `migration_test_${randomUUID().replaceAll('-', '')}`;
    const fixture = readFileSync(resolve(process.cwd(), 'test/fixtures/wecom-revocation.sql'), 'utf8');
    const migration = readFileSync(resolve(process.cwd(), 'prisma/migrations/20260907006000_wecom_revocation/migration.sql'), 'utf8');
    const [setup, assertions] = fixture.split('-- APPLY_MIGRATION');
    const sql = `BEGIN; CREATE SCHEMA "${schema}"; SET LOCAL search_path TO "${schema}";\n${setup}\n${migration}\n${assertions}\nROLLBACK;`;
    const prismaCli = createRequire(__filename).resolve('prisma/build/index.js');
    execFileSync(process.execPath, [prismaCli, 'db', 'execute', '--stdin', '--schema', resolve(process.cwd(), 'prisma/schema.prisma')], {
      env: { ...process.env }, input: sql, stdio: ['pipe', 'pipe', 'pipe'],
    });
  });

  it('新建体系兼容显式编码、地区、年度和版本，目录管理员仍可创建', async () => {
    const response = await request('POST', '/api/systems', { name: '  兼容旧客户端  ', code: '  LEGACY-CREATE  ', region: '  测试区域  ', year: 2025, versionCode: '  V2  ', maxLevel: 1 }, 'catalog_manager');
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ name: '兼容旧客户端', code: 'LEGACY-CREATE', region: '测试区域', version: { year: 2025, versionCode: 'V2' }, access: { canView: true, canResearch: true, canManageCatalog: true } });
    expect((await prisma.indicatorSystem.findUniqueOrThrow({ where: { id: response.json().id } })).maxLevel).toBe(1);
    expect((await request('POST', '/api/systems', { name: '重复编码', code: 'LEGACY-CREATE' })).statusCode).toBe(409);
  });

  it('新建体系拒绝空名称、显式非法选填字段、无效层级和越权请求，且不创建数据', async () => {
    const invalidInputs = [
      {}, { name: '  ' }, { name: 123 }, { name: null },
      ...['', '  ', 123, null, {}].map(code => ({ name: '非法编码', code })),
      ...['', '  ', 123, null, {}].map(versionCode => ({ name: '非法版本', versionCode })),
      ...['', '2026', 1999, 10000, 2026.5, null, {}].map(year => ({ name: '非法年度', year })),
      ...[null, 1, {}, []].map(region => ({ name: '非法地区', region })),
      ...[0, 7, 1.5, '3', '', null, {}].map(maxLevel => ({ name: '非法层级', maxLevel })),
    ];
    const count = await prisma.indicatorSystem.count();
    for (const input of invalidInputs) {
      expect((await request('POST', '/api/systems', input)).statusCode, JSON.stringify(input)).toBe(400);
    }
    expect((await request('POST', '/api/systems', { name: '只读用户不得创建' }, 'reader')).statusCode).toBe(403);
    expect(await prisma.indicatorSystem.count()).toBe(count);
  });

  it('一二三级均支持同父级排序，拒绝跨级、跨父级和无权限操作', async () => {
    const tree = await createVersionTree('SORT');
    const url = `/api/indicator-versions/${tree.versionId}/nodes/reorder`;
    for (const [level, parentId, originalId] of [[1, null, tree.level1Id], [2, tree.level1Id, tree.level2Id], [3, tree.level2Id, tree.level3Id]] as const) {
      const sibling = await request('POST', `/api/indicator-versions/${tree.versionId}/nodes`, { level, parentId, code: `SORT-${level}-B`, name: '同级节点', sortOrder: 10 });
      const input = { nodeId: sibling.json().id, targetId: originalId, position: 'before' };
      const sorted = await request('POST', url, input);
      expect(sorted.statusCode).toBe(201);
      expect(sorted.json().nodeIds).toEqual([sibling.json().id, originalId]);
      const saved = await prisma.indicatorNode.findMany({ where: { versionId: tree.versionId, parentId }, orderBy: { sortOrder: 'asc' } });
      expect(saved.map((node) => node.id)).toEqual(sorted.json().nodeIds);
      expect(saved.every((node) => node.level === level && node.parentId === parentId)).toBe(true);
      expect((await request('POST', url, { ...input, position: 'after' })).json().nodeIds).toEqual([originalId, sibling.json().id]);
    }
    expect((await request('POST', url, { nodeId: tree.level2Id, targetId: tree.level3Id, position: 'before' })).statusCode).toBe(400);
    const other = await request('POST', `/api/indicator-versions/${tree.versionId}/nodes`, { level: 2, parentId: (await prisma.indicatorNode.findFirstOrThrow({ where: { versionId: tree.versionId, level: 1, id: { not: tree.level1Id } } })).id, code: 'OTHER', name: '其他分支' });
    expect((await request('POST', url, { nodeId: tree.level2Id, targetId: other.json().id, position: 'after' })).statusCode).toBe(400);
    expect((await request('POST', `/api/indicator-versions/${versionId}/nodes/reorder`, { nodeId: level2Id, targetId: level3Id, position: 'before' }, 'reader')).statusCode).toBe(403);
  });

  afterAll(async () => { await app?.close(); });

  it('统一登录信任中心认证策略，忽略业务遗留 MFA 标记，中心撤销后拒绝旧会话', async () => {
    const active = vi.spyOn(identityClient, 'identitySessionActive').mockResolvedValue(true);
    const ended = vi.spyOn(identityClient, 'identityEndSession').mockResolvedValue(undefined);
    try {
      const auth = app.get(AuthService);
      const user = await prisma.user.create({ data: { username: `sso-${randomUUID()}`, displayName: 'SSO测试', role: 'reader', passwordHash: await hashPassword('Integration!2026'), mfaEnabled: true, mfaMethods: ['totp'], identitySubject: randomUUID(), identityIssuer: 'https://identity.meta-gravity.com' } });
      const identity = { subject: user.identitySubject!, sessionId: randomUUID(), authMethods: ['local', 'totp'] };
      const centralLogin = await prisma.$transaction(tx => auth.beginAuthentication(user, { identity: { ...identity, authMethods: ['local'] } }, 'sso', tx));
      expect(centralLogin.state).toBe('authenticated');
      const result = await prisma.$transaction(tx => auth.beginAuthentication(user, { identity }, 'sso', tx));
      expect(result.state).toBe('authenticated');
      if (result.state !== 'authenticated') throw new Error('验证完成后未签发会话');
      const session = await prisma.authSession.findUniqueOrThrow({ where: { id: result.sessionId } });
      expect(session).toMatchObject({ userId: user.id, identitySubject: identity.subject, identitySessionId: identity.sessionId });
      expect(session.authMethods).toEqual(['sso']);
      const cookie = `mg_expert_session=${result.rawToken}`;
      expect((await auth.authenticate(cookie)).user.role).toBe('reader');
      active.mockResolvedValue(false);
      await expect(auth.authenticate(cookie)).rejects.toThrow();
      expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).role).toBe('reader');
      await auth.logout(session.id);
      expect(ended).toHaveBeenCalledWith(identity.subject,identity.sessionId);
      expect((await prisma.authSession.findUniqueOrThrow({where:{id:session.id}})).revokedAt).not.toBeNull();
    } finally { active.mockRestore(); ended.mockRestore(); }
  });

  it('SSO 开启后旧员工会话与直接登录必须重新进入中心，本地管理员也不能绕过中心', async () => {
    const previous=process.env.IDENTITY_ENABLED;process.env.IDENTITY_ENABLED='true';
    try {
      const auth=app.get(AuthService);
      await expect(auth.authenticate(sessions.researcher!.cookie)).rejects.toThrow('统一身份');
      await expect(auth.authenticate(sessions.system_admin!.cookie)).rejects.toThrow('统一身份');
      for (const url of ['/api/auth/login', '/api/auth/setup', '/api/auth/mfa', '/api/account-security/authorize']) expect((await app.inject({ method:'POST', url, payload:{} })).statusCode).toBe(403);
      const actor={userId:'admin',name:'管理员',role:'system_admin' as const};
      await expect(auth.createUser({},actor)).rejects.toThrow('统一认证');
      await expect(auth.resetPassword('any','unused',actor)).rejects.toThrow('统一认证');
      await expect(auth.updateUser('any',{displayName:'改名'},actor)).rejects.toThrow('业务角色');
      await expect(auth.bindWeCom('any','wecom',actor)).rejects.toThrow('统一认证');
      await expect(auth.unbindWeCom('any','any',actor)).rejects.toThrow('统一认证');
      const user=await prisma.user.create({data:{username:`direct-${randomUUID()}`,displayName:'旧入口测试',role:'reader',passwordHash:await hashPassword('Integration!2026')}});
      await expect(prisma.$transaction(tx=>auth.beginAuthentication(user,{},'local',tx))).rejects.toThrow('统一身份');
      const status=await app.inject({method:'GET',url:'/api/auth/wecom/status'});
      expect(status.json().enabled).toBe(false);
    } finally {if(previous===undefined)delete process.env.IDENTITY_ENABLED;else process.env.IDENTITY_ENABLED=previous;}
  });

  it('中心授权自动生成唯一映射，资料与启停完整同步，冲突整批回滚', async () => {
    const enabled=vi.spyOn(identityClient,'identityEnabled').mockReturnValue(true);
    const active=vi.spyOn(identityClient,'identitySessionActive').mockResolvedValue(true);
    const profile={subject:randomUUID(),localUserId:null,username:`projection-${randomUUID()}`,name:'同步新员工',department:'研发',active:true,securityVersion:1};
    const directory=vi.spyOn(identityClient,'identityDirectory').mockResolvedValue([profile]);
    const sync=new IdentitySyncService(prisma);
    const find=()=>prisma.user.findUniqueOrThrow({where:{identitySubject:profile.subject}});
    try {
      await sync.sync();const user=await find();
      expect(user).toMatchObject({displayName:profile.name,role:'reader',passwordHash:null,identityEnabled:true});
      const session=await prisma.$transaction(tx=>app.get(AuthService).beginAuthentication(user,{identity:{subject:profile.subject,sessionId:randomUUID()}},'sso',tx));
      expect(session.state).toBe('authenticated');
      await prisma.user.update({where:{id:user.id},data:{role:'reviewer'}});
      await Promise.all([prisma.$transaction(tx=>applyIdentityUser(tx,profile)),prisma.$transaction(tx=>applyIdentityUser(tx,profile))]);
      expect(await prisma.user.count({where:{identitySubject:profile.subject}})).toBe(1);
      directory.mockResolvedValue([{...profile,name:'同步改名',department:null,active:false}]);await sync.sync();
      expect(await find()).toMatchObject({id:user.id,displayName:'同步改名',departmentName:null,status:'disabled',identityEnabled:false,role:'reviewer'});
      directory.mockResolvedValue([profile]);await sync.sync();expect((await find()).status).toBe('active');
      const legacy=await prisma.user.create({data:{username:`legacy-${randomUUID()}`,displayName:'同步历史员工',role:'publisher'}});
      const migrated=await prisma.$transaction(tx=>applyIdentityUser(tx,{...profile,subject:randomUUID(),username:legacy.username,name:legacy.displayName,localUserId:legacy.id}));
      expect(migrated).toMatchObject({id:legacy.id,role:'publisher'});
      const conflict={...profile,subject:randomUUID(),username:`conflict-${randomUUID()}`,name:'同步历史员工'};
      directory.mockResolvedValue([{...profile,name:'不应保存的改名'},conflict]);await sync.sync();
      expect((await find()).displayName).toBe(profile.name);
      expect(await prisma.user.count({where:{identitySubject:conflict.subject}})).toBe(0);
      directory.mockResolvedValue([]);await sync.sync();expect((await find()).identityEnabled).toBe(false);
      directory.mockResolvedValue([profile]);await sync.sync();expect((await find()).identityEnabled).toBe(true);
    } finally {directory.mockRestore();enabled.mockRestore();active.mockRestore();}
  });

  it('业务 API 必须真实登录，伪造角色请求头无效，并校验 CSRF', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/systems', headers: { 'x-user-role': 'system_admin' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/systems', headers: { cookie: sessions.system_admin!.cookie, 'content-type': 'application/json' }, payload: JSON.stringify({}) })).statusCode).toBe(403);
    expect((await request('GET', '/api/users', undefined, 'researcher')).statusCode).toBe(403);
    expect((await request('GET', '/api/users')).statusCode).toBe(200);
    expect((await request('POST', '/api/users/wecom-sync', {}, 'researcher')).statusCode).toBe(403);
    expect((await request('POST', '/api/users/wecom-sync', {})).statusCode).toBe(409);
    const status = await app.inject({ method: 'GET', url: '/api/auth/wecom/status' });
    expect(status.statusCode).toBe(200);
    expect(status.json().enabled).toBe(false);
    await expect(catalog.previewImport(versionId, Buffer.alloc(0), { userId: 'reader', name: '只读用户', role: 'reader' })).rejects.toThrow('当前指标体系');
  });

  it('指标体系列表和业务路由按体系授权过滤，权限管理仅系统管理员可用', async () => {
    const readerList = await request('GET', '/api/systems', undefined, 'reader');
    expect(readerList.statusCode).toBe(200);
    expect(readerList.json()).toEqual(expect.arrayContaining([expect.objectContaining({ id: systemId, access: expect.objectContaining({ canView: true, canResearch: false }) })]));

    const isolated = await prisma.user.create({ data: { username: 'isolated_reader', displayName: '未授权只读用户', passwordHash: await hashPassword('Integration!2026'), role: 'reader' } });
    await login('isolated_reader');
    expect((await request('GET', '/api/systems', undefined, 'isolated_reader')).json()).toEqual([]);
    expect((await request('GET', `/api/indicator-versions/${versionId}/tree`, undefined, 'isolated_reader')).statusCode).toBe(403);
    expect((await request('GET', `/api/systems/${systemId}/access`, undefined, 'researcher')).statusCode).toBe(403);

    const accessList = await request('GET', `/api/systems/${systemId}/access`);
    expect(accessList.statusCode).toBe(200);
    expect(accessList.json()).toEqual(expect.arrayContaining([expect.objectContaining({ userId: isolated.id, platformRoleLabel: '普通用户', permissions: expect.objectContaining({ canView: false }) })]));
    const firstScope = await request('PUT', `/api/systems/${systemId}/access/${isolated.id}`, { canView: true, canResearch: true });
    expect(firstScope.statusCode).toBe(200);
    expect(firstScope.json()).toMatchObject({ permissions: { canView: true, canResearch: true } });
    expect((await request('GET', `/api/systems/${systemId}/access/researchers`, undefined, 'isolated_reader')).statusCode).toBe(403);
    const candidates = await request('GET', `/api/systems/${systemId}/access/researchers`, undefined, 'catalog_manager');
    expect(candidates.statusCode).toBe(200);
    expect(candidates.json()).toEqual(expect.arrayContaining([expect.objectContaining({ username: 'researcher' })]));
    expect(candidates.json()).not.toEqual(expect.arrayContaining([expect.objectContaining({ username: 'ai_service' })]));
    const granted = await request('PUT', `/api/systems/${systemId}/access/${isolated.id}`, { canView: true });
    expect(granted.statusCode).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: isolated.id } })).role).toBe('reader');
    expect((await request('GET', '/api/systems', undefined, 'isolated_reader')).json()).toEqual(expect.arrayContaining([expect.objectContaining({ id: systemId })]));

    const second = await request('POST', '/api/systems', { name: '跨体系授权测试', code: 'ACCESS-SCOPE-2026', region: '测试区域', year: 2026, versionCode: 'V1' });
    expect(second.statusCode).toBe(201);
    const secondSystemId = second.json().id as string;
    const secondVersionId = second.json().version.id as string;
    const secondPublish = await request('PUT', `/api/systems/${secondSystemId}/access/${isolated.id}`, { canPublish: true });
    expect(secondPublish.statusCode).toBe(200);
    expect(secondPublish.json()).toMatchObject({ permissions: { canView: true, canResearch: false, canPublish: true } });
    expect((await request('POST', `/api/indicator-versions/${secondVersionId}/publish`, {}, 'isolated_reader')).statusCode).toBe(404);
    const scopedSystems = await request('GET', '/api/systems', undefined, 'isolated_reader');
    expect(scopedSystems.json()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: systemId, access: expect.objectContaining({ canResearch: false }) }),
      expect.objectContaining({ id: secondSystemId, access: expect.objectContaining({ canPublish: true }) }),
    ]));
    expect((await request('DELETE', `/api/systems/${systemId}/access/${isolated.id}`, {})).statusCode).toBe(200);
    expect((await request('DELETE', `/api/systems/${secondSystemId}/access/${isolated.id}`, {})).statusCode).toBe(200);
    expect((await request('GET', '/api/systems', undefined, 'isolated_reader')).json()).toEqual([]);
  });

  it('体系权限不受平台角色限制，可编辑权限无需指标分派', async () => {
    const reader = await prisma.user.findUniqueOrThrow({ where: { username: 'reader' } });
    await prisma.indicatorSystemAccess.update({ where: { systemId_userId: { systemId, userId: reader.id } }, data: { canResearch: true } });
    const scope = await createVersionTree('PLATFORM-ROLE-EDIT');
    await prisma.indicatorSystemAccess.create({ data: { systemId: scope.systemId, userId: reader.id, canView: true, canResearch: true } });
    const researchUrl = `/api/indicator-versions/${scope.versionId}/indicators/${scope.level3Id}/modules/portrait`;
    expect((await request('PATCH', researchUrl, { expectedRevisionNo: 0, values: [] }, 'reader')).statusCode).toBe(200);
    await prisma.indicatorSystemAccess.update({ where: { systemId_userId: { systemId, userId: reader.id } }, data: { canResearch: false } });

    const created = await request('POST', '/api/systems', { name: '目录管理员自建体系', code: 'CATALOG-OWNED-2026', region: '测试区域', year: 2026, versionCode: 'V1' }, 'catalog_manager');
    expect(created.statusCode).toBe(201);
    const systems = await request('GET', '/api/systems', undefined, 'catalog_manager');
    expect(systems.json()).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.json().id, access: expect.objectContaining({ canView: true, canManageCatalog: true }) })]));
  });

  it('目录完整性、检索父路径、排序、删除和目录角色权限均由服务端保证', async () => {
    const treeCase = await createVersionTree('TREE-RULES');
    const base = `/api/indicator-versions/${treeCase.versionId}`;
    expect((await request('POST', `${base}/nodes`, { level: 1, code: 'RESEARCHER-BLOCKED', name: '研究员不得维护目录' }, 'researcher')).statusCode).toBe(403);
    expect((await request('POST', `${base}/nodes`, { level: 3, parentId: treeCase.level2Id, code: 'TREE-RULES-L3', name: '同父节点重复编码' })).statusCode).toBe(409);
    expect((await request('POST', `${base}/nodes`, { level: 3, parentId: treeCase.level3Id, code: 'INVALID-CHILD', name: '三级指标下级' })).statusCode).toBe(400);
    expect((await request('PATCH', `${base}/nodes/${treeCase.level2Id}`, { parentId: treeCase.level2Id })).statusCode).toBe(400);
    const sorted = await request('PATCH', `${base}/nodes/${treeCase.level3Id}`, { sortOrder: 9 });
    expect(sorted.statusCode).toBe(200);
    expect(sorted.json().sortOrder).toBe(9);
    const filtered = await request('GET', `${base}/tree?q=TREE-RULES-L3`);
    expect(filtered.json()[0].children[0].children[0].id).toBe(treeCase.level3Id);
    expect((await request('DELETE', `${base}/nodes/${treeCase.level1Id}`, {})).statusCode).toBe(409);
    expect((await request('DELETE', `${base}/nodes/${treeCase.level3Id}`, {})).statusCode).toBe(204);
    expect((await request('DELETE', `${base}/nodes/${treeCase.level2Id}`, {})).statusCode).toBe(204);
    expect((await request('DELETE', `${base}/nodes/${treeCase.level1Id}`, {})).statusCode).toBe(204);
  });

  it('重复打开同一三级指标返回同一份八模块研究记录', async () => {
    const uniqueCase = await createVersionTree('RECORD-UNIQUE');
    const url = `/api/indicator-versions/${uniqueCase.versionId}/indicators/${uniqueCase.level3Id}/workspace`;
    const first = await request('GET', url);
    const second = await request('GET', url);
    expect(first.statusCode).toBe(200);
    expect(second.json().modules.map((item: { id: string }) => item.id)).toEqual(first.json().modules.map((item: { id: string }) => item.id));
    expect(await prisma.researchRecord.count({ where: { versionId: uniqueCase.versionId, indicatorNodeId: uniqueCase.level3Id } })).toBe(1);
  });

  it('体系可编辑权限直接生效，不再要求单指标授权', async () => {
    const scope = await createVersionTree('SYSTEM-EDIT-SCOPE');
    const user = await prisma.user.findUniqueOrThrow({ where: { username: 'unassigned_researcher' } });
    expect((await request('PUT', `/api/systems/${scope.systemId}/access/${user.id}`, { canResearch: true })).statusCode).toBe(200);
    const base = `/api/indicator-versions/${scope.versionId}/indicators/${scope.level3Id}`;
    expect((await request('GET', base + '/workspace', undefined, 'unassigned_researcher')).statusCode).toBe(200);
    expect((await request('PATCH', base + '/modules/portrait', { expectedRevisionNo: 0, values: [] }, 'unassigned_researcher')).statusCode).toBe(200);
    expect((await request('POST', base + '/assignments', { userId: user.id })).statusCode).toBe(404);
    expect((await request('PUT', `/api/systems/${scope.systemId}/access/${user.id}`, { canView: true, canResearch: false })).statusCode).toBe(200);
    expect((await request('PATCH', base + '/modules/portrait', { expectedRevisionNo: 1, values: [] }, 'unassigned_researcher')).statusCode).toBe(403);
  });

  it('智谱语义库：权限、读写向量、增量复用、停用过滤和失败回退', async () => {
    const scope = await createVersionTree('SEMANTIC');
    const moduleUrl = `/api/indicator-versions/${scope.versionId}/indicators/${scope.level3Id}/modules/portrait`;
    await request('GET', `/api/indicator-versions/${scope.versionId}/indicators/${scope.level3Id}/workspace`);
    expect((await request('PATCH', moduleUrl, { expectedRevisionNo: 0, values: [{ fieldKey: 'assessment_scope', value: '信用修复办理流程' }] })).statusCode).toBe(200);
    expect((await request('POST', '/api/semantic-libraries', { versionId: scope.versionId }, 'isolated_reader')).statusCode).toBe(403);
    const created = await request('POST', '/api/semantic-libraries', { versionId: scope.versionId });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    const service = app.get(SemanticService);
    const gateway = app.get(ZhipuEmbedding);
    const config = vi.spyOn(gateway, 'configured', 'get').mockReturnValue(true);
    const vector = Array(1024).fill(0); vector[0] = 1;
    const embed = vi.spyOn(gateway, 'embed').mockImplementation(async inputs => ({ vectors: inputs.map(() => vector), tokens: inputs.length }));
    try {
      expect((await request('POST', `/api/semantic-libraries/${id}/build`, { consent: false })).statusCode).toBe(400);
      expect((await request('POST', `/api/semantic-libraries/${id}/build`, { consent: true })).statusCode).toBe(201);
      await service.tick();
      let detail = (await request('GET', `/api/semantic-libraries/${id}`)).json();
      expect(detail.active.status).toBe('ready');
      const result = await request('POST', `/api/semantic-libraries/${id}/search`, { query: '信用修复', consent: true });
      expect(result.statusCode).toBe(201);
      expect(result.json().matches[0].nodeId).toBe(scope.level3Id);
      expect(embed).toHaveBeenLastCalledWith(['信用修复']);
      expect((await request('GET', `/api/semantic-libraries/${id}`, undefined, 'isolated_reader')).statusCode).toBe(403);
      expect((await request('GET', '/api/semantic-libraries', undefined, 'isolated_reader')).json().libraries).toEqual([]);
      const before = embed.mock.calls.length;
      await request('POST', `/api/semantic-libraries/${id}/build`, { consent: true }); await service.tick();
      expect(embed.mock.calls.length).toBe(before);
      detail = (await request('GET', `/api/semantic-libraries/${id}`)).json();
      expect(detail.active.reused).toBe(detail.active.total);
      expect((await request('PATCH', moduleUrl, { expectedRevisionNo: 1, values: [{ fieldKey: 'assessment_scope', value: '新口径' }] })).statusCode).toBe(200);
      const changed = (await request('POST', `/api/semantic-libraries/${id}/search`, { query: '信用修复', consent: true })).json();
      expect(changed.pendingChanges).toBe(true); expect(changed.matches).toEqual([]);
      embed.mockRejectedValueOnce(new Error('测试供应商故障'));
      await request('POST', `/api/semantic-libraries/${id}/build`, { consent: true }); await service.tick();
      const failed = (await request('GET', `/api/semantic-libraries/${id}`)).json();
      expect(failed.builds[0].status).toBe('failed'); expect(failed.active.id).toBe(detail.active.id);
      expect((await request('DELETE', `/api/semantic-libraries/${id}`, {})).statusCode).toBe(200);
      expect(await prisma.indicatorNode.count({ where: { versionId: scope.versionId } })).toBe(3);
    } finally { embed.mockRestore(); config.mockRestore(); }
  });

  it('模型管理只允许系统管理员，密钥加密且不回显，停用立即生效', async () => {
    expect((await request('GET', '/api/model-management', undefined, 'reader')).statusCode).toBe(403);
    const before = (await request('GET', '/api/model-management')).json();
    expect((await request('PUT', '/api/model-management', { revision: before.revision, enabled: true, apiKey: 'integration-not-a-real-key' }, 'reader')).statusCode).toBe(403);
    const saved = await request('PUT', '/api/model-management', { revision: before.revision, enabled: true, apiKey: 'integration-not-a-real-key' });
    expect(saved.statusCode).toBe(200); expect(saved.json().hasKey).toBe(true);
    expect(saved.body).not.toContain('integration-not-a-real-key');
    const row = await prisma.embeddingModelConfig.findUniqueOrThrow({ where: { id: 'zhipu-embedding' } });
    expect(row.encryptedKey).not.toContain('integration-not-a-real-key');
    expect((await request('PUT', '/api/model-management', { revision: before.revision, enabled: false })).statusCode).toBe(409);
    const disabled = await request('PUT', '/api/model-management', { revision: saved.json().revision, enabled: false });
    expect(disabled.json().configured).toBe(false);
    expect((await request('POST', '/api/model-management/test', {})).statusCode).toBe(503);
    await prisma.embeddingModelConfig.deleteMany();
  });

  it('管理员停用用户后，该用户旧会话立即失效', async () => {
    const user = await prisma.user.create({ data: { username: 'disabled_case', displayName: '待停用用户', passwordHash: await hashPassword('Integration!2026'), role: 'reader' } });
    await login('disabled_case');
    expect((await request('GET', '/api/systems', undefined, 'disabled_case')).statusCode).toBe(200);
    expect((await request('PATCH', `/api/users/${user.id}`, { status: 'disabled' })).statusCode).toBe(200);
    expect((await request('GET', '/api/systems', undefined, 'disabled_case')).statusCode).toBe(401);
  });

  it('退出和重置密码都会撤销旧会话，连续失败会锁定账号', async () => {
    const created = await request('POST', '/api/users', { username: 'session_case', displayName: '会话测试用户', password: 'Integration!2026', role: 'reader' });
    expect(created.statusCode).toBe(201);
    await login('session_case');
    const oldSession = { ...sessions.session_case! };
    const logout = await request('POST', '/api/auth/logout', {}, 'session_case');
    expect(logout.statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/api/systems', headers: { cookie: oldSession.cookie } })).statusCode).toBe(401);

    await login('session_case');
    const sessionBeforeReset = { ...sessions.session_case! };
    expect((await request('POST', `/api/users/${created.json().id}/reset-password`, { password: 'ChangedPass!2026' })).statusCode).toBe(201);
    expect((await app.inject({ method: 'GET', url: '/api/systems', headers: { cookie: sessionBeforeReset.cookie } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ username: 'session_case', password: 'ChangedPass!2026' }) })).statusCode).toBe(200);

    await prisma.user.create({ data: { username: 'lock_case', displayName: '锁定测试用户', passwordHash: await hashPassword('Integration!2026'), role: 'reader' } });
    for (let index = 0; index < 5; index += 1) {
      expect((await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ username: 'lock_case', password: 'wrong-password' }) })).statusCode).toBe(401);
    }
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ username: 'lock_case', password: 'Integration!2026' }) })).statusCode).toBe(429);
  });

  it('并发失败不丢计数，锁定到期重新计数，正常密码仍可登录', async () => {
    const username = 'concurrent_lock_case';
    const user = await prisma.user.create({ data: { username, displayName: '并发锁定测试', passwordHash: await hashPassword('Integration!2026'), role: 'reader' } });
    const attempt = (password = 'wrong-password') => app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } });
    const results = await Promise.all(Array.from({ length: 20 }, () => attempt()));
    expect(results.every(result => [401, 429].includes(result.statusCode))).toBe(true);
    const accepted = results.filter(result => result.statusCode === 401).length;
    expect(accepted).toBeGreaterThan(0);
    expect(accepted).toBeLessThanOrEqual(5);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).failedLoginCount).toBe(accepted);
    for (let i = accepted; i < 5; i++) expect((await attempt()).statusCode).toBe(401);
    expect((await attempt('Integration!2026')).statusCode).toBe(429);
    await prisma.user.update({ where: { id: user.id }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    expect((await attempt()).statusCode).toBe(401);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).failedLoginCount).toBe(1);
    expect((await attempt('Integration!2026')).statusCode).toBe(200);
  });

  it('企业微信显式解绑保留撤销标记，管理员重新绑定才解除', async () => {
    vi.stubEnv('WECOM_CORP_ID', 'security-test-corp');
    const user = await prisma.user.create({ data: { displayName: '解绑验证', role: 'reader', authSource: 'wecom' } });
    const base = `/api/users/${user.id}/wecom-identities`;
    expect((await request('POST', base, { externalUserId: 'security-test-member' })).statusCode).toBe(201);
    const identity = await prisma.weComIdentity.findFirstOrThrow({ where: { userId: user.id } });
    expect((await request('POST', `${base}/${identity.id}/unbind`, {})).statusCode).toBe(201);
    const key = { corpId: 'security-test-corp', externalUserId: 'security-test-member' };
    expect(await prisma.weComIdentityRevocation.findUnique({ where: { corpId_externalUserId: key } })).not.toBeNull();
    expect(await prisma.weComIdentity.findUnique({ where: { id: identity.id } })).toBeNull();
    expect((await request('POST', base, { externalUserId: key.externalUserId }, 'reader')).statusCode).toBe(403);
    expect((await request('POST', base, { externalUserId: key.externalUserId })).statusCode).toBe(201);
    expect(await prisma.weComIdentityRevocation.findUnique({ where: { corpId_externalUserId: key } })).toBeNull();
    vi.unstubAllEnvs();
  });

  it('本地用户修改密码后保留当前会话、撤销其他会话并记录审计日志', async () => {
    const user = await prisma.user.create({ data: { username: 'change_password_case', displayName: '改密测试用户', passwordHash: await hashPassword('Integration!2026'), role: 'reader' } });
    await login('change_password_case');
    const otherSession = { ...sessions.change_password_case! };
    await login('change_password_case');
    const currentSession = { ...sessions.change_password_case! };

    expect((await request('POST', '/api/auth/change-password', { currentPassword: 'wrong-password', newPassword: 'ChangedPass!2026' }, 'change_password_case')).statusCode).toBe(403);
    expect((await request('POST', '/api/auth/change-password', { currentPassword: 'Integration!2026', newPassword: 'short' }, 'change_password_case')).statusCode).toBe(409);
    expect((await request('POST', '/api/auth/change-password', { currentPassword: 'Integration!2026', newPassword: 'Integration!2026' }, 'change_password_case')).statusCode).toBe(409);

    const changed = await request('POST', '/api/auth/change-password', { currentPassword: 'Integration!2026', newPassword: 'ChangedPass!2026' }, 'change_password_case');
    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toMatchObject({ changed: true, revokedSessions: 1 });
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: currentSession.cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: otherSession.cookie } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ username: 'change_password_case', password: 'Integration!2026' }) })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ username: 'change_password_case', password: 'ChangedPass!2026' }) })).statusCode).toBe(200);
    expect(await prisma.auditLog.count({ where: { actorUserId: user.id, action: 'user.password_changed' } })).toBe(1);
  });

  it('并发改密只成功一次，错误密码预算跨会话生效', async () => {
    const username = 'password-race';
    const user = await prisma.user.create({ data: { username, displayName: username, passwordHash: await hashPassword('Integration!2026'), role: 'reader' } });
    await login(username);
    const payload = { currentPassword: 'Integration!2026', newPassword: 'UpdatedPassword!2026' };
    const responses = await Promise.all([request('POST', '/api/auth/change-password', payload, username), request('POST', '/api/auth/change-password', payload, username)]);
    expect(responses.filter(value => value.statusCode === 200)).toHaveLength(1);
    expect(responses.every(value => [200, 401, 403, 429].includes(value.statusCode))).toBe(true);
    expect(await prisma.auditLog.count({ where: { actorUserId: user.id, action: 'user.password_changed' } })).toBe(1);
    await prisma.authChallenge.deleteMany({ where: { userId: user.id } });
    for (let i = 0; i < 5; i++) expect((await request('POST', '/api/auth/change-password', { ...payload, currentPassword: 'wrong' }, username)).statusCode).toBe(403);
    const relogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password: payload.newPassword } });
    expect(relogin.statusCode).toBe(200);
    const loginCookies = relogin.headers['set-cookie'];
    sessions[username] = { cookie: (Array.isArray(loginCookies) ? loginCookies : [String(loginCookies)]).map(value => value.split(';')[0]).join('; '), csrf: relogin.json().csrfToken };
    expect((await request('POST', '/api/auth/change-password', { ...payload, currentPassword: payload.newPassword, newPassword: 'AnotherPassword!2026' }, username)).statusCode).toBe(429);
    expect(await prisma.authChallenge.count({ where: { userId: user.id, purpose: 'reauth_failure' } })).toBe(5);
  });

  it('改密要求当前有效会话及近期已允许的多因素验证', async () => {
    const username = 'password-mfa';
    const user = await prisma.user.create({ data: { username, displayName: username, passwordHash: await hashPassword('Integration!2026'), role: 'reader' } });
    await login(username);
    const session = await prisma.authSession.findFirstOrThrow({ where: { userId: user.id } });
    await prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: true, mfaMethods: ['totp'] } });
    const payload = { currentPassword: 'Integration!2026', newPassword: 'UpdatedPassword!2026' };
    for (const data of [{ authMethods: ['local'], verifiedAt: new Date() }, { authMethods: ['local', 'email'], verifiedAt: new Date() }, { authMethods: ['local', 'totp'], verifiedAt: new Date(Date.now() - 301_000) }, { authMethods: ['local', 'totp'], verifiedAt: new Date(Date.now() + 60_000) }]) {
      await prisma.authSession.update({ where: { id: session.id }, data });
      expect((await request('POST', '/api/auth/change-password', payload, username)).statusCode).toBe(403);
    }
    await prisma.authSession.update({ where: { id: session.id }, data: { authMethods: ['local', 'totp'], verifiedAt: new Date() } });
    const service = app.get(AuthService);
    await expect(service.changePassword({ userId: user.id, name: username, role: 'reader' }, 'missing-session', payload.currentPassword, payload.newPassword)).rejects.toThrow('重新登录');
    const actor = { userId: user.id, name: username, role: 'reader' as const };
    const otherSession = await prisma.authSession.findFirstOrThrow({ where: { userId: { not: user.id } } });
    await expect(service.changePassword(actor, otherSession.id, payload.currentPassword, payload.newPassword)).rejects.toThrow('重新登录');
    for (const data of [{ revokedAt: new Date() }, { expiresAt: new Date(0) }, { securityVersion: session.securityVersion + 1 }]) {
      await prisma.authSession.update({ where: { id: session.id }, data: { revokedAt: null, expiresAt: session.expiresAt, securityVersion: session.securityVersion, ...data } });
      await expect(service.changePassword(actor, session.id, payload.currentPassword, payload.newPassword)).rejects.toThrow('重新登录');
    }
    await prisma.authSession.update({ where: { id: session.id }, data: { revokedAt: null, expiresAt: session.expiresAt, securityVersion: session.securityVersion } });
    expect((await request('POST', '/api/auth/change-password', payload, username)).statusCode).toBe(200);
  });

  it('未初始化的企业微信账号旧会话不能访问业务或直接改密', async () => {
    const user = await prisma.user.create({ data: { username: null, displayName: '企业微信测试用户', passwordHash: null, role: 'reader', authSource: 'wecom' } });
    const rawToken = 'wecom-change-password-session';
    const csrfToken = 'wecom-change-password-csrf';
    const cookie = ['mg_expert_session', rawToken].join('=');
    await prisma.authSession.create({ data: { tokenHash: sha256(rawToken), csrfToken, userId: user.id, expiresAt: new Date(Date.now() + 60_000) } });
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { cookie, 'x-csrf-token': csrfToken, 'content-type': 'application/json' },
      payload: JSON.stringify({ currentPassword: 'unused-password', newPassword: 'ChangedPass!2026' }),
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().message).toContain('账户设置');
  });

  it('首次设置只签发短期挑战，防跨浏览器、重名和重放，并保留企微关联', async () => {
    const auth = app.get(AuthService);
    const user = await prisma.user.create({ data: { displayName: '张三', authSource: 'wecom', role: 'reader' } });
    const identity = await prisma.weComIdentity.create({ data: { userId: user.id, corpId: 'setup-corp', externalUserId: 'setup-external' } });
    await prisma.user.create({ data: { displayName: '重名用户', username: 'zhangsan' } });
    const result = await prisma.$transaction(tx => auth.beginAuthentication(user, {}, 'wecom', tx));
    expect(result.state).toBe('setup_required');
    if (result.state === 'authenticated') throw new Error('初始化前不应签发会话');
    expect(await prisma.authSession.count({ where: { userId: user.id } })).toBe(0);
    const cookie = `mg_expert_challenge=${result.rawToken}; mg_expert_challenge_browser=${result.browserNonce}`;
    expect((await app.inject({ method: 'GET', url: '/api/systems', headers: { cookie } })).statusCode).toBe(401);
    const status = await app.inject({ method: 'GET', url: '/api/auth/pending', headers: { cookie } });
    expect(status.json().username).toBe('zhangsan1');
    const submit = (username: string, token = status.json().csrfToken, cookies = cookie) => app.inject({ method: 'POST', url: '/api/auth/setup', headers: { cookie: cookies, 'x-csrf-token': token }, payload: { username, password: 'SetupPassword!2026' } });
    expect((await submit('zhangsan1', 'bad-csrf')).statusCode).toBe(403);
    expect((await submit('zhangsan1', status.json().csrfToken, `mg_expert_challenge=${result.rawToken}; mg_expert_challenge_browser=wrong`)).statusCode).toBe(401);
    expect((await submit('zhangsan')).statusCode).toBe(409);
    const completed = await Promise.all([submit('mynewname'), submit('mynewname')]);
    expect(completed.filter(value => value.statusCode === 200)).toHaveLength(1);
    expect(completed.filter(value => value.statusCode === 401)).toHaveLength(1);
    expect((await prisma.weComIdentity.findUniqueOrThrow({ where: { id: identity.id } })).userId).toBe(user.id);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).role).toBe('reader');
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'mynewname', password: 'SetupPassword!2026' } })).statusCode).toBe(200);
    expect((await submit('anothername')).statusCode).toBe(401);
  });

  it('认证器绑定、开启多因素、验证码与恢复码均不能重复使用', async () => {
    const username = 'mfa-test';
    await prisma.user.create({ data: { username, displayName: '多因素测试', passwordHash: await hashPassword('Integration!2026'), role: 'reader' } });
    await login(username);
    const authorize = await request('POST', '/api/account-security/authorize', { password: 'Integration!2026' }, username);
    expect(authorize.statusCode).toBe(201);
    const started = await request('POST', '/api/account-security/totp/start', { token: authorize.json().token }, username);
    expect(started.statusCode).toBe(201);
    const totp = new TOTP({ secret: started.json().secret, digits: 6, period: 30 });
    const confirmed = await request('POST', '/api/account-security/totp/confirm', { token: started.json().token, code: totp.generate() }, username);
    expect(confirmed.json().ok).toBe(true);
    const grant = await request('POST', '/api/account-security/authorize', { password: 'Integration!2026' }, username);
    const enabled = await request('POST', '/api/account-security/mfa', { token: grant.json().token, enabled: true, methods: ['totp'] }, username);
    expect(enabled.statusCode).toBe(201);
    expect(enabled.json().recoveryCodes).toHaveLength(10);
    const first = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password: 'Integration!2026' } });
    expect(first.json().state).toBe('mfa_required');
    const cookies = (first.headers['set-cookie'] as string[]).map(cookie => cookie.split(';')[0]).join('; ');
    expect((await app.inject({ method: 'GET', url: '/api/systems', headers: { cookie: cookies } })).statusCode).toBe(401);
    const status = await app.inject({ method: 'GET', url: '/api/auth/pending', headers: { cookie: cookies } });
    const submit = (method: string, code: string) => app.inject({ method: 'POST', url: '/api/auth/mfa', headers: { cookie: cookies, 'x-csrf-token': status.json().csrfToken }, payload: { method, code } });
    // 绑定时已消费当前时间步，允许的下一时间步用于模拟认证器时钟偏差。
    expect((await submit('totp', totp.generate())).statusCode).toBe(403);
    expect((await submit('totp', totp.generate({ timestamp: Date.now() + 30_000 }))).statusCode).toBe(200);
    expect((await submit('recovery', enabled.json().recoveryCodes[0])).statusCode).toBe(401);
    const second = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password: 'Integration!2026' } });
    const secondCookies = (second.headers['set-cookie'] as string[]).map(cookie => cookie.split(';')[0]).join('; ');
    const secondStatus = await app.inject({ method: 'GET', url: '/api/auth/pending', headers: { cookie: secondCookies } });
    const recovery = () => app.inject({ method: 'POST', url: '/api/auth/mfa', headers: { cookie: secondCookies, 'x-csrf-token': secondStatus.json().csrfToken }, payload: { method: 'recovery', code: enabled.json().recoveryCodes[0] } });
    const recovered = await Promise.all([recovery(), recovery()]);
    expect(recovered.map(value => value.statusCode).sort()).toEqual([200, 401]);
    const restored = recovered.find(value => value.statusCode === 200)!;
    sessions[username] = { cookie: (restored.headers['set-cookie'] as string[]).map(value => value.split(';')[0]).join('; '), csrf: restored.json().csrfToken };
    const recoveryProof = { password: 'Integration!2026', method: 'recovery', code: enabled.json().recoveryCodes[1] };
    expect((await request('POST', '/api/account-security/authorize', { ...recoveryProof, password: 'wrong' }, username)).statusCode).toBe(403);
    const grants = await Promise.all([request('POST', '/api/account-security/authorize', recoveryProof, username), request('POST', '/api/account-security/authorize', recoveryProof, username)]);
    expect(grants.map(value => value.statusCode).sort()).toEqual([201, 403]);
    expect((await request('POST', '/api/account-security/authorize', { ...recoveryProof, code: enabled.json().recoveryCodes[0] }, username)).statusCode).toBe(403);
    const ownerBefore = await prisma.user.findUniqueOrThrow({ where: { username } });
    await prisma.recoveryCode.deleteMany({ where: { userId: ownerBefore.id } });
    expect((await request('GET', '/api/account-security', undefined, username)).json().recentRecovery).toBe(true);
    const freshGrant = await request('POST', '/api/account-security/authorize', { password: 'Integration!2026', method: 'recovery_session' }, username);
    expect(freshGrant.statusCode).toBe(201);
    const disabled = await request('POST', '/api/account-security/mfa', { token: freshGrant.json().token, enabled: false, methods: [] }, username);
    expect(disabled.statusCode).toBe(201);
    const owner = await prisma.user.findUniqueOrThrow({ where: { username } });
    expect(await prisma.recoveryCode.count({ where: { userId: owner.id } })).toBe(0);
    expect((await request('POST', '/api/account-security/authorize', { password: 'Integration!2026' }, username)).statusCode).toBe(201);
  });

  it('恢复会话复核拒绝普通会话、错误密码和过期恢复验证', async () => {
    const username = 'recovery-window';
    const user = await prisma.user.create({ data: { username, displayName: '恢复窗口', passwordHash: await hashPassword('Integration!2026'), role: 'reader' } });
    await login(username);
    await prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: true, mfaMethods: ['totp'] } });
    const proof = { password: 'Integration!2026', method: 'recovery_session' };
    expect((await request('POST', '/api/account-security/authorize', proof, username)).statusCode).toBe(403);
    await prisma.authSession.updateMany({ where: { userId: user.id }, data: { authMethods: ['local', 'recovery'], verifiedAt: new Date() } });
    expect((await request('POST', '/api/account-security/authorize', { ...proof, password: 'wrong' }, username)).statusCode).toBe(403);
    await prisma.authSession.updateMany({ where: { userId: user.id }, data: { verifiedAt: new Date(Date.now() - 301_000) } });
    expect((await request('GET', '/api/account-security', undefined, username)).json().recentRecovery).toBe(false);
    expect((await request('POST', '/api/account-security/authorize', proof, username)).statusCode).toBe(403);
  });

  it('邮箱绑定与登录验证码隔离、限频、仅一次有效且不明文存储', async () => {
    const username = 'email-test';
    const user = await prisma.user.create({ data: { username, displayName: '邮箱测试', passwordHash: await hashPassword('Integration!2026'), role: 'reader' } });
    await login(username);
    let sentCode = '';
    const sender = vi.spyOn(app.get(MailConfigService), 'send').mockImplementation(async (_to, _subject, text) => { sentCode = text.match(/\d{6}/)![0]; });
    try {
      const grant = await request('POST', '/api/account-security/authorize', { password: 'Integration!2026' }, username);
      const binding = await request('POST', '/api/account-security/email/start', { token: grant.json().token, address: 'email-test@example.com' }, username);
      expect(binding.statusCode).toBe(201);
      expect(JSON.stringify(binding.json())).not.toContain(sentCode);
      const stored = await prisma.authChallenge.findFirstOrThrow({ where: { userId: user.id, purpose: 'email_code' } });
      expect(JSON.stringify(stored.payload)).not.toContain(sentCode);
      expect((await request('POST', '/api/account-security/email/confirm', { token: binding.json().token, code: sentCode }, username)).json().ok).toBe(true);
      const enableGrant = await request('POST', '/api/account-security/authorize', { password: 'Integration!2026' }, username);
      expect((await request('POST', '/api/account-security/mfa', { token: enableGrant.json().token, enabled: true, methods: ['email'] }, username)).statusCode).toBe(201);
      const first = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password: 'Integration!2026' } });
      expect(first.json().state).toBe('mfa_required');
      const cookie = (first.headers['set-cookie'] as string[]).map(value => value.split(';')[0]).join('; ');
      const status = await app.inject({ method: 'GET', url: '/api/auth/pending', headers: { cookie } });
      const headers = { cookie, 'x-csrf-token': status.json().csrfToken };
      expect((await app.inject({ method: 'POST', url: '/api/auth/mfa/email', headers })).statusCode).toBe(429);
      await prisma.authChallenge.updateMany({ where: { userId: user.id, purpose: 'email_code' }, data: { createdAt: new Date(Date.now() - 61_000) } });
      expect((await app.inject({ method: 'POST', url: '/api/auth/mfa/email', headers })).statusCode).toBe(200);
      const submit = () => app.inject({ method: 'POST', url: '/api/auth/mfa', headers, payload: { method: 'email', code: sentCode } });
      const outcomes = await Promise.all([submit(), submit()]);
      expect(outcomes.map(value => value.statusCode).sort()).toEqual([200, 401]);
      expect(sender).toHaveBeenCalledTimes(2);
    } finally { sender.mockRestore(); }
  });

  it('健康检查可用，各级指标按所属层级建立工作台', async () => {
    expect((await request('GET', '/api/health')).statusCode).toBe(200);
    expect((await request('GET', `/api/indicator-versions/${versionId}/indicators/${level2Id}/workspace`)).statusCode).toBe(200);
    const workspace = await request('GET', `/api/indicator-versions/${versionId}/indicators/${level3Id}/workspace`);
    expect(workspace.statusCode).toBe(200);
    expect(workspace.json().modules.map((module: { moduleKey: string }) => module.moduleKey)).toEqual(['portrait', 'policy', 'data', 'quality', 'governance', 'rectify', 'optimize', 'contacts']);
  });

  it('体系详情返回版本概览、目录统计、模块状态和完整指标树', async () => {
    const detail = await request('GET', `/api/indicator-versions/${versionId}`);
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      id: systemId,
      versionId,
      name: '集成测试体系',
      counts: { level1: 1, level2: 1, level3: 1, researchRecords: 2 },
      moduleStatusCounts: { not_started: 11, in_progress: 0, pending_review: 0, confirmed: 0, returned: 0 },
      tree: [expect.objectContaining({ level: 1, children: [expect.objectContaining({ level: 2, children: [expect.objectContaining({ id: level3Id, level: 3, progress: 0 })] })] })],
    });
  });

  it('reader 被拒绝写入，保存创建修订并拒绝陈旧 revision', async () => {
    const url = `/api/indicator-versions/${versionId}/indicators/${level3Id}/modules/portrait`;
    expect((await request('PATCH', url, { expectedRevisionNo: 0, values: [{ fieldKey: 'indicator_nature', value: '正向指标' }] }, 'reader')).statusCode).toBe(403);
    const saved = await request('PATCH', url, { expectedRevisionNo: 0, values: [{ fieldKey: 'indicator_nature', value: '正向指标' }] }, 'researcher');
    expect(saved.statusCode).toBe(200); expect(saved.json().revisionNo).toBe(1);
    expect((await request('PATCH', url, { expectedRevisionNo: 0, values: [{ fieldKey: 'indicator_nature', value: '逆向指标' }] }, 'researcher')).statusCode).toBe(409);
    const revisions = await request('GET', `/api/indicator-versions/${versionId}/indicators/${level3Id}/revisions`);
    expect(revisions.json()).toHaveLength(1);
  });

  it('Excel 预检返回行号、字段和错误，不把空白名称当作事实导入', async () => {
    const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet('指标目录');
    sheet.addRow(['level', 'code', 'name', 'parentCode']); sheet.addRow([2, 'BAD-L2', '', 'MISSING']);
    const preview = await catalog.previewImport(versionId, Buffer.from(await workbook.xlsx.writeBuffer()), adminActor);
    expect(preview).toMatchObject({ valid: false });
    expect((preview as { errors: Array<{ row: number; field: string }> }).errors).toEqual(expect.arrayContaining([expect.objectContaining({ row: 2, field: 'name' }), expect.objectContaining({ row: 2, field: 'parentCode' })]));
  });

  // 三次独立解析各有 15 秒生产硬超时；用例总预算需覆盖三次解析及数据库检查。
  it('目录导入与预检使用同一规则，子行在前仍按层级写入并识别现有编码冲突', async () => {
    const created = await request('POST', '/api/systems', { name: '导入测试体系', code: 'IMPORT-TEST-2026', region: '测试区域', year: 2026, versionCode: 'V1' });
    const importVersionId = created.json().version.id;
    const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet('指标目录');
    sheet.addRow(['level', 'code', 'name', 'parentCode', 'sortOrder']);
    sheet.addRow([3, 'IMP-L3', '导入三级指标', 'IMP-L2', 1]);
    sheet.addRow([1, 'IMP-L1', '导入一级指标', '', 1]);
    sheet.addRow([2, 'IMP-L2', '导入二级指标', 'IMP-L1', 1]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    expect(await catalog.previewImport(importVersionId, buffer, adminActor)).toMatchObject({ valid: true });
    const admin = await prisma.user.findUniqueOrThrow({ where: { username: 'system_admin' } });
    await catalog.importTree(importVersionId, buffer, { userId: admin.id, name: admin.displayName, role: 'system_admin' });
    const tree = await catalog.getTree(importVersionId) as Array<{ code: string; children: Array<{ code: string; children: Array<{ code: string }> }> }>;
    expect(tree[0]?.code).toBe('IMP-L1');
    expect(tree[0]?.children[0]?.code).toBe('IMP-L2');
    expect(tree[0]?.children[0]?.children[0]?.code).toBe('IMP-L3');
    const duplicate = await catalog.previewImport(importVersionId, buffer, adminActor) as { valid: boolean; errors: Array<{ field: string; reason: string }> };
    expect(duplicate.valid).toBe(false);
    expect(duplicate.errors).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'code', reason: expect.stringContaining('已有目录重复') })]));
  }, 50_000);

  it('服务端按 Schema 拒绝错误字段类型，并持久化合法不适用理由', async () => {
    const portraitUrl = `/api/indicator-versions/${versionId}/indicators/${level3Id}/modules/portrait`;
    expect((await request('PATCH', portraitUrl, { expectedRevisionNo: 1, values: [{ fieldKey: 'indicator_nature', value: '非法枚举值' }] }, 'researcher')).statusCode).toBe(400);
    expect((await request('PATCH', portraitUrl, { expectedRevisionNo: 1, values: [{ fieldKey: 'assessment_weight', value: 101 }] }, 'researcher')).statusCode).toBe(400);
    const governanceUrl = `/api/indicator-versions/${versionId}/indicators/${level3Id}/modules/governance`;
    expect((await request('PATCH', governanceUrl, { expectedRevisionNo: 0, values: [], notApplicableReasons: { governance_model: '不允许' } }, 'researcher')).statusCode).toBe(400);
    const saved = await request('PATCH', governanceUrl, { expectedRevisionNo: 0, values: [], notApplicableReasons: { vertical_responsibilities: '当前指标不存在垂直管理职责。' } }, 'researcher');
    expect(saved.statusCode).toBe(200);
    expect(saved.json().values.find((item: { fieldKey: string }) => item.fieldKey === 'vertical_responsibilities').notApplicableReason).toContain('不存在垂直管理职责');
  });

  it('依据材料支持新增、完整查看、编辑替换状态和删除', async () => {
    const base = `/api/indicator-versions/${versionId}/indicators/${level3Id}`;
    const created = await request('POST', `${base}/modules/portrait/evidence`, { type: 'case', title: '待替换案例', sourceUrl: 'https://example.com/old', verificationStatus: 'pending_verification', fieldKeys: ['horizontal_relations'] }, 'researcher');
    expect(created.statusCode).toBe(201);
    const updated = await request('PUT', `${base}/evidence/${created.json().id}`, { title: '替换后案例', sourceUrl: 'https://example.com/new', verificationStatus: 'invalid' }, 'researcher');
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ title: '替换后案例', verificationStatus: 'invalid' });
    const list = await request('GET', `${base}/evidence`, undefined, 'researcher');
    expect(list.json()).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.json().id, title: '替换后案例' })]));
    expect((await request('DELETE', `${base}/evidence/${created.json().id}`, {}, 'researcher')).statusCode).toBe(204);
  });

  it('AI只能提交候选建议，研究员采纳后才写入正式模块并生成修订', async () => {
    const suggestionsUrl = `/api/indicator-versions/${versionId}/indicators/${level3Id}/ai-suggestions`;
    const input = { targetType: 'module', moduleKey: 'portrait', fieldKey: 'assessment_scope', content: '建议补充省、市、县三级考核范围。', rationale: '用于核对指标覆盖边界。', confidence: 'needs_verification', verificationItems: ['核对正式考核文件'], modelId: 'integration-model', promptVersion: 'integration-v1' };
    expect((await request('POST', suggestionsUrl, input, 'researcher')).statusCode).toBe(403);
    const created = await request('POST', suggestionsUrl, input, 'ai_service');
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ status: 'pending', targetType: 'module', modelId: 'integration-model', verificationItems: ['核对正式考核文件'] });
    const decided = await request('POST', `${suggestionsUrl}/${created.json().id}/decision`, { decision: 'accepted', expectedRevisionNo: 1 }, 'researcher');
    expect(decided.statusCode).toBe(201);
    expect(decided.json().module.revisionNo).toBe(2);
    const revisions = await request('GET', `/api/indicator-versions/${versionId}/indicators/${level3Id}/revisions`);
    expect(revisions.json().filter((item: { moduleKey: string }) => item.moduleKey === 'portrait')).toHaveLength(2);

    const sourceRevisionId = revisions.json().find((item: { moduleKey: string }) => item.moduleKey === 'portrait').id as string;
    const summarySuggestion = await request('POST', suggestionsUrl, { targetType: 'summary', content: '建议形成“政策依据—数据链路—整改闭环”的研究摘要。', rationale: '八模块已有修订可作为摘要来源，仍需人工核验。', confidence: 'needs_verification', sourceRevisionIds: [sourceRevisionId], verificationItems: ['核对摘要是否覆盖全部八模块'] }, 'ai_service');
    expect(summarySuggestion.statusCode).toBe(201);
    const acceptedSummary = await request('POST', `${suggestionsUrl}/${summarySuggestion.json().id}/decision`, { decision: 'accepted', expectedRevisionNo: 0 }, 'researcher');
    expect(acceptedSummary.statusCode).toBe(201);
    expect(acceptedSummary.json().summary).toMatchObject({ revisionNo: 1, sourceRevisionIds: [sourceRevisionId] });
    const rejectedSummary = await request('POST', suggestionsUrl, { targetType: 'summary', content: '这条摘要不会进入正式内容。', rationale: '用于验证拒绝边界。', sourceRevisionIds: [sourceRevisionId] }, 'ai_service');
    expect((await request('POST', `${suggestionsUrl}/${rejectedSummary.json().id}/decision`, { decision: 'rejected', reason: '来源不足' }, 'researcher')).statusCode).toBe(201);
    const summaryWorkspace = await request('GET', `/api/indicator-versions/${versionId}/indicators/${level3Id}/workspace`);
    expect(summaryWorkspace.json().summary).toContain('政策依据');
  });

  it('并发采纳同一模块修订时只提交一个事务，失败建议保持待处理', async () => {
    const suggestionsUrl = `/api/indicator-versions/${versionId}/indicators/${level3Id}/ai-suggestions`;
    const workspaceBefore = await request('GET', `/api/indicator-versions/${versionId}/indicators/${level3Id}/workspace`);
    const revisionNo = workspaceBefore.json().modules.find((item: { moduleKey: string }) => item.moduleKey === 'portrait').revisionNo as number;
    const revisionsBefore = await request('GET', `/api/indicator-versions/${versionId}/indicators/${level3Id}/revisions`);
    const portraitRevisionCount = revisionsBefore.json().filter((item: { moduleKey: string }) => item.moduleKey === 'portrait').length;
    const suggestionInput = { targetType: 'module', moduleKey: 'portrait', fieldKey: 'assessment_scope', rationale: '用于验证并发采纳事务边界。', confidence: 'needs_verification' };
    const first = await request('POST', suggestionsUrl, { ...suggestionInput, content: '并发候选建议 A' }, 'ai_service');
    const second = await request('POST', suggestionsUrl, { ...suggestionInput, content: '并发候选建议 B' }, 'ai_service');

    const results = await Promise.all([
      request('POST', `${suggestionsUrl}/${first.json().id}/decision`, { decision: 'accepted', expectedRevisionNo: revisionNo }, 'researcher'),
      request('POST', `${suggestionsUrl}/${second.json().id}/decision`, { decision: 'accepted', expectedRevisionNo: revisionNo }, 'researcher'),
    ]);
    expect(results.map((item) => item.statusCode).sort()).toEqual([201, 409]);

    const workspaceAfter = await request('GET', `/api/indicator-versions/${versionId}/indicators/${level3Id}/workspace`);
    expect(workspaceAfter.json().modules.find((item: { moduleKey: string }) => item.moduleKey === 'portrait').revisionNo).toBe(revisionNo + 1);
    const revisionsAfter = await request('GET', `/api/indicator-versions/${versionId}/indicators/${level3Id}/revisions`);
    expect(revisionsAfter.json().filter((item: { moduleKey: string }) => item.moduleKey === 'portrait')).toHaveLength(portraitRevisionCount + 1);
    const suggestions = await request('GET', suggestionsUrl, undefined, 'researcher');
    const concurrentStatuses = suggestions.json().filter((item: { id: string }) => [first.json().id, second.json().id].includes(item.id)).map((item: { status: string }) => item.status).sort();
    expect(concurrentStatuses).toEqual(['accepted', 'pending']);
  });

  it('知识记录保存、摘要引用和复制版本保持可追溯', async () => {
    const workspaceUrl = `/api/indicator-versions/${versionId}/indicators/${level3Id}/workspace`;
    const initial = await request('GET', workspaceUrl);
    expect(initial.statusCode).toBe(200);
    const expectedRevisions = new Map(initial.json().modules.map((module: { moduleKey: string; revisionNo: number }) => [module.moduleKey, module.revisionNo]));
    for (const definition of MODULE_DEFINITIONS) {
      const values = definition.fields.filter((field) => field.requirement !== 'optional').map((field) => ({ fieldKey: field.fieldId, value: field.fieldType === 'number' || field.fieldType === 'decimal' || field.fieldType === 'percentage' ? 1 : field.fieldType === 'enum' ? field.enumValues?.[0] : '集成测试内容' }));
      for (const field of definition.fields.filter((field) => field.requiresEvidence)) {
        const evidence = await request('POST', `/api/indicator-versions/${versionId}/indicators/${level3Id}/modules/${definition.moduleKey}/evidence`, { type: 'policy', title: `${definition.moduleKey}-${field.fieldId}`, verificationStatus: 'verified', fieldKeys: [field.fieldId] }, 'researcher');
        expect(evidence.statusCode).toBe(201);
      }
      const saved = await request('PATCH', `/api/indicator-versions/${versionId}/indicators/${level3Id}/modules/${definition.moduleKey}`, { expectedRevisionNo: expectedRevisions.get(definition.moduleKey), values, notApplicableReasons: {}, confirm: true }, 'researcher');
      expect(saved.statusCode).toBe(200);
      expect(saved.json().status).toBe('in_progress');
    }
    const revisionList = await request('GET', `/api/indicator-versions/${versionId}/indicators/${level3Id}/revisions`);
    const summarySourceId = revisionList.json()[0].id;
    const summary = await request('PATCH', `/api/indicator-versions/${versionId}/indicators/${level3Id}/summary`, { expectedRevisionNo: initial.json().summaryRevisionNo, summary: '集成测试研究结论摘要', sourceRevisionIds: [summarySourceId] }, 'researcher');
    expect(summary.statusCode).toBe(200);
    expect(summary.json().sourceRevisionIds).toEqual([summarySourceId]);
    expect((await request('POST', `/api/indicator-versions/${versionId}/submit-review`, {})).statusCode).toBe(404);
    expect((await request('POST', `/api/indicator-versions/${versionId}/publish`, {})).statusCode).toBe(404);
    expect((await request('POST', `/api/indicator-versions/${versionId}/indicators/${level3Id}/modules/portrait/review`, { outcome: 'confirmed' })).statusCode).toBe(404);
    const cloned = await request('POST', `/api/indicator-versions/${versionId}/clone`, { year: 2027, versionCode: 'V2' });
    expect(cloned.statusCode).toBe(201);
    expect(cloned.json().status).toBe('draft');
    const clonedTree = await request('GET', `/api/indicator-versions/${cloned.json().id}/tree`);
    const clonedLeafId = clonedTree.json()[0].children[0].children[0].id;
    const clonedWorkspace = await request('GET', `/api/indicator-versions/${cloned.json().id}/indicators/${clonedLeafId}/workspace`);
    expect(clonedWorkspace.json().summary).toBe('集成测试研究结论摘要');
    expect(clonedWorkspace.json().summarySourceRevisionIds).toHaveLength(1);
    expect(clonedWorkspace.json().summarySourceRevisionIds[0]).not.toBe(summarySourceId);
    const clonedPortrait = clonedWorkspace.json().modules.find((item: { moduleKey: string }) => item.moduleKey === 'portrait');
    const sourceAfterClone = await request('GET', workspaceUrl);
    const clonedSave = await request('PATCH', `/api/indicator-versions/${cloned.json().id}/indicators/${clonedLeafId}/modules/portrait`, { expectedRevisionNo: clonedPortrait.revisionNo, values: [{ fieldKey: 'indicator_nature', value: '逆向指标' }] });
    expect(clonedSave.statusCode).toBe(200);
    expect((await request('GET', workspaceUrl)).json().modules.find((item: { moduleKey: string }) => item.moduleKey === 'portrait').revisionNo).toBe(sourceAfterClone.json().modules.find((item: { moduleKey: string }) => item.moduleKey === 'portrait').revisionNo);
    expect((await request('POST', `/api/indicator-versions/${versionId}/nodes`, { level: 1, code: 'IMMUTABLE', name: '源版本可继续维护' })).statusCode).toBe(201);
    const audits = await request('GET', `/api/indicator-versions/${versionId}/audit-logs`);
    expect(audits.json().map((item: { action: string }) => item.action)).toEqual(expect.arrayContaining(['system.created', 'research_module.saved']));
  });

  it('历史已发布版本仍允许维护目录和保存记录', async () => {
    await prisma.indicatorVersion.update({ where: { id: versionId }, data: { status: 'published' } });
    const module = await prisma.researchModule.findFirstOrThrow({ where: { record: { indicatorNodeId: level3Id }, moduleKey: 'portrait' } });
    await prisma.researchModule.update({ where: { id: module.id }, data: { status: 'confirmed' } });
    const saved = await request('PATCH', `/api/indicator-versions/${versionId}/indicators/${level3Id}/modules/portrait`, { expectedRevisionNo: module.revisionNo, values: [{ fieldKey: 'assessment_scope', value: '知识记录更新' }] }, 'researcher');
    expect(saved.statusCode).toBe(200);
    expect(saved.json().status).toBe('in_progress');
    expect(saved.json().revisionNo).toBe(module.revisionNo + 1);
    expect((await request('POST', `/api/indicator-versions/${versionId}/nodes`, { level: 1, code: 'BLOCKED', name: '允许新增' })).statusCode).toBe(201);
  });
  it('体系和层级独立模板：动态字段、依据、停用、历史与并发保护', async () => {
    const a = await createVersionTree('TPL-A'), b = await createVersionTree('TPL-B');
    const settingsUrl = `/api/systems/${a.systemId}/templates`;
    const base = `/api/indicator-versions/${a.versionId}/indicators/${a.level1Id}`;
    let settings = (await request('GET', settingsUrl)).json();
    expect(settings.maxLevel).toBe(3);
    expect(settings.levels.find((l: any) => l.level === 1).affectedCount).toBe(1);
    const modules = structuredClone(settings.levels[0].modules);
    modules[0].name = '一级专用内容';
    modules.push({ moduleKey: 'custom', displayOrder: 4, name: '补充说明', researchQuestion: '', fields: [{ fieldId: 'note', label: '说明', fieldType: 'long_text', requirement: 'optional' }] });
    const saveSettings = (revision: number, items = modules, maxLevel = 3) => request('PUT', settingsUrl, { expectedRevisionNo: revision, maxLevel, levels: [{ level: 1, modules: items }, ...settings.levels.filter((l: any) => l.level > 1 && l.level <= maxLevel).map((l: any) => ({ level: l.level, modules: l.modules }))] });
    const changed = await saveSettings(settings.revisionNo);
    expect(changed.statusCode).toBe(200);
    settings = changed.json();
    expect((await saveSettings(1)).statusCode).toBe(409);
    expect((await request('PUT', settingsUrl, { expectedRevisionNo: 2, maxLevel: 3, levels: [] }, 'reader')).statusCode).toBe(403);
    const bSettings = (await request('GET', `/api/systems/${b.systemId}/templates`)).json();
    expect(bSettings.levels[0].modules[0].name).toBe('一级指标概述');
    expect(settings.levels[1].modules[0].name).toBe('二级指标概述');
    expect(settings.levels[1].revisionNo).toBe(1);
    let workspace = (await request('GET', base + '/workspace')).json();
    expect(workspace.moduleDefinitions.at(-1).moduleKey).toBe('custom');
    expect(workspace.modules.at(-1).values[0].value).toBeNull();
    expect((await request('PATCH', base + '/modules/custom', { expectedRevisionNo: 0, expectedTemplateRevision: 1, values: [] })).statusCode).toBe(409);
    const ev = await request('POST', base + '/modules/custom/evidence', { expectedTemplateRevision: 2, title: '正式依据', type: '文件', excerpt: '依据正文', fieldKeys: ['note'] });
    expect(ev.statusCode).toBe(201);
    const saved = await request('PATCH', base + '/modules/custom', { expectedRevisionNo: 0, expectedTemplateRevision: 2, values: [{ fieldKey: 'note', value: '一级独立正文' }] });
    expect(saved.statusCode).toBe(200);
    modules.at(-1)!.name = '补充内容改名';
    const renamed = await saveSettings(settings.revisionNo);
    expect(renamed.statusCode).toBe(200); settings = renamed.json();
    const reopened = (await request('GET', base + '/workspace')).json();
    expect(reopened.modules.at(-1).values[0].value).toBe('一级独立正文');
    expect(reopened.modules.at(-1).values[0].evidence[0].id).toBe(ev.json().id);
    const sibling = await request('POST', `/api/indicator-versions/${a.versionId}/nodes`, { level: 1, code: 'A-SIBLING', name: '同级指标' });
    const siblingWorkspace = (await request('GET', `/api/indicator-versions/${a.versionId}/indicators/${sibling.json().id}/workspace`)).json();
    expect(siblingWorkspace.moduleDefinitions.at(-1).name).toBe('补充内容改名');
    expect(siblingWorkspace.modules.at(-1).values[0].value).toBeNull();
    const invalid = structuredClone(modules); invalid.at(-1)!.fields[0].fieldType = 'number';
    expect((await saveSettings(settings.revisionNo, invalid)).statusCode).toBe(400);
    modules.at(-1)!.fields[0].label = '改名后的说明';
    modules.at(-1)!.fields[0].active = false;
    const disabled = await saveSettings(settings.revisionNo);
    expect(disabled.statusCode).toBe(200);
    workspace = (await request('GET', base + '/workspace')).json();
    expect(workspace.modules.at(-1).values).toHaveLength(0);
    const history = (await request('GET', base + '/revisions')).json();
    expect(history[0].snapshot.values.note).toBe('一级独立正文');
    expect(history[0].snapshot.template.at(-1).fields[0].label).toBe('说明');
    expect(history[0].snapshot.evidence[0].id).toBe(ev.json().id);
    const secondBase = `/api/indicator-versions/${a.versionId}/indicators/${a.level2Id}`;
    expect((await request('PATCH', secondBase + '/modules/portrait', { expectedRevisionNo: 0, expectedTemplateRevision: 1, values: [{ fieldKey: 'category_definition', value: '二级正文' }] })).statusCode).toBe(200);
    expect((await request('GET', secondBase + '/workspace')).json().modules[0].values[0].value).toBe('二级正文');
  });

  it('字段级保存仅修改目标值和不适用状态，保留其他字段、依据并校验修订', async () => {
    const scope = await createVersionTree('FIELD-SAVE');
    const settingsUrl = `/api/systems/${scope.systemId}/templates`;
    const base = `/api/indicator-versions/${scope.versionId}/indicators/${scope.level1Id}`;
    const settings = (await request('GET', settingsUrl)).json();
    const modules = structuredClone(settings.levels[0].modules);
    modules.push({ moduleKey: 'single_fields', displayOrder: modules.length + 1, name: '逐项填写', researchQuestion: '', fields: ['first', 'second'].map(fieldId => ({ fieldId, label: fieldId, fieldType: 'long_text', requirement: 'optional', allowNotApplicable: true })) });
    const changed = await request('PUT', settingsUrl, { expectedRevisionNo: settings.revisionNo, maxLevel: 3, levels: [{ level: 1, modules }] });
    expect(changed.statusCode).toBe(200);
    const templateRevision = changed.json().levels[0].revisionNo;
    await request('GET', base + '/workspace');
    const evidence = await request('POST', base + '/modules/single_fields/evidence', { expectedTemplateRevision: templateRevision, title: '第二字段依据', type: '文件', fieldKeys: ['second'] });
    expect(evidence.statusCode).toBe(201);
    const moduleUrl = base + '/modules/single_fields';
    const initial = await request('PATCH', moduleUrl, { expectedRevisionNo: 0, expectedTemplateRevision: templateRevision, values: [{ fieldKey: 'first', value: null }, { fieldKey: 'second', value: null }], notApplicableReasons: { first: '第一项暂不适用', second: '第二项暂不适用' } });
    expect(initial.statusCode).toBe(200);
    const single = await request('PATCH', moduleUrl, { expectedRevisionNo: 1, expectedTemplateRevision: templateRevision, values: [{ fieldKey: 'first', value: '只更新第一项' }], notApplicableReasons: {} });
    expect(single.statusCode).toBe(200);
    const value = (response: any, key: string) => response.json().values.find((item: any) => item.fieldKey === key);
    expect(value(single, 'first').value).toBe('只更新第一项');
    expect(value(single, 'first').notApplicableReason).toBeFalsy();
    expect(value(single, 'second').notApplicableReason).toBe('第二项暂不适用');
    expect(value(single, 'second').evidence[0].id).toBe(evidence.json().id);
    const second = await request('PATCH', moduleUrl, { expectedRevisionNo: 2, expectedTemplateRevision: templateRevision, values: [{ fieldKey: 'second', value: '单独填写第二项' }], notApplicableReasons: {} });
    expect(second.statusCode).toBe(200);
    expect(value(second, 'first').value).toBe('只更新第一项');
    expect(value(second, 'second').notApplicableReason).toBeFalsy();
    expect(value(second, 'second').evidence[0].id).toBe(evidence.json().id);
    const stale = await request('PATCH', moduleUrl, { expectedRevisionNo: 1, expectedTemplateRevision: templateRevision, values: [{ fieldKey: 'first', value: '过期输入不能覆盖' }] });
    expect(stale.statusCode).toBe(409);
    const wrongTemplate = await request('PATCH', moduleUrl, { expectedRevisionNo: 3, expectedTemplateRevision: templateRevision - 1, values: [{ fieldKey: 'first', value: '旧模板输入不能覆盖' }] });
    expect(wrongTemplate.statusCode).toBe(409);
    const reopened = (await request('GET', base + '/workspace')).json().modules.find((module: any) => module.moduleKey === 'single_fields');
    expect(reopened.values.find((item: any) => item.fieldKey === 'first').value).toBe('只更新第一项');
    expect(reopened.values.find((item: any) => item.fieldKey === 'second').value).toBe('单独填写第二项');
    const history = (await request('GET', base + '/revisions')).json().filter((item: any) => item.moduleKey === 'single_fields');
    expect(history).toHaveLength(3);
    expect(history.find((item: any) => item.revision === 1).snapshot.naReasons).toEqual({ first: '第一项暂不适用', second: '第二项暂不适用' });
  });

  it('有内容的字段和模块可软删除及恢复，当前模板与语义源隐藏，旧值依据和修订完整保留', async () => {
    const scope = await createVersionTree('TPL-DELETE');
    const settingsUrl = `/api/systems/${scope.systemId}/templates`;
    const base = `/api/indicator-versions/${scope.versionId}/indicators/${scope.level1Id}`;
    let settings = (await request('GET', settingsUrl)).json();
    let modules = structuredClone(settings.levels[0].modules);
    const saveSettings = async () => {
      const response = await request('PUT', settingsUrl, { expectedRevisionNo: settings.revisionNo, maxLevel: 3, levels: [{ level: 1, modules }] });
      expect(response.statusCode).toBe(200);
      settings = response.json();
      modules = structuredClone(settings.levels[0].modules);
    };
    const evidence = await request('POST', base + '/modules/portrait/evidence', { expectedTemplateRevision: 1, title: '需保留的依据', type: '文件', excerpt: '保留的依据原文', fieldKeys: ['level_definition'] });
    expect(evidence.statusCode).toBe(201);
    const saved = await request('PATCH', base + '/modules/portrait', { expectedRevisionNo: 0, expectedTemplateRevision: 1, values: [{ fieldKey: 'level_definition', value: '删除后仍需保留的内容' }] });
    expect(saved.statusCode).toBe(200);
    const originalHistory = (await request('GET', base + '/revisions')).json();
    const semantic = app.get(SemanticService);
    expect((await semantic.source(scope.versionId)).chunks.some(chunk => chunk.metadata.fieldId === 'level_definition')).toBe(true);

    modules[0].fields[0].deleted = true;
    modules[0].fields[0].active = true;
    await saveSettings();
    expect(modules[0].fields[0]).toMatchObject({ deleted: true, active: false });
    let workspace = (await request('GET', base + '/workspace')).json();
    expect(workspace.moduleDefinitions[0].fields.some((field: any) => field.fieldId === 'level_definition')).toBe(false);
    expect(workspace.modules[0].values.some((field: any) => field.fieldKey === 'level_definition')).toBe(false);
    expect(workspace.indicator.progress).toBe(0);
    expect((await semantic.source(scope.versionId)).chunks.some(chunk => chunk.metadata.fieldId === 'level_definition')).toBe(false);
    expect((await request('PATCH', base + '/modules/portrait', { expectedRevisionNo: 1, expectedTemplateRevision: 2, values: [{ fieldKey: 'level_definition', value: '不得覆盖' }] })).statusCode).toBe(400);
    expect((await request('PATCH', base + '/modules/portrait', { expectedRevisionNo: 1, expectedTemplateRevision: 2, values: [{ fieldKey: 'scope_boundary', value: '剩余字段仍可保存' }] })).statusCode).toBe(200);
    expect((await prisma.researchModule.findUniqueOrThrow({ where: { id: saved.json().id } })).values).toMatchObject({ level_definition: '删除后仍需保留的内容', scope_boundary: '剩余字段仍可保存' });
    expect(await prisma.evidence.findUnique({ where: { id: evidence.json().id } })).not.toBeNull();
    expect((await request('GET', base + '/revisions')).json().find((revision: any) => revision.id === originalHistory[0].id)).toEqual(originalHistory[0]);

    modules[0].fields[0].deleted = false;
    modules[0].fields[0].active = true;
    await saveSettings();
    workspace = (await request('GET', base + '/workspace')).json();
    expect(workspace.modules[0].values.find((field: any) => field.fieldKey === 'level_definition')).toMatchObject({ value: '删除后仍需保留的内容', evidence: [{ id: evidence.json().id }] });

    modules[0].deleted = true;
    modules[0].active = true;
    await saveSettings();
    expect(modules[0]).toMatchObject({ deleted: true, active: false });
    workspace = (await request('GET', base + '/workspace')).json();
    expect(workspace.moduleDefinitions.some((module: any) => module.moduleKey === 'portrait')).toBe(false);
    expect(workspace.modules.some((module: any) => module.moduleKey === 'portrait')).toBe(false);
    expect((await semantic.source(scope.versionId)).chunks.some(chunk => chunk.metadata.moduleKey === 'portrait')).toBe(false);
    expect((await request('PATCH', base + '/modules/portrait', { expectedRevisionNo: 2, expectedTemplateRevision: 4, values: [] })).statusCode).toBe(400);
    expect((await prisma.researchModule.findUniqueOrThrow({ where: { id: saved.json().id } })).values).toMatchObject({ level_definition: '删除后仍需保留的内容' });
    expect((await request('GET', base + '/revisions')).json().find((revision: any) => revision.id === originalHistory[0].id)).toEqual(originalHistory[0]);

    modules[0].deleted = false;
    modules[0].active = true;
    await saveSettings();
    workspace = (await request('GET', base + '/workspace')).json();
    expect(workspace.modules[0].values.find((field: any) => field.fieldKey === 'level_definition')).toMatchObject({ value: '删除后仍需保留的内容', evidence: [{ id: evidence.json().id }] });
    expect((await semantic.source(scope.versionId)).chunks.some(chunk => chunk.metadata.fieldId === 'level_definition')).toBe(true);
  });

  it('模板删除不允许物理遗漏已有标识、伪造删除状态或删除全部启用模块', async () => {
    const scope = await createVersionTree('TPL-DELETE-RULES');
    const url = `/api/systems/${scope.systemId}/templates`;
    const settings = (await request('GET', url)).json();
    const original = settings.levels[0].modules;
    const save = (modules: unknown, role = 'system_admin') => request('PUT', url, { expectedRevisionNo: settings.revisionNo, maxLevel: 3, levels: [{ level: 1, modules }] }, role);
    const removedField = structuredClone(original); removedField[0].fields.splice(0, 1);
    expect((await save(removedField)).statusCode).toBe(400);
    expect((await save(original.slice(1))).statusCode).toBe(400);
    expect((await save(original.map((module: any) => ({ ...module, deleted: true, active: true })))).statusCode).toBe(400);
    expect((await save(original.map((module: any) => ({ ...module, active: false })))).statusCode).toBe(400);
    for (const value of ['true', 1, null, {}]) {
      const invalidModule = structuredClone(original); invalidModule[0].deleted = value;
      expect((await save(invalidModule)).statusCode).toBe(400);
      const invalidField = structuredClone(original); invalidField[0].fields[0].deleted = value;
      expect((await save(invalidField)).statusCode).toBe(400);
    }
    const deleted = structuredClone(original); deleted[0].deleted = true;
    expect((await save(deleted, 'reader')).statusCode).toBe(403);
    expect((await request('GET', url)).json()).toEqual(settings);

    const filterInput = structuredClone(original);
    filterInput[0].deleted = true; filterInput[0].active = true;
    filterInput[1].fields[0].deleted = true; filterInput[1].fields[0].active = true;
    for (const filter of [activeModules, activeDefinitions]) {
      const filtered = filter(filterInput);
      expect(filtered.some(module => module.moduleKey === filterInput[0].moduleKey)).toBe(false);
      expect(filtered[0]!.fields.some(field => field.fieldId === filterInput[1].fields[0].fieldId)).toBe(false);
    }
  });

  it('层级 1 至 6 约束覆盖目录、导入和所有业务版本', async () => {
    const a = await createVersionTree('TPL-DEPTH');
    const url = `/api/systems/${a.systemId}/templates`;
    let config = (await request('GET', url)).json();
    expect((await request('PUT', url, { expectedRevisionNo: config.revisionNo, maxLevel: 2, levels: [] })).statusCode).toBe(409);
    const increased = await request('PUT', url, { expectedRevisionNo: config.revisionNo, maxLevel: 6, levels: [] });
    expect(increased.statusCode).toBe(200);
    let parentId = a.level3Id;
    for (let level = 4; level <= 6; level++) {
      const created = await request('POST', `/api/indicator-versions/${a.versionId}/nodes`, { parentId, level, code: 'DEPTH-' + level, name: '层级' + level });
      expect(created.statusCode).toBe(201); parentId = created.json().id;
      const workspace = await request('GET', `/api/indicator-versions/${a.versionId}/indicators/${parentId}/workspace`);
      expect(workspace.statusCode).toBe(200); expect(workspace.json().modules).toHaveLength(8);
    }
    expect((await request('POST', `/api/indicator-versions/${a.versionId}/nodes`, { parentId, level: 7, code: 'L7', name: '无效' })).statusCode).toBe(400);
    const cloned = await request('POST', `/api/indicator-versions/${a.versionId}/clone`, { year: 2027, versionCode: 'V2' });
    expect(cloned.statusCode).toBe(201);
    config = (await request('GET', url)).json();
    expect((await request('PUT', url, { expectedRevisionNo: config.revisionNo, maxLevel: 3, levels: [] })).statusCode).toBe(409);
    const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet('目录');
    sheet.addRow(['level', 'code', 'name', 'parentCode']); sheet.addRow([7, 'L7', '越界', 'DEPTH-6']);
    const actor = await prisma.user.findUniqueOrThrow({ where: { username: 'system_admin' } });
    const preview: any = await catalog.previewImport(a.versionId, Buffer.from(await workbook.xlsx.writeBuffer()), { userId: actor.id, name: actor.displayName, role: 'system_admin' });
    expect(preview.valid).toBe(false);
  });

  it('创建者拥有体系管理权，三档角色隔离且不能限制系统管理员', async () => {
    const created = await request('POST', '/api/systems', { name: '角色测试', code: 'SYSTEM-ROLES', region: '测试区', year: 2026, versionCode: 'V1' }, 'catalog_manager');
    expect(created.statusCode).toBe(201);
    expect(created.json().access).toMatchObject({ systemRole: 'creator', canManageAccess: true, canManageCatalog: true, canResearch: true });
    const id = created.json().id, version = created.json().version.id;
    const creator = await prisma.user.findUniqueOrThrow({ where: { username: 'catalog_manager' } });
    const editor = await prisma.user.findUniqueOrThrow({ where: { username: 'reader' } });
    const admin = await prisma.user.findUniqueOrThrow({ where: { username: 'system_admin' } });
    const base = `/api/systems/${id}/access`;
    expect((await request('GET', base, undefined, 'catalog_manager')).statusCode).toBe(200);
    expect((await request('PUT', base + '/' + editor.id, { systemRole: 'editor' }, 'catalog_manager')).statusCode).toBe(200);
    const node = await request('POST', `/api/indicator-versions/${version}/nodes`, { level: 1, name: '一级', code: 'R1' }, 'catalog_manager');
    expect(node.statusCode).toBe(201);
    const content = `/api/indicator-versions/${version}/indicators/${node.json().id}/modules/portrait`;
    expect((await request('PATCH', content, { expectedRevisionNo: 0, values: [{ fieldKey: 'level_definition', value: '创建者正文' }] }, 'catalog_manager')).statusCode).toBe(200);
    expect((await request('PATCH', content, { expectedRevisionNo: 1, values: [{ fieldKey: 'level_definition', value: '编辑者正文' }] }, 'reader')).statusCode).toBe(200);
    expect((await request('POST', `/api/indicator-versions/${version}/nodes`, { level: 1, name: '越权', code: 'BAD' }, 'reader')).statusCode).toBe(403);
    expect((await request('PUT', base + '/' + editor.id, { systemRole: 'manager' }, 'reader')).statusCode).toBe(403);
    expect((await request('PUT', base + '/' + editor.id, { systemRole: 'manager' }, 'catalog_manager')).statusCode).toBe(200);
    expect((await request('POST', `/api/indicator-versions/${version}/nodes`, { level: 1, name: '管理者新增', code: 'R2' }, 'reader')).statusCode).toBe(201);
    expect((await request('GET', base, undefined, 'reader')).statusCode).toBe(403);
    expect((await request('PUT', base + '/' + editor.id, { systemRole: 'viewer' }, 'catalog_manager')).statusCode).toBe(200);
    expect((await request('PATCH', content, { expectedRevisionNo: 2, values: [] }, 'reader')).statusCode).toBe(403);
    expect((await request('PUT', base + '/' + admin.id, { systemRole: 'viewer' }, 'catalog_manager')).statusCode).toBe(409);
    expect((await request('DELETE', base + '/' + admin.id, {}, 'catalog_manager')).statusCode).toBe(409);
    expect((await request('PUT', base + '/' + creator.id, { systemRole: 'viewer' }, 'catalog_manager')).statusCode).toBe(409);
    expect((await request('DELETE', base + '/' + creator.id, {}, 'catalog_manager')).statusCode).toBe(409);
    expect((await request('PUT', base + '/' + editor.id, { systemRole: 'creator' }, 'catalog_manager')).statusCode).toBe(400);
    const global = (await request('GET', `/api/indicator-versions/${version}`)).json().access;
    expect(global).toMatchObject({ canManageAccess: true, canManageCatalog: true, canResearch: true, canView: true });
    const unrelated = await createVersionTree('UNRELATED-OWNER');
    expect((await request('GET', `/api/systems/${unrelated.systemId}/access`, undefined, 'catalog_manager')).statusCode).toBe(403);
  });

});
