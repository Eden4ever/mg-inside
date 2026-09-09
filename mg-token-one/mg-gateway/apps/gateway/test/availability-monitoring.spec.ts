import test from 'node:test'
import assert from 'node:assert/strict'
import { AvailabilityAlertEvent } from '../src/entities/availability-alert-event.entity'
import { AvailabilityAlertState } from '../src/entities/availability-alert-state.entity'
import { AvailabilityMonitoringService } from '../src/modules/availability-monitoring/availability-monitoring.service'
import { findAvailabilityAlerts } from '../src/modules/availability-monitoring/availability-alert.policy'

const baseMetric = {
  protocol: 'responses',
  model: 'gpt-5.6-terra',
  channelId: null,
  requests: 3,
  successes: 0,
  serviceFailures: 3,
  noResponsesFailures: 0,
  server5xxFailures: 0,
}

interface MemoryMonitoringStore {
  states: Map<string, any>
  events: any[]
  nextStateId: number
}

function memoryMonitoring(
  metrics: () => any[],
  store: MemoryMonitoringStore = { states: new Map(), events: [], nextStateId: 1 },
  schedulerEnabled = true,
) {
  const { states, events } = store
  const manager = {
    query: async (_sql: string, values: any[]) => {
      const [fingerprint, protocol, model, channelId, errorClass] = values
      if (!states.has(fingerprint)) {
        states.set(fingerprint, {
          id: store.nextStateId++, fingerprint, protocol, model, channelId, errorClass,
          active: 0, consecutiveHealthyWindows: 0, lastEvaluationKey: null,
          lastEvaluatedAt: null, lastTriggeredAt: null, lastRecoveredAt: null,
        })
      }
    },
    getRepository: (entity: any) => entity === AvailabilityAlertState
      ? {
          findOne: async ({ where }: any) => states.get(where.fingerprint) || null,
          save: async (state: any) => { states.set(state.fingerprint, state); return state },
        }
      : { insert: async (event: any) => { events.push(event) } },
  }
  const stateRepo = {
    find: async ({ where }: any = {}) => [...states.values()].filter((state) =>
      where?.active === undefined || state.active === where.active,
    ),
    count: async ({ where }: any = {}) => [...states.values()].filter((state) =>
      where?.active === undefined || state.active === where.active,
    ).length,
  }
  const service = new AvailabilityMonitoringService(
    {} as any,
    stateRepo as any,
    {} as any,
    { transaction: async (fn: any) => fn(manager) } as any,
    { availabilityMonitoring: { schedulerEnabled } } as any,
  )
  ;(service as any).loadMetrics = async () => metrics()
  return { service, states, events, store }
}

test('无 Responses 渠道按协议和模型聚合，服务端 5xx 按渠道区分', () => {
  const findings = findAvailabilityAlerts([
    { ...baseMetric, noResponsesFailures: 2 },
    { ...baseMetric, channelId: 8, noResponsesFailures: 1 },
    { ...baseMetric, channelId: 4, requests: 10, successes: 9, server5xxFailures: 3 },
    { ...baseMetric, channelId: 5, requests: 10, successes: 10, server5xxFailures: 3 },
  ])
  assert.deepEqual(findings.map((item) => [item.errorClass, item.channelId, item.matchingFailures]), [
    ['no_responses_channel', null, 3],
    ['service_5xx', 4, 3],
  ])
})

test('空窗口和低于触发阈值的残余失败都不会恢复', async () => {
  let current = [{ ...baseMetric, noResponsesFailures: 3 }]
  const { service, states } = memoryMonitoring(() => current)
  const at = new Date('2026-08-20T00:00:00.000Z')
  assert.equal((await service.evaluate(at)).triggered, 1)

  current = []
  assert.equal((await service.evaluate(new Date(at.getTime() + 60_000))).recovered, 0)
  assert.equal([...states.values()][0].consecutiveHealthyWindows, 0)

  current = [{ ...baseMetric, channelId: 9, requests: 10, successes: 9, serviceFailures: 1, noResponsesFailures: 1 }]
  assert.equal((await service.evaluate(new Date(at.getTime() + 2 * 60_000))).recovered, 0)
  assert.equal([...states.values()][0].consecutiveHealthyWindows, 0)
})

