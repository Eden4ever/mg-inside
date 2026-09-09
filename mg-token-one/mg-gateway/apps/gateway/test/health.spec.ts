import test from 'node:test'
import assert from 'node:assert/strict'
import { HealthController } from '../src/modules/health/health.module'

function controller(
  query: () => Promise<unknown>,
  autoCircuitBreakerEnabled: boolean,
  availabilityMonitoringSchedulerEnabled = true,
  requestLogRetentionSchedulerEnabled = true,
) {
  return new HealthController(
    { query } as any,
    {
      releaseId: '20260819T120000Z',
      releaseSha256: 'a'.repeat(64),
      relay: { autoCircuitBreakerEnabled },
      availabilityMonitoring: { schedulerEnabled: availabilityMonitoringSchedulerEnabled },
      requestLogRetention: { schedulerEnabled: requestLogRetentionSchedulerEnabled },
    } as any,
  )
}

test('就绪检查暴露实际自动熔断策略且不泄露其他配置', async () => {
  const health = controller(async () => [{ ok: 1 }], false)

  assert.deepEqual(health.live(), {
    status: 'ok',
    releaseId: '20260819T120000Z',
    releaseSha256: 'a'.repeat(64),
  })

  assert.deepEqual(await health.ready(), {
    status: 'ready',
    releaseId: '20260819T120000Z',
    releaseSha256: 'a'.repeat(64),
    checks: { database: 'ok' },
    policies: {
      autoCircuitBreakerEnabled: false,
      availabilityMonitoringSchedulerEnabled: true,
      requestLogRetentionSchedulerEnabled: true,
    },
  })
})

test('数据库不可用时仍报告自动熔断策略', async () => {
  const health = controller(async () => { throw new Error('database unavailable') }, false)

  await assert.rejects(
    () => health.ready(),
    (error: any) => {
      assert.equal(error.getStatus(), 503)
      assert.deepEqual(error.getResponse(), {
        status: 'not_ready',
        releaseId: '20260819T120000Z',
        releaseSha256: 'a'.repeat(64),
        checks: { database: 'failed' },
        policies: {
          autoCircuitBreakerEnabled: false,
          availabilityMonitoringSchedulerEnabled: true,
          requestLogRetentionSchedulerEnabled: true,
        },
      })
      return true
    },
  )
})
