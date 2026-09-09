import test from 'node:test'
import assert from 'node:assert/strict'
import { RequestLogRetentionLockService } from '../src/modules/request-log-retention/request-log-retention-lock.service'

function lockHarness(releaseResult: unknown) {
  let runnerReleased = 0
  const runner = {
    connect: async () => undefined,
    query: async (sql: string) => {
      if (sql.includes('GET_LOCK')) return [{ acquired: 1 }]
      if (sql.includes('RELEASE_LOCK')) return releaseResult
      throw new Error(`unexpected query: ${sql}`)
    },
    release: async () => { runnerReleased += 1 },
  }
  return {
    service: new RequestLogRetentionLockService({ createQueryRunner: () => runner } as any),
    runnerReleased: () => runnerReleased,
  }
}

test('RELEASE_LOCK 返回 0 或 null 时视为未释放，且仍归还连接', async () => {
  for (const result of [[{ released: 0 }], [{ released: null }], []]) {
    const { service, runnerReleased } = lockHarness(result)
    const lock = await service.tryAcquire()
    assert.ok(lock)
    await assert.rejects(() => lock.release(), /调用记录保留锁未释放/)
    assert.equal(runnerReleased(), 1)
  }
})

test('RELEASE_LOCK 返回 1 时成功且重复释放幂等', async () => {
  const { service, runnerReleased } = lockHarness([{ released: 1 }])
  const lock = await service.tryAcquire()
  assert.ok(lock)
  await lock.release()
  await lock.release()
  assert.equal(runnerReleased(), 1)
})