test('无 Responses 渠道须连续两个不同分钟的健康成功流量才恢复', async () => {
  let current = [{ ...baseMetric, noResponsesFailures: 3 }]
  const { service, states, events } = memoryMonitoring(() => current)
  const at = new Date('2026-08-20T00:00:00.000Z')
  assert.equal((await service.evaluate(at)).triggered, 1)

  current = [{ ...baseMetric, channelId: 9, requests: 20, successes: 19, serviceFailures: 1 }]
  const firstHealthy = await service.evaluate(new Date(at.getTime() + 60_000))
  assert.equal(firstHealthy.recovered, 0)
  assert.equal([...states.values()][0].consecutiveHealthyWindows, 1)
  const recovered = await service.evaluate(new Date(at.getTime() + 2 * 60_000))
  assert.deepEqual([recovered.recovered, recovered.active], [1, 0])
  assert.deepEqual(events.map((event) => event.eventType), ['triggered', 'recovered'])
  assert.deepEqual(
    [events[1].requests, events[1].successes, events[1].serviceFailures, events[1].matchingFailures, events[1].serviceSuccessRate],
    [20, 19, 1, 0, 95],
  )
})

test('service_5xx 只能由相同协议、模型和渠道的无 5xx 成功流量恢复', async () => {
  let current = [{ ...baseMetric, channelId: 4, requests: 10, successes: 9, server5xxFailures: 3 }]
  const { service, states } = memoryMonitoring(() => current)
  const at = new Date('2026-08-20T02:00:00.000Z')
  assert.equal((await service.evaluate(at)).triggered, 1)

  current = [{ ...baseMetric, channelId: 5, requests: 20, successes: 20, serviceFailures: 0 }]
  assert.equal((await service.evaluate(new Date(at.getTime() + 60_000))).recovered, 0)
  assert.equal([...states.values()][0].consecutiveHealthyWindows, 0)

  current = [{ ...baseMetric, channelId: 4, requests: 100, successes: 99, serviceFailures: 1, server5xxFailures: 1 }]
  assert.equal((await service.evaluate(new Date(at.getTime() + 2 * 60_000))).recovered, 0)
  assert.equal([...states.values()][0].consecutiveHealthyWindows, 0)

  current = [{ ...baseMetric, channelId: 4, requests: 20, successes: 19, serviceFailures: 1 }]
  assert.equal((await service.evaluate(new Date(at.getTime() + 3 * 60_000))).recovered, 0)
  const recovered = await service.evaluate(new Date(at.getTime() + 4 * 60_000))
  assert.deepEqual([recovered.recovered, recovered.active], [1, 0])
})

test('两个服务实例共享状态时，同一分钟只推进一次', async () => {
  const store: MemoryMonitoringStore = { states: new Map(), events: [], nextStateId: 1 }
  const first = memoryMonitoring(() => [{ ...baseMetric, noResponsesFailures: 3 }], store)
  const second = memoryMonitoring(() => [{ ...baseMetric, noResponsesFailures: 3 }], store)
  const now = new Date('2026-08-20T01:00:00.000Z')
  assert.equal((await first.service.evaluate(now)).triggered, 1)
  assert.equal((await second.service.evaluate(now)).triggered, 0)
  assert.equal(store.events.length, 1)
  assert.equal([...store.states.values()][0].lastEvaluationKey, '2026-08-20T01:00:00Z')
})

test('关闭调度开关不会执行 cron 评估，管理员手动评估仍可用', async () => {
  let metricsCalls = 0
  const { service } = memoryMonitoring(() => {
    metricsCalls += 1
    return [{ ...baseMetric, noResponsesFailures: 3 }]
  }, undefined, false)
  await service.scheduledEvaluate()
  assert.equal(metricsCalls, 0)
  assert.equal((await service.evaluate(new Date('2026-08-20T03:00:00.000Z'))).triggered, 1)
  assert.equal(metricsCalls, 1)
})

test('窗口查询排除晚于评估时刻的请求记录', async () => {
  const calls: Array<{ clause: string; values: any }> = []
  const queryBuilder = {
    select: () => queryBuilder,
    addSelect: () => queryBuilder,
    where: (clause: string, values: any) => { calls.push({ clause, values }); return queryBuilder },
    andWhere: (clause: string, values: any) => { calls.push({ clause, values }); return queryBuilder },
    groupBy: () => queryBuilder,
    addGroupBy: () => queryBuilder,
    getRawMany: async () => [],
  }
  const service = new AvailabilityMonitoringService(
    { createQueryBuilder: () => queryBuilder } as any,
    {} as any,
    {} as any,
    {} as any,
    { availabilityMonitoring: { schedulerEnabled: true } } as any,
  )
  const from = new Date('2026-08-20T04:00:00.000Z')
  const now = new Date('2026-08-20T04:05:00.000Z')
  await (service as any).loadMetrics(from, now)
  assert.deepEqual(calls, [
    { clause: 'l.createdAt >= :from', values: { from } },
    { clause: 'l.createdAt <= :now', values: { now } },
  ])
})
