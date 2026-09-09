import 'reflect-metadata'
import test from 'node:test'
import assert from 'node:assert/strict'
import { Controller, Get, Module, UseGuards } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { getRepositoryToken } from '@nestjs/typeorm'
import { User } from '../src/entities/user.entity'
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard'
import { Roles } from '../src/modules/auth/guards/roles.guard'
import { AuthController } from '../src/modules/auth/auth.controller'
import { AuthService } from '../src/modules/auth/auth.service'
import { applicationAudience } from '../src/modules/auth/application-audience'
import { unifiedIdentity, UnifiedAuthError } from '../src/modules/auth/unified-client'

test('Token 三应用按真实 HTTP 接口独立授权，客户端无法切换业务 audience', async () => {
  const oldEnv = { ...process.env }
  const oldIntrospect = unifiedIdentity.introspect
  Object.assign(process.env, { IDENTITY_ENABLED: 'true', IDENTITY_TOKEN_MODE: 'unified', IDENTITY_ISSUER: 'http://127.0.0.1:14200' })
  const user: any = { id: 1, username: 'audience-test', displayName: '测试用户', identitySubject: 'subject', identityIssuer: process.env.IDENTITY_ISSUER, status: 1, role: 'user', quotaUsed: 42 }
  const repository: any = { findOne: async ({ where }: any) => where.identitySubject || typeof where.id === 'number' ? user : null, save: async () => user }
  repository.manager = { transaction: async (fn: any) => fn({ getRepository: () => repository }) }
  let grants = new Set(['token-one-docs'])
  const calls: string[] = []
  unifiedIdentity.introspect = async (token, audience) => {
    assert.equal(token, 'a'.repeat(43)); calls.push(audience!)
    if (!grants.has(audience!)) throw new UnifiedAuthError(401, '没有应用授权')
    return { sub: 'subject', sid: 'session', localUserId: '1', username: user.username, name: user.displayName, department: null, securityVersion: 1, aud: audience } as any
  }
  @Controller('api')
  class BusinessController {
    @Get('portal/stats') @UseGuards(JwtAuthGuard) portal() { return { business: true } }
    @Get('admin/users') @UseGuards(JwtAuthGuard, Roles('admin')) admin() { return { business: true } }
    @Get('wecom/config') @UseGuards(JwtAuthGuard, Roles('admin')) wecom() { return { business: true } }
  }
  @Module({ controllers: [AuthController, BusinessController], providers: [JwtAuthGuard,
    { provide: getRepositoryToken(User), useValue: repository }, { provide: 'APP_CONFIG', useValue: {} },
    { provide: AuthService, useValue: { me: async () => user } }] })
  class TestModule {}
  const app = await NestFactory.create(TestModule, { logger: false })
  try {
    await app.listen(0, '127.0.0.1')
    const base = await app.getUrl()
    const get = (path: string) => fetch(base + path, { headers: { Authorization: `Bearer ${'a'.repeat(43)}`, 'X-MG-Application': 'token-one-docs' } })
    let response = await get('/api/auth/me/token-one-docs')
    assert.equal(response.status, 200)
    const profile = await response.json() as any
    assert.equal(profile.username, user.username); assert.equal(profile.quotaUsed, undefined)
    assert.equal(calls.at(-1), 'token-one-docs')
    for (const path of ['/api/auth/me', '/api/auth/me/token-one', '/api/auth/me/token-one-console', '/api/portal/stats?app_id=token-one-docs', '/api/admin/users', '/api/wecom/config']) {
      assert.equal((await get(path)).status, 401, path)
    }
    grants = new Set(['token-one'])
    assert.equal((await get('/api/portal/stats')).status, 200)
    assert.equal((await get('/api/auth/me/token-one-docs')).status, 401)
    user.role = 'admin'
    assert.equal((await get('/api/admin/users')).status, 401, '业务管理员也必须有控制台授权')
    grants = new Set(['token-one-console']); user.role = 'user'
    assert.equal((await get('/api/auth/me/token-one-console')).status, 200)
    assert.equal((await get('/api/admin/users')).status, 200, '独立控制台授权赋予管理应用能力')
    assert.equal(user.role, 'user', '门户用户角色保持不变')
    assert.equal((await get('/api/admin/users')).status, 200)
    assert.equal((await get('/api/wecom/config')).status, 200)
    assert.equal((await get('/api/portal/stats')).status, 401)
    grants.clear()
    assert.equal((await get('/api/admin/users')).status, 401, '撤权下一次请求立即拒绝')
    assert.equal(user.quotaUsed, 42)
    assert.equal(applicationAudience('/API/ADMIN/USERS/'), 'token-one-console')
    process.env.IDENTITY_TOKEN_MODE = 'legacy'
    const legacyContext: any = { switchToHttp: () => ({ getRequest: () => ({ user }) }) }
    assert.throws(() => Roles('admin').canActivate(legacyContext), /无权限/)
    user.role = 'admin'
    assert.equal(Roles('admin').canActivate(legacyContext), true, '旧模式继续使用原管理员规则')
  } finally {
    await app.close(); unifiedIdentity.introspect = oldIntrospect
    for (const key of Object.keys(process.env)) if (!(key in oldEnv)) delete process.env[key]
    Object.assign(process.env, oldEnv)
  }
})
