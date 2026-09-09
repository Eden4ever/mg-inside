import 'reflect-metadata'
import assert from 'node:assert/strict'
import test from 'node:test'
import mysql from 'mysql2/promise'
import { DataSource } from 'typeorm'
import { QuotaService } from '../src/modules/relay/quota.service'
import { User } from '../src/entities/user.entity'
import { Group } from '../src/entities/group.entity'
import { UserMonthlyQuota } from '../src/entities/user-monthly-quota.entity'
import { periodFor } from '../src/modules/relay/monthly-quota-policy'

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function waitFor(check: () => boolean, message: string) {
  for (let i = 0; i < 100; i++) {
    if (check()) return
    await delay(10)
  }
  assert.fail(message)
}

test('MySQL 月度额度事务锁定与自然月账本隔离', async () => {
  const database = `mg_gateway_quota_${process.pid}_${Date.now()}`
  assert.match(database, /^mg_gateway_quota_\d+_\d+$/)
  const root = await mysql.createConnection({
    host: '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USERNAME || 'root',
    password: process.env.DB_PASSWORD || '',
  })
  let source: DataSource | undefined
  try {
    await root.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
    source = new DataSource({
      type: 'mysql',
      host: '127.0.0.1',
      port: Number(process.env.DB_PORT || 3306),
      username: process.env.DB_USERNAME || 'root',
      password: process.env.DB_PASSWORD || '',
      database,
      entities: [User, Group, UserMonthlyQuota],
      synchronize: true,
      timezone: '+08:00',
      extra: { connectionLimit: 8 },
    })
    await source.initialize()

    const users = source.getRepository(User)
    const groups = source.getRepository(Group)
    const ledgers = source.getRepository(UserMonthlyQuota)
    const group = await groups.save(groups.create({ name: 'default', status: 1, monthlyQuota: 100, models: [] }))
    for (let id = 1; id <= 6; id++) {
      await users.save(users.create({
        username: `quota-lock-user-${id}`,
        displayName: `额度锁用户 ${id}`,
        role: 'user',
        groupNames: ['default'],
        fixedMonthlyQuota: 0,
      }))
    }
    const ids = await users.find({ order: { id: 'ASC' } })
    const service = new QuotaService(users, {} as any, groups, ledgers, source)
    const period = periodFor(new Date())

    // 同一 users/ledger 锁让两次预扣串行，第二次必须看到第一次的预扣结果。
    const sameUser = ids[0].id
    const reservations = await Promise.all([
      service.preCheck({ userId: sameUser } as any, 60),
      service.preCheck({ userId: sameUser } as any, 60),
    ])
    assert.deepEqual(reservations.sort(), [false, true])
    assert.equal(Number((await ledgers.findOneByOrFail({ userId: sameUser, period })).quotaUsed), 60)

    // 两个共享群组读锁可以并行取得；用户 2 持锁时，用户 3 的预扣无需等待。
    let releaseFirstRead: (() => void) | undefined
    let firstReadEntered = false
    const firstRead = (service as any).withLockedQuota(ids[1].id, async () => {
      firstReadEntered = true
      await new Promise<void>((resolve) => { releaseFirstRead = resolve })
      return true
    })
    await waitFor(() => firstReadEntered, '未取得第一个群组共享读锁')
    const otherUserReservation = await Promise.race([
      service.preCheck({ userId: ids[2].id } as any, 10),
      delay(300).then(() => 'timed-out' as const),
    ])
    assert.equal(otherUserReservation, true)
    releaseFirstRead?.()
    await firstRead

    // 共享读锁仍会阻塞群组额度 UPDATE，提交后才允许新策略生效。
    let releaseGroupRead: (() => void) | undefined
    let groupReadEntered = false
    const groupRead = (service as any).withLockedQuota(ids[1].id, async () => {
      groupReadEntered = true
      await new Promise<void>((resolve) => { releaseGroupRead = resolve })
      return true
    })
    await waitFor(() => groupReadEntered, '未取得用于验证 UPDATE 等待的共享读锁')
    let groupUpdateFinished = false
    const groupUpdate = source.transaction(async (manager) => {
      await manager.query('UPDATE `groups` SET `monthlyQuota` = ? WHERE `id` = ?', [110, group.id])
      groupUpdateFinished = true
    })
    await delay(150)
    assert.equal(groupUpdateFinished, false)
    releaseGroupRead?.()
    await groupRead
    await groupUpdate
    assert.equal(Number((await groups.findOneByOrFail({ id: group.id })).monthlyQuota), 110)

    // 后台调整遵守 users -> ledger；它等待正在读取该用户策略的事务，提交后下一次预扣读取新额度包。
    let releaseUserRead: (() => void) | undefined
    let userReadEntered = false
    const userRead = (service as any).withLockedQuota(ids[3].id, async () => {
      userReadEntered = true
      await new Promise<void>((resolve) => { releaseUserRead = resolve })
      return true
    })
    await waitFor(() => userReadEntered, '未取得用于验证管理员等待的用户锁')
    let adjustmentFinished = false
    const adjustment = source.transaction(async (manager) => {
      await manager.findOneOrFail(User, { where: { id: ids[3].id }, lock: { mode: 'pessimistic_write' } })
      await manager.query(
        'INSERT INTO `user_monthly_quotas` (`userId`, `period`, `quotaUsed`, `temporaryMonthlyQuota`) VALUES (?, ?, 0, 30) ON DUPLICATE KEY UPDATE `temporaryMonthlyQuota` = VALUES(`temporaryMonthlyQuota`)',
        [ids[3].id, period],
      )
      await manager.findOneOrFail(UserMonthlyQuota, {
        where: { userId: ids[3].id, period },
        lock: { mode: 'pessimistic_write' },
      })
      await manager.query('UPDATE `users` SET `fixedMonthlyQuota` = ? WHERE `id` = ?', [20, ids[3].id])
      adjustmentFinished = true
    })
    await delay(150)
    assert.equal(adjustmentFinished, false)
    releaseUserRead?.()
    await userRead
    await adjustment
    assert.equal(await service.preCheck({ userId: ids[3].id } as any, 160), true)

    const refundUser = ids[4].id
    await ledgers.save(ledgers.create({ userId: refundUser, period, quotaUsed: 10, temporaryMonthlyQuota: 0 }))
    await service.settle({ userId: refundUser } as any, 0, 100)
    assert.equal(Number((await ledgers.findOneByOrFail({ userId: refundUser, period })).quotaUsed), 0)

    const monthlyUser = ids[5].id
    await ledgers.save(ledgers.create({ userId: monthlyUser, period: '1999-12', quotaUsed: 0, temporaryMonthlyQuota: 50 }))
    assert.equal(await service.preCheck({ userId: monthlyUser } as any, 120), false)
    assert.equal(Number((await ledgers.findOneByOrFail({ userId: monthlyUser, period })).quotaUsed), 0)
  } finally {
    if (source?.isInitialized) await source.destroy()
    await root.query(`DROP DATABASE IF EXISTS \`${database}\``)
    await root.end()
  }
})
