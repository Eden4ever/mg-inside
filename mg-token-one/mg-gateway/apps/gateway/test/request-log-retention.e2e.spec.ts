import test from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import { DataSource } from 'typeorm'
import { RequestLogRetentionLockService } from '../src/modules/request-log-retention/request-log-retention-lock.service'
import { RequestLogRetentionService } from '../src/modules/request-log-retention/request-log-retention.service'

test('MySQL +08:00 连接仅删除北京时间三个月截止点之前的 request_logs，且命名锁跨连接互斥', async () => {
  const database = `mg_gateway_request_log_retention_${process.pid}_${Date.now()}`
  assert.match(database, /^mg_gateway_request_log_retention_\d+_\d+$/)
  const root = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USERNAME || 'root',
    password: process.env.DB_PASSWORD || '',
  })
  const sources: DataSource[] = []
  try {
    await root.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
    for (let index = 0; index < 2; index += 1) {
      const source = new DataSource({
        type: 'mysql',
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT || 3306),
        username: process.env.DB_USERNAME || 'root',
        password: process.env.DB_PASSWORD || '',
        database,
        timezone: '+08:00',
      })
      await source.initialize()
      sources.push(source)
    }
    await sources[0].query('CREATE TABLE request_logs (id INT PRIMARY KEY AUTO_INCREMENT, createdAt DATETIME(6) NOT NULL, INDEX idx_created_at_id (createdAt, id))')
    // 北京时间 2026-08-31 03:17，三个月前为 2026-05-31 03:17。
    const now = new Date('2026-08-30T19:17:00.000Z')
    const cutoff = new Date('2026-05-30T19:17:00.000Z')
    await sources[0].query(
      'INSERT INTO request_logs (createdAt) VALUES (?), (?), (?)',
      [new Date(cutoff.getTime() - 1), cutoff, new Date(cutoff.getTime() + 1)],
    )

    const firstLock = new RequestLogRetentionLockService(sources[0])
    const secondLock = new RequestLogRetentionLockService(sources[1])
    const held = await firstLock.tryAcquire()
    assert.ok(held)
    assert.equal(await secondLock.tryAcquire(), null)
    await held.release()

    const service = new RequestLogRetentionService(
      secondLock,
      {
        requestLogRetention: {
          schedulerEnabled: true,
          retentionMonths: 3,
          batchSize: 10,
          maxBatchesPerRun: 2,
        },
      } as any,
    )
    const result = await service.cleanup(now)
    assert.deepEqual([result.deleted, result.batches, result.cutoffUtc.toISOString()], [1, 1, cutoff.toISOString()])
    const rows: any = await sources[1].query('SELECT id FROM request_logs ORDER BY id')
    assert.deepEqual(rows.map((row: any) => row.id), [2, 3])

    await sources[1].query(
      'INSERT INTO request_logs (createdAt) VALUES (?), (?), (?)',
      [new Date(cutoff.getTime() - 3), new Date(cutoff.getTime() - 2), new Date(cutoff.getTime() - 1)],
    )
    let deleteCalls = 0
    const failingLock = {
      tryAcquire: async () => {
        const handle = await secondLock.tryAcquire()
        assert.ok(handle)
        return {
          ...handle,
          query: async (sql: string, params: unknown[]) => {
            deleteCalls += 1
            if (deleteCalls === 2) throw new Error('forced second batch failure')
            return handle.query(sql, params)
          },
        }
      },
    }
    const partialFailureService = new RequestLogRetentionService(
      failingLock as any,
      {
        requestLogRetention: {
          schedulerEnabled: true,
          retentionMonths: 3,
          batchSize: 2,
          maxBatchesPerRun: 2,
        },
      } as any,
    )
    await assert.rejects(() => partialFailureService.cleanup(now), /forced second batch failure/)
    const afterFailure: any = await sources[1].query('SELECT id FROM request_logs ORDER BY id')
    // The first DELETE was committed before the second batch failed.
    assert.deepEqual(afterFailure.map((row: any) => row.id), [2, 3, 6])
  } finally {
    await Promise.all(sources.map(async (source) => {
      if (source.isInitialized) await source.destroy()
    }))
    await root.query(`DROP DATABASE IF EXISTS \`${database}\``)
    await root.end()
  }
})
