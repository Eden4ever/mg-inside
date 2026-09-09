import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { parseEnv } from 'node:util';
import { resolve } from 'node:path';
import { test, expect } from 'vitest';
import { Reflector } from '@nestjs/core';
import { AuthService, SessionAuthGuard } from '../src/auth';
import { PrismaService } from '../src/prisma.service';
import { SystemAccessService } from '../src/system-access';

test.skipIf(!process.env.UNIFIED_P0_FIXTURE)('统一令牌：真实 PostgreSQL 身份映射、Guard、CSRF、撤销', async () => {
  const fixture = JSON.parse(readFileSync(process.env.UNIFIED_P0_FIXTURE!, 'utf8'));
  const client = fixture.clients.find((c: any) => c.client_id === 'expert-database');
  Object.assign(process.env, { IDENTITY_ENABLED: 'true', IDENTITY_TOKEN_MODE: 'unified', IDENTITY_ISSUER: fixture.issuer,
    IDENTITY_CLIENT_ID: client.client_id, IDENTITY_CLIENT_SECRET: client.client_secret });
  if (process.env.UNIFIED_P0_STAGE === 'revoked') {
    const auth = new AuthService({} as any, {} as any, {} as any);
    await expect(auth.authenticate(undefined, `Bearer ${fixture.token}`)).rejects.toThrow('统一登录'); return;
  }
  const source = process.env.DATABASE_URL || parseEnv(readFileSync(resolve(process.cwd(), '../../.env'), 'utf8')).DATABASE_URL!;
  const url = new URL(source);
  expect(['127.0.0.1', 'localhost']).toContain(url.hostname);
  const schema = `mg_expert_test_desktop_${process.pid}_${Date.now()}`;
  if (!/^mg_expert_test_desktop_\d+_\d+$/.test(schema)) throw new Error('专用测试 Schema 无效');
  url.searchParams.set('schema', schema); process.env.DATABASE_URL = url.href;
  const require = createRequire(resolve(process.cwd(), 'package.json'));
  const cli = require.resolve('prisma/build/index.js');
  const prismaSchema = resolve(process.cwd(), 'prisma/schema.prisma');
  const db = new PrismaService();
  try {
    execFileSync(process.execPath, [cli, 'db', 'push', '--skip-generate', '--schema', prismaSchema], { env: process.env, stdio: 'pipe', windowsHide: true });
    await db.$connect();
    const auth = new AuthService(db, {} as any, {} as any);
    const accepted = await auth.authenticate(undefined, `Bearer ${fixture.token}`);
    expect(accepted.session.id).toBe(fixture.sid);
    const id = accepted.user.userId;
    await db.user.update({ where: { id }, data: { role: 'researcher' } });
    const again = await auth.authenticate(undefined, `Bearer ${fixture.token}`);
    expect(again.user).toMatchObject({ userId: id, role: 'researcher' });
    expect(await db.user.count()).toBe(1); expect(await db.authSession.count()).toBe(0);
    await expect(auth.authenticate('mg_expert_session=legacy')).rejects.toThrow('统一登录');
    const guard = new SessionAuthGuard(new Reflector(), auth);
    const request: any = { method: 'POST', url: '/api/systems', headers: { authorization: `Bearer ${fixture.token}` } };
    const context: any = { getHandler: () => function handler() {}, getClass: () => class Controller {}, switchToHttp: () => ({ getRequest: () => request }) };
    await expect(guard.canActivate(context)).rejects.toThrow('CSRF');
    request.headers['x-csrf-token'] = accepted.session.csrfToken;
    expect(await guard.canActivate(context)).toBe(true); expect(request.user.role).toBe('researcher');
    const system = await db.indicatorSystem.create({ data: { name: '统一桌面权限回归', code: 'DESKTOP-ACL', region: '测试区' } });
    const access = new SystemAccessService(db);
    const actor = { userId: id, name: request.user.name, role: 'researcher' as const };
    await expect(access.requireForSystem(system.id, actor, ['canView'])).rejects.toThrow();
    await db.indicatorSystemAccess.create({ data: { systemId: system.id, userId: id, canView: true, canResearch: true } });
    await auth.authenticate(undefined, `Bearer ${fixture.token}`);
    await expect(access.requireForSystem(system.id, actor, ['canResearch'])).resolves.toBeUndefined();
    await expect(access.requireForSystem(system.id, actor, ['canManageCatalog'])).rejects.toThrow();
    expect(await db.indicatorSystemAccess.count({ where: { userId: id } })).toBe(1);
  } finally {
    await db.$disconnect();
    execFileSync(process.execPath, [cli, 'db', 'execute', '--stdin', '--schema', prismaSchema], {
      env: process.env, input: `DROP SCHEMA IF EXISTS "${schema}" CASCADE;`, stdio: 'pipe', windowsHide: true });
  }
}, 60_000);
