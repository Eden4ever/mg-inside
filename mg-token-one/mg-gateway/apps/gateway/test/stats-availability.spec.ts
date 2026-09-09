import test from 'node:test'
import assert from 'node:assert/strict'
import { StatsAdminController } from '../src/modules/stats/stats.module'

function queryBuilder(rows: any[]) {
  const builder: any = {
    select: () => builder,
    addSelect: () => builder,
    where: () => builder,
    groupBy: () => builder,
    addGroupBy: () => builder,
    orderBy: () => builder,
    getRawMany: async () => rows,
  }
  return builder
}

test('管理端可按 5/15/60 分钟聚合协议、模型、渠道和错误维度', async () => {
  const controller = new StatsAdminController(
    {} as any,
    { createQueryBuilder: () => queryBuilder([
      { protocol: 'responses', model: 'gpt-5.6-terra', channelId: 4, errorCode: null, responseStatus: null, requests: '2', successes: '2', failures: '0' },
      { protocol: 'responses', model: 'gpt-5.6-terra', channelId: null, errorCode: 'no_responses_channel', responseStatus: '503', requests: '3', successes: '0', failures: '3' },
      { protocol: 'responses', model: 'gpt-5.6-terra', channelId: 4, errorCode: 'upstream_error', responseStatus: '503', requests: '2', successes: '0', failures: '2' },
      { protocol: 'responses', model: 'gpt-5.6-terra', channelId: 4, errorCode: 'client_disconnected', responseStatus: null, requests: '1', successes: '0', failures: '1' },
    ]) } as any,
    {} as any,
  )

  const result = await controller.availability('5')
  assert.equal(result.windowMinutes, 5)
  assert.equal(result.groups.length, 4)
  assert.deepEqual(result.summary, {
    requests: 8,
    successes: 2,
    failures: 6,
    excludedClientDisconnected: 1,
    serviceRequests: 7,
    serviceFailures: 5,
    successRate: 25,
    serviceSuccessRate: 28.57,
  })
  assert.equal(result.groups[1].errorCode, 'no_responses_channel')
  assert.equal(result.groups[1].responseStatus, 503)
})

test('监控聚合不修改渠道状态，非法窗口回退到 15 分钟且无请求时成功率为 null', async () => {
  let writeAttempts = 0
  const controller = new StatsAdminController(
    {} as any,
    {
      createQueryBuilder: () => queryBuilder([]),
      update: () => { writeAttempts++ },
    } as any,
    {} as any,
  )
  const result = await controller.availability('7')
  assert.equal(result.windowMinutes, 15)
  assert.equal(result.summary.requests, 0)
  assert.equal(result.summary.serviceSuccessRate, null)
  assert.equal(writeAttempts, 0)
})
