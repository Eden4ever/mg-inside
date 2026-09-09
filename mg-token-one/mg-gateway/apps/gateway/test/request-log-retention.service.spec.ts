import test from 'node:test'
import assert from 'node:assert/strict'
import { RequestLogRetentionService } from '../src/modules/request-log-retention/request-log-retention.service'

function createHarness(options: {
  affectedRows?: number[]
  lockAvailable?: boolean
  schedulerEnabled?: boolean
  retentionMonths?: number
  batchSize?: number
  maxBatchesPerRun?: number
  queryError?: Error
  releaseError?: Error
} = {}) {
  const calls: Array<{ sql: string; params: unknown[] }> = []
  let releases = 0
  const affectedRows = [...(options.affectedRows || [])]
  const service = new RequestLogRetentionService(
    {
      tryAcquire: async () => options.lockAvailable === false ? null : {
        query: async (sql: string, params: unknown[]) => {
        calls.push({ sql, params })
        if (options.queryError) throw options.queryError
        return { affectedRows: affectedRows.shift() || 0 }
      },
        release: async () => {
          releases += 1
          if (options.releaseError) throw options.releaseError
        },
      },
    } as any,
    {
      requestLogRetention: {
        schedulerEnabled: options.schedulerEnabled ?? true,
        retentionMonths: options.retentionMonths ?? 3,
        batchSize: options.batchSize ?? 2,
        maxBatchesPerRun: options.maxBatchesPerRun ?? 2,
      },
    } as any,
  )
  return { service, calls, releases: () => releases }
}

test('调用记录保留从北京时间回退 3 个日历月，并钳位月末、闰年和跨年', () => {
  const { service } = createHarness()
  // 2026-08-31 03:17 CST => 2026-08-30 19:17Z; target is May 31 03:17 CST.
  assert.equal(service.cutoffUtc(new Date('2026-08-30T19:17:00.789Z')).toISOString(), '2026-05-30T19:17:00.789Z')
  assert.equal(service.cutoffUtc(new Date('2024-05-31T04:34:56.789Z')).toISOString(), '2024-02-29T04:34:56.789Z')
  assert.equal(service.cutoffUtc(new Date('2024-05-30T16:00:00.789Z')).toISOString(), '2024-02-28T16:00:00.789Z')
  assert.equal(service.cutoffUtc(new Date('2026-01-30T00:00:00.000Z')).toISOString(), '2025-10-30T00:00:00.000Z')
})

test('清理只删除严格早于截止时间的记录，并按配置限制批次总量', async () => {
  const { service, calls, releases } = createHarness({ affectedRows: [2, 2, 2] })
  const now = new Date('2026-08-20T12:34:56.000Z')
  const result = await service.cleanup(now)

  assert.deepEqual(result, {
    skipped: false,
    cutoffUtc: new Date('2026-05-20T12:34:56.000Z'),
    deleted: 4,
    batches: 2,
  })
  assert.equal(calls.length, 2)
  assert.match(calls[0].sql, /^DELETE FROM request_logs WHERE createdAt < \? ORDER BY createdAt ASC, id ASC LIMIT \?$/)
  assert.deepEqual(calls[0].params, [result.cutoffUtc, 2])
  assert.deepEqual(calls[1].params, [result.cutoffUtc, 2])
  assert.equal(releases(), 1)
})

test('其他实例已持有分布式锁时不执行删除', async () => {
  const { service, calls, releases } = createHarness({ lockAvailable: false })
  const result = await service.cleanup(new Date('2026-08-20T00:00:00.000Z'))
  assert.equal(result.skipped, true)
  assert.equal(calls.length, 0)
  assert.equal(releases(), 0)
})

test('定时清理失败只记录错误，不使调度器抛出异常', async () => {
  const { service } = createHarness({ queryError: new Error('database unavailable') })
  const errors: string[] = []
  ;(service as any).logger.error = (message: string) => errors.push(message)

  await assert.doesNotReject(() => service.scheduledCleanup())
  assert.equal(errors.length, 1)
  assert.equal(errors[0], '调用记录保留清理失败')
})

test('关闭开关时不会执行低峰定时清理', async () => {
  const disabled = createHarness({ schedulerEnabled: false })
  await disabled.service.scheduledCleanup()
  assert.equal(disabled.calls.length, 0)

  const enabled = createHarness({ affectedRows: [0] })
  await enabled.service.scheduledCleanup()
  assert.equal(enabled.calls.length, 1)
})

test('锁释放失败不会覆盖已经完成的清理结果', async () => {
  const { service } = createHarness({ affectedRows: [1], releaseError: new Error('release unavailable') })
  const warnings: string[] = []
  ;(service as any).logger.warn = (message: string) => warnings.push(message)

  const result = await service.cleanup(new Date('2026-08-20T00:00:00.000Z'))
  assert.deepEqual([result.deleted, result.batches], [1, 1])
  assert.deepEqual(warnings, ['调用记录保留锁释放失败'])
})
