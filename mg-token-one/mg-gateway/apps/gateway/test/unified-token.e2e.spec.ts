import 'reflect-metadata'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import mysql from 'mysql2/promise'
import { DataSource } from 'typeorm'
import { User } from '../src/entities/user.entity'
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard'
import { JwtUtil } from '../src/common/utils/jwt.util'

test('统一令牌：真实业务 Guard、历史额度与角色、撤销', { skip: !process.env.UNIFIED_P0_FIXTURE }, async () => {
  const fixture = JSON.parse(readFileSync(process.env.UNIFIED_P0_FIXTURE!, 'utf8'))
  const client = fixture.clients.find((c: any) => c.client_id === 'token-one')
  Object.assign(process.env, { IDENTITY_ENABLED: 'true', IDENTITY_TOKEN_MODE: 'unified', IDENTITY_ISSUER: fixture.issuer,
    IDENTITY_CLIENT_ID: client.client_id, IDENTITY_CLIENT_SECRET: client.client_secret })
  const req: any = { headers: { authorization: `Bearer ${fixture.token}` } }
  const context: any = { switchToHttp: () => ({ getRequest: () => req }) }
  if (process.env.UNIFIED_P0_STAGE === 'revoked') {
    const guard = new JwtAuthGuard({} as any, {} as any)
    await assert.rejects(guard.canActivate(context), /统一登录/)
    return
  }
  const connection = { host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 13306),
    user: process.env.DB_USERNAME || 'root', password: process.env.DB_PASSWORD || '' }
  assert.ok(['127.0.0.1', 'localhost'].includes(connection.host), '只允许本地 MySQL 测试')
  const database = `mg_desktop_p0_${process.pid}_${Date.now()}`
  assert.match(database, /^mg_desktop_p0_\d+_\d+$/)
  const root = await mysql.createConnection(connection)
  let db: DataSource | undefined
  try {
    await root.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
    db = await new DataSource({ type: 'mysql', host: connection.host, port: connection.port, username: connection.user,
      password: connection.password, database, entities: [User], synchronize: true }).initialize()
    const repo = db.getRepository(User)
    const guard = new JwtAuthGuard(repo, { jwt: { secret: 'only-for-rejected-local-token-test' } } as any)
    assert.equal(await guard.canActivate(context), true)
    assert.equal(req.user.identitySubject, fixture.subject); assert.equal(req.user.identitySession, fixture.sid)
    const id = req.user.sub
    await repo.update(id, { role: 'admin', quotaUsed: 42, fixedMonthlyQuota: 900, groupNames: ['retained'] })
    assert.equal(await guard.canActivate(context), true)
    const user = await repo.findOneByOrFail({ id })
    assert.equal(req.user.role, 'admin'); assert.equal(Number(user.quotaUsed), 42)
    assert.equal(Number(user.fixedMonthlyQuota), 900); assert.deepEqual(user.groupNames, ['retained']); assert.equal(await repo.count(), 1)
    req.headers.authorization = `Bearer ${JwtUtil.sign({ sub: id, username: user.username, role: 'admin' }, 'only-for-rejected-local-token-test', '1h')}`
    await assert.rejects(guard.canActivate(context), /统一登录/)
  } finally {
    if (db?.isInitialized) await db.destroy()
    await root.query(`DROP DATABASE IF EXISTS \`${database}\``); await root.end()
  }
})
