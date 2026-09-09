import test from 'node:test'
import assert from 'node:assert/strict'
import { ChannelPoolService } from '../src/modules/relay/channel-pool.service'
import { CryptoUtil } from '../src/common/utils/crypto.util'

const secret = 'channel-pool-test-secret'
const encryptedKey = CryptoUtil.encrypt('upstream-key', secret)

function channel(id: number, protocols: string[] | null, protocol = 'chat') {
  return {
    id,
    status: 1,
    baseUrl: `https://upstream-${id}.example.com`,
    keysEncrypted: encryptedKey,
    protocol,
    protocols,
  }
}

function routeStore(models: any[]) {
  models.forEach((model, index) => {
    if (!Number.isInteger(model.id)) model.id = index + 1
  })
  return {
    bindingsByModel: async () => new Map(models.map((model) => [
      model.id,
      (model.bindings || []).map((binding: any) => ({
        ...binding,
        weight: binding.weight,
        status: binding.status === 0 ? 0 : 1,
      })),
    ])),
  }
}

test('渠道池按 Chat、Responses 与 Anthropic 入口协议选择绑定', async () => {
  const channels = [
    channel(1, ['chat']),
    channel(2, ['responses'], 'responses'),
    channel(3, ['chat', 'responses']),
    channel(4, ['anthropic'], 'anthropic'),
  ]
  const models = [{
    name: 'gpt-test',
    status: 1,
    bindings: channels.map((item) => ({
      channelId: item.id,
      upstreamModel: `upstream-${item.id}`,
      priority: 0,
    })),
  }]
  const pool = new ChannelPoolService(
    { find: async () => channels } as any,
    { find: async () => models } as any,
    { find: async () => [] } as any,
    { jwt: { secret } } as any,
    routeStore(models) as any,
  )

  await pool.refresh()

  assert.equal(pool.hasModel('gpt-test', 'chat'), true)
  assert.equal(pool.hasModel('gpt-test', 'responses'), true)
  assert.equal(pool.hasModel('gpt-test', 'anthropic'), true)
  assert.equal(pool.pick('gpt-test', 'chat')?.channelId, 1)
  assert.equal(pool.pick('gpt-test', 'responses')?.channelId, 2)
  assert.equal(pool.pick('gpt-test', 'anthropic')?.channelId, 4)
})

test('仅 Chat 的旧渠道不能被 Responses 请求选中', async () => {
  const channels = [channel(1, null, 'chat')]
  const models = [{
    name: 'legacy-chat',
    status: 1,
    bindings: [{ channelId: 1, upstreamModel: 'legacy', priority: 0 }],
  }]
  const pool = new ChannelPoolService(
    { find: async () => channels } as any,
    { find: async () => models } as any,
    { find: async () => [] } as any,
    { jwt: { secret } } as any,
    routeStore(models) as any,
  )

  await pool.refresh()

  assert.equal(pool.hasModel('legacy-chat', 'chat'), true)
  assert.equal(pool.hasModel('legacy-chat', 'responses'), false)
  assert.equal(pool.hasModel('legacy-chat', 'anthropic'), false)
  assert.equal(pool.pick('legacy-chat', 'responses'), null)
  assert.equal(pool.pick('legacy-chat', 'anthropic'), null)
})

test('显式停用单条模型路由不会把渠道加入该模型路由池', async () => {
  const channels = [channel(1, ['responses'], 'responses')]
  const models = [{ id: 17, name: 'route-disabled-test', status: 1, bindings: [] }]
  const pool = new ChannelPoolService(
    { find: async () => channels } as any,
    { find: async () => models } as any,
    { find: async () => [] } as any,
    { jwt: { secret } } as any,
    {
      bindingsByModel: async () => new Map([[17, [{
        channelId: 1,
        upstreamModel: 'disabled-upstream',
        priority: 0,
        weight: 5,
        status: 0,
      }]]]),
    } as any,
  )

  await pool.refresh()

  assert.equal(pool.pick('route-disabled-test', 'responses'), null)
  assert.equal(pool.describe('route-disabled-test').bindings[0].status, 'route_disabled')
  assert.equal(pool.health(1)?.status, 'healthy')
})

test('渠道成功后清零连续失败，非连续错误不会触发熔断', async () => {
  const channels = [{
    ...channel(1, ['chat']),
    consecutiveErrors: 0,
    disabledUntil: null,
  }]
  const models = [{
    name: 'health-test',
    status: 1,
    bindings: [{ channelId: 1, upstreamModel: 'health-upstream', priority: 0 }],
  }]
  const updates: any[] = []
  const pool = new ChannelPoolService(
    {
      find: async () => channels,
      update: async (id: number, value: any) => { updates.push([id, value]) },
    } as any,
    { find: async () => models } as any,
    { find: async () => [] } as any,
    { jwt: { secret }, relay: { channelDisableSeconds: 300 } } as any,
    routeStore(models) as any,
  )

  await pool.refresh()
  await pool.recordFailure(1)
  await pool.recordSuccess(1)
  await pool.recordFailure(1)
  await pool.recordFailure(1)

  assert.equal(pool.pick('health-test', 'chat')?.channelId, 1)
  assert.ok(updates.some(([, value]) => value.consecutiveErrors === 0))
})

test('渠道健康快照跟踪请求时间轴并支持手动恢复', async () => {
  const channels = [{
    ...channel(8, ['responses'], 'responses'),
    consecutiveErrors: 0,
    disabledUntil: null,
    totalRequests: 0,
    failedRequests: 0,
    lastSuccessAt: null,
    lastFailureAt: null,
  }]
  const updates: any[] = []
  const pool = new ChannelPoolService(
    {
      find: async () => channels,
      update: async (id: number, value: any) => { updates.push([id, value]) },
    } as any,
    { find: async () => [] } as any,
    { find: async () => [] } as any,
    { jwt: { secret }, relay: { channelDisableSeconds: 300 } } as any,
    routeStore([]) as any,
  )

  await pool.refresh()
  assert.equal(pool.health(8)?.status, 'healthy')

  await pool.recordFailure(8)
  assert.equal(pool.health(8)?.status, 'degraded')
  assert.equal(pool.health(8)?.consecutiveErrors, 1)
  assert.equal(pool.health(8)?.totalRequests, 1)
  assert.equal(pool.health(8)?.failedRequests, 1)
  assert.ok(pool.health(8)?.lastFailureAt instanceof Date)

  await pool.recordFailure(8)
  await pool.recordFailure(8)
  // 无模型/协议范围的旧调用不能制造一个可自动熔断的路径。
  assert.equal(pool.health(8)?.status, 'degraded')
  assert.equal(pool.health(8)?.canRecover, true)

  const recovered = await pool.recover(8)
  assert.equal(recovered?.status, 'healthy')
  assert.equal(recovered?.consecutiveErrors, 0)
  assert.equal(recovered?.failedRequests, 3)
  assert.ok(updates.some(([, value]) =>
    value.consecutiveErrors === 0 && value.disabledUntil === null,
  ))
})

test('历史渠道级禁用状态不再参与路径选择', async () => {
  const channels = [
    {
      ...channel(1, ['chat']),
      consecutiveErrors: 3,
      disabledUntil: Date.now() + 60_000,
    },
    { ...channel(2, ['chat']), consecutiveErrors: 0, disabledUntil: null },
  ]
  const models = [{
    name: 'disabled-test',
    status: 1,
    bindings: [
      { channelId: 1, upstreamModel: 'disabled-upstream', priority: 10 },
      { channelId: 2, upstreamModel: 'fallback-upstream', priority: 0 },
    ],
  }]
  const pool = new ChannelPoolService(
    {
      find: async () => channels,
      update: async () => {},
    } as any,
    { find: async () => models } as any,
    { find: async () => [] } as any,
    { jwt: { secret }, relay: { channelDisableSeconds: 300 } } as any,
    routeStore(models) as any,
  )

  await pool.refresh()
  assert.equal(pool.pick('disabled-test', 'chat')?.channelId, 1)
  assert.equal(pool.describe('disabled-test').bindings.find((binding) => binding.channelId === 1)?.status, 'available')
  await pool.recordSuccess(1)
  assert.equal(pool.pick('disabled-test', 'chat')?.channelId, 1)
  assert.equal(pool.describe('disabled-test').bindings[0].status, 'available')
})

test('关闭自动熔断后忽略历史禁用状态且连续失败不退出路由', async () => {
  const channels = [{
    ...channel(9, ['responses'], 'responses'),
    consecutiveErrors: 3,
    disabledUntil: Date.now() + 60_000,
    totalRequests: 0,
    failedRequests: 0,
    lastSuccessAt: null,
    lastFailureAt: null,
  }]
  const models = [{
    name: 'no-circuit-test',
    status: 1,
    bindings: [{ channelId: 9, upstreamModel: 'no-circuit-upstream', priority: 0 }],
  }]
  const updates: any[] = []
  const pool = new ChannelPoolService(
    {
      find: async () => channels,
      update: async (id: number, value: any) => { updates.push([id, value]) },
    } as any,
    { find: async () => models } as any,
    { find: async () => [] } as any,
    {
      jwt: { secret },
      relay: {
        autoCircuitBreakerEnabled: false,
        channelDisableSeconds: 300,
      },
    } as any,
    routeStore(models) as any,
  )

  await pool.refresh()
  assert.equal(pool.pick('no-circuit-test', 'responses')?.channelId, 9)
  assert.equal(pool.describe('no-circuit-test').bindings[0].status, 'available')
  assert.equal(pool.health(9)?.status, 'healthy')
  assert.equal(pool.health(9)?.disabledUntil, null)
  assert.ok(updates.some(([id, value]) =>
    Array.isArray(id) && id.includes(9) && value.disabledUntil === null,
  ))

  const updatesBeforeFailures = updates.length
  await pool.recordFailure(9)
  await pool.recordFailure(9)
  await pool.recordFailure(9)

  assert.equal(pool.pick('no-circuit-test', 'responses')?.channelId, 9)
  assert.equal(pool.health(9)?.status, 'degraded')
  // 历史渠道级累计错误只用于展示，不能混入新的路径级错误。
  assert.equal(pool.health(9)?.consecutiveErrors, 3)
  assert.equal(pool.health(9)?.disabledUntil, null)
  const failureUpdates = updates.slice(updatesBeforeFailures)
  assert.equal(failureUpdates.length, 3)
  assert.ok(failureUpdates.every(([, value]) => value.disabledUntil === null))
})

test('自动熔断保留唯一的 Responses 路由，持续返回真实上游错误', async () => {
  const channels = [{
    ...channel(13, ['responses'], 'responses'),
    consecutiveErrors: 0,
    disabledUntil: null,
  }]
  const models = [{
    name: 'only-responses-route',
    status: 1,
    bindings: [{ channelId: 13, upstreamModel: 'only-responses-upstream', priority: 0 }],
  }]
  const updates: any[] = []
  const pool = new ChannelPoolService(
    {
      find: async () => channels,
      update: async (id: number, value: any) => { updates.push([id, value]) },
    } as any,
    { find: async () => models } as any,
    { find: async () => [] } as any,
    { jwt: { secret }, relay: { autoCircuitBreakerEnabled: true, channelDisableSeconds: 300 } } as any,
    routeStore(models) as any,
  )

  await pool.refresh()
  await pool.recordFailure(13)
  await pool.recordFailure(13)
  await pool.recordFailure(13)

  assert.equal(pool.pick('only-responses-route', 'responses')?.channelId, 13)
  assert.equal(pool.health(13)?.status, 'degraded')
  assert.equal(pool.health(13)?.disabledUntil, null)
  assert.equal(pool.describe('only-responses-route').bindings[0].status, 'available')
  assert.ok(updates.some(([id, value]) => id === 13 && value.disabledUntil === null))
})

test('刷新时清除无备用的历史 Responses 熔断并保留唯一路由', async () => {
  const channels = [{
    ...channel(20, ['responses'], 'responses'),
    consecutiveErrors: 3,
    disabledUntil: Date.now() + 60_000,
  }]
  const models = [{
    name: 'persisted-only-responses-route',
    status: 1,
    bindings: [{ channelId: 20, upstreamModel: 'persisted-only-upstream', priority: 0 }],
  }]
  const updates: any[] = []
  const pool = new ChannelPoolService(
    {
      find: async () => channels,
      update: async (id: number, value: any) => { updates.push([id, value]) },
    } as any,
    { find: async () => models } as any,
    { find: async () => [] } as any,
    { jwt: { secret }, relay: { autoCircuitBreakerEnabled: true, channelDisableSeconds: 300 } } as any,
    routeStore(models) as any,
  )

  await pool.refresh()

  assert.equal(pool.pick('persisted-only-responses-route', 'responses')?.channelId, 20)
  assert.equal(pool.health(20)?.status, 'healthy')
  assert.equal(pool.health(20)?.disabledUntil, null)
  assert.ok(updates.some(([id, value]) =>
    (id === 20 || (Array.isArray(id) && id.includes(20))) && value.disabledUntil === null,
  ))
})

test('刷新不会把另一个历史熔断渠道误判为健康备用', async () => {
  const channels = [
    { ...channel(21, ['responses'], 'responses'), consecutiveErrors: 3, disabledUntil: Date.now() + 60_000 },
    { ...channel(22, ['responses'], 'responses'), consecutiveErrors: 3, disabledUntil: Date.now() + 60_000 },
  ]
  const models = [{
    name: 'two-persisted-circuits',
    status: 1,
    bindings: [
      { channelId: 21, upstreamModel: 'first', priority: 10 },
      { channelId: 22, upstreamModel: 'second', priority: 0 },
    ],
  }]
  const updates: any[] = []
  const pool = new ChannelPoolService(
    {
      find: async () => channels,
      update: async (id: number, value: any) => { updates.push([id, value]) },
    } as any,
    { find: async () => models } as any,
    { find: async () => [] } as any,
    { jwt: { secret }, relay: { autoCircuitBreakerEnabled: true, channelDisableSeconds: 300 } } as any,
    routeStore(models) as any,
  )

  await pool.refresh()

  assert.ok(pool.pick('two-persisted-circuits', 'responses'))
  assert.ok(updates.some(([, value]) => value.disabledUntil === null))
  assert.equal(pool.health(21)?.status, 'healthy')
  assert.equal(pool.health(22)?.status, 'healthy')
})

test('自动熔断仅在每个模型协议都有健康备用时移出失败渠道', async () => {
  const channels = [
    { ...channel(14, ['responses'], 'responses'), consecutiveErrors: 0, disabledUntil: null },
    { ...channel(15, ['responses'], 'responses'), consecutiveErrors: 0, disabledUntil: null },
  ]
  const models = [{
    name: 'responses-with-fallback',
    status: 1,
    bindings: [
      { channelId: 14, upstreamModel: 'primary', priority: 10 },
      { channelId: 15, upstreamModel: 'fallback', priority: 0 },
    ],
  }]
  const updates: any[] = []
  const pool = new ChannelPoolService(
    {
      find: async () => channels,
      update: async (id: number, value: any) => { updates.push([id, value]) },
    } as any,
    { find: async () => models } as any,
    { find: async () => [] } as any,
    { jwt: { secret }, relay: { autoCircuitBreakerEnabled: true, channelDisableSeconds: 300 } } as any,
    routeStore(models) as any,
  )

  await pool.refresh()
  // 备用必须在同一模型、同一协议路径上真实成功过；冷备不能支撑熔断。
  await pool.recordSuccess(15, 'responses-with-fallback', 'responses')
  await pool.recordFailure(14, 'responses-with-fallback', 'responses')
  await pool.recordFailure(14, 'responses-with-fallback', 'responses')
  await pool.recordFailure(14, 'responses-with-fallback', 'responses')

  assert.equal(pool.health(14)?.status, 'circuit_open')
  assert.ok(pool.health(14)?.disabledUntil)
  assert.equal(pool.pick('responses-with-fallback', 'responses')?.channelId, 15)
  assert.ok(updates.some(([id, value]) => id === 14 && typeof value.disabledUntil === 'number'))
})

test('已有连续失败的候选渠道不能支撑自动熔断当前路由', async () => {
  const channels = [
    { ...channel(25, ['responses'], 'responses'), consecutiveErrors: 0, disabledUntil: null },
    { ...channel(26, ['responses'], 'responses'), consecutiveErrors: 1, disabledUntil: null },
  ]
  const models = [{
    name: 'degraded-fallback-is-not-healthy',
    status: 1,
    bindings: [
      { channelId: 25, upstreamModel: 'primary', priority: 10 },
      { channelId: 26, upstreamModel: 'degraded-fallback', priority: 0 },
    ],
  }]
  const updates: any[] = []
  const pool = new ChannelPoolService(
    {
      find: async () => channels,
      update: async (id: number, value: any) => { updates.push([id, value]) },
    } as any,
    { find: async () => models } as any,
    { find: async () => [] } as any,
    { jwt: { secret }, relay: { autoCircuitBreakerEnabled: true, channelDisableSeconds: 300 } } as any,
    routeStore(models) as any,
  )

  await pool.refresh()
  await pool.recordFailure(25)
  await pool.recordFailure(25)
  await pool.recordFailure(25)

  assert.equal(pool.health(25)?.status, 'degraded')
  assert.equal(pool.health(25)?.disabledUntil, null)
  assert.equal(pool.pick('degraded-fallback-is-not-healthy', 'responses')?.channelId, 25)
  assert.ok(updates.some(([id, value]) => id === 25 && value.disabledUntil === null))
  assert.ok(!updates.some(([id, value]) => id === 25 && typeof value.disabledUntil === 'number'))
})

test('刷新不会用已有连续失败的候选维持历史熔断', async () => {
  const channels = [
    { ...channel(27, ['responses'], 'responses'), consecutiveErrors: 3, disabledUntil: Date.now() + 60_000 },
    { ...channel(28, ['responses'], 'responses'), consecutiveErrors: 1, disabledUntil: null },
  ]
  const models = [{
    name: 'persisted-circuit-with-degraded-fallback',
    status: 1,
    bindings: [
      { channelId: 27, upstreamModel: 'persisted-primary', priority: 10 },
      { channelId: 28, upstreamModel: 'degraded-fallback', priority: 0 },
    ],
  }]
  const updates: any[] = []
  const pool = new ChannelPoolService(
    {
      find: async () => channels,
      update: async (id: number, value: any) => { updates.push([id, value]) },
    } as any,
    { find: async () => models } as any,
    { find: async () => [] } as any,
    { jwt: { secret }, relay: { autoCircuitBreakerEnabled: true, channelDisableSeconds: 300 } } as any,
    routeStore(models) as any,
  )

  await pool.refresh()

  assert.equal(pool.health(27)?.status, 'healthy')
  assert.equal(pool.health(27)?.disabledUntil, null)
  assert.equal(pool.pick('persisted-circuit-with-degraded-fallback', 'responses')?.channelId, 27)
  assert.ok(updates.some(([id, value]) =>
    (id === 27 || (Array.isArray(id) && id.includes(27))) && value.disabledUntil === null,
  ))
})

test('临时熔断、手动或账户停用和不可读凭据都不能支撑自动熔断', async () => {
  const channels = [
    { ...channel(29, ['responses'], 'responses'), consecutiveErrors: 0, disabledUntil: null },
    { ...channel(30, ['responses'], 'responses'), consecutiveErrors: 0, disabledUntil: Date.now() + 60_000 },
    { ...channel(31, ['responses'], 'responses'), status: 0 },
    { ...channel(32, ['responses'], 'responses'), supplierAccountId: 101 },
    { ...channel(33, ['responses'], 'responses'), keysEncrypted: 'not-a-readable-key' },
  ]
  const models = [{
    name: 'unhealthy-static-fallbacks',
    status: 1,
    bindings: [
      { channelId: 29, upstreamModel: 'primary', priority: 10 },
      { channelId: 30, upstreamModel: 'temporarily-disabled', priority: 9 },
      { channelId: 31, upstreamModel: 'manually-disabled', priority: 8 },
      { channelId: 32, upstreamModel: 'account-disabled', priority: 7 },
      { channelId: 33, upstreamModel: 'unreadable-credential', priority: 6 },
    ],
  }]
  const updates: any[] = []
  const pool = new ChannelPoolService(
    {
      find: async () => channels,
      update: async (id: number, value: any) => { updates.push([id, value]) },
    } as any,
    { find: async () => models } as any,
    { find: async () => [{ id: 101, name: 'Disabled account', routingEnabled: 0 }] } as any,
    { jwt: { secret }, relay: { autoCircuitBreakerEnabled: true, channelDisableSeconds: 300 } } as any,
    routeStore(models) as any,
  )

  await pool.refresh()
  await pool.recordFailure(29)
  await pool.recordFailure(29)
  await pool.recordFailure(29)

  const routing = pool.describe('unhealthy-static-fallbacks')
  assert.equal(pool.health(29)?.status, 'degraded')
  assert.equal(pool.health(29)?.disabledUntil, null)
  assert.equal(pool.pick('unhealthy-static-fallbacks', 'responses')?.channelId, 29)
  assert.equal(routing.bindings.find((binding) => binding.channelId === 30)?.status, 'available')
  assert.equal(routing.bindings.find((binding) => binding.channelId === 31)?.status, 'channel_disabled')
  assert.equal(routing.bindings.find((binding) => binding.channelId === 32)?.status, 'account_disabled')
  assert.equal(routing.bindings.find((binding) => binding.channelId === 33)?.status, 'credential_unreadable')
  assert.ok(updates.some(([id, value]) => id === 29 && value.disabledUntil === null))
  assert.ok(!updates.some(([id, value]) => id === 29 && typeof value.disabledUntil === 'number'))
})

test('共享多协议渠道缺少任一协议备用时不会被自动熔断', async () => {
  const channels = [
    { ...channel(16, ['chat', 'responses']), consecutiveErrors: 0, disabledUntil: null },
    { ...channel(17, ['responses'], 'responses'), consecutiveErrors: 0, disabledUntil: null },
  ]
  const models = [{
    name: 'shared-protocol-route',
    status: 1,
    bindings: [
      { channelId: 16, upstreamModel: 'shared-primary', priority: 10 },
      { channelId: 17, upstreamModel: 'responses-only-backup', priority: 0 },
    ],
  }]
  const updates: any[] = []
  const pool = new ChannelPoolService(
    {
      find: async () => channels,
      update: async (id: number, value: any) => { updates.push([id, value]) },
    } as any,
    { find: async () => models } as any,
    { find: async () => [] } as any,
    { jwt: { secret }, relay: { autoCircuitBreakerEnabled: true, channelDisableSeconds: 300 } } as any,
    routeStore(models) as any,
  )

  await pool.refresh()
  await pool.recordFailure(16)
  await pool.recordFailure(16)
  await pool.recordFailure(16)

  assert.equal(pool.health(16)?.status, 'degraded')
  assert.equal(pool.pick('shared-protocol-route', 'chat')?.channelId, 16)
  assert.equal(pool.describe('shared-protocol-route').bindings.find((binding) =>
    binding.channelId === 16,
  )?.status, 'available')
  assert.ok(updates.some(([id, value]) => id === 16 && value.disabledUntil === null))
})

test('共享多模型渠道有任一模型缺少备用时不会被自动熔断', async () => {
  const channels = [
    { ...channel(18, ['responses'], 'responses'), consecutiveErrors: 0, disabledUntil: null },
    { ...channel(19, ['responses'], 'responses'), consecutiveErrors: 0, disabledUntil: null },
  ]
  const models = [
    {
      name: 'shared-model-with-backup',
      status: 1,
      bindings: [
        { channelId: 18, upstreamModel: 'primary-a', priority: 10 },
        { channelId: 19, upstreamModel: 'fallback-a', priority: 0 },
      ],
    },
    {
      name: 'shared-model-without-backup',
      status: 1,
      bindings: [{ channelId: 18, upstreamModel: 'only-b', priority: 0 }],
    },
  ]
  const updates: any[] = []
  const pool = new ChannelPoolService(
    {
      find: async () => channels,
      update: async (id: number, value: any) => { updates.push([id, value]) },
    } as any,
    { find: async () => models } as any,
    { find: async () => [] } as any,
    { jwt: { secret }, relay: { autoCircuitBreakerEnabled: true, channelDisableSeconds: 300 } } as any,
    routeStore(models) as any,
  )

  await pool.refresh()
  await pool.recordFailure(18)
  await pool.recordFailure(18)
  await pool.recordFailure(18)

  assert.equal(pool.health(18)?.status, 'degraded')
  assert.equal(pool.pick('shared-model-without-backup', 'responses')?.channelId, 18)
  assert.ok(updates.some(([id, value]) => id === 18 && value.disabledUntil === null))
})

test('唯一 Anthropic 路由连续失败时不自动熔断且仍可 pick', async () => {
  const channels = [{
    ...channel(23, ['anthropic'], 'anthropic'),
    consecutiveErrors: 0,
    disabledUntil: null,
  }]
  const models = [{
    name: 'claude-only-anthropic-route',
    status: 1,
    bindings: [{ channelId: 23, upstreamModel: 'claude-upstream', priority: 0 }],
  }]
  const updates: any[] = []
  const pool = new ChannelPoolService(
    {
      find: async () => channels,
      update: async (id: number, value: any) => { updates.push([id, value]) },
    } as any,
    { find: async () => models } as any,
    { find: async () => [] } as any,
    { jwt: { secret }, relay: { autoCircuitBreakerEnabled: true, channelDisableSeconds: 300 } } as any,
    routeStore(models) as any,
  )

  await pool.refresh()
  await pool.recordFailure(23)
  await pool.recordFailure(23)
  await pool.recordFailure(23)

  assert.equal(pool.pick('claude-only-anthropic-route', 'anthropic')?.channelId, 23)
  assert.equal(pool.health(23)?.status, 'degraded')
  assert.equal(pool.health(23)?.disabledUntil, null)
  assert.equal(
    pool.describe('claude-only-anthropic-route').bindings[0].status,
    'available',
  )
  assert.ok(updates.some(([id, value]) => id === 23 && value.disabledUntil === null))
})

test('唯一 DeepSeek OpenAI-compatible Chat 路由连续失败时不自动熔断且仍可 pick', async () => {
  const channels = [{
    ...channel(24, ['chat'], 'chat'),
    consecutiveErrors: 0,
    disabledUntil: null,
  }]
  const models = [{
    name: 'deepseek-chat-only-route',
    status: 1,
    bindings: [{ channelId: 24, upstreamModel: 'deepseek-chat', priority: 0 }],
  }]
  const updates: any[] = []
  const pool = new ChannelPoolService(
    {
      find: async () => channels,
      update: async (id: number, value: any) => { updates.push([id, value]) },
    } as any,
    { find: async () => models } as any,
    { find: async () => [] } as any,
    { jwt: { secret }, relay: { autoCircuitBreakerEnabled: true, channelDisableSeconds: 300 } } as any,
    routeStore(models) as any,
  )

  await pool.refresh()
  await pool.recordFailure(24)
  await pool.recordFailure(24)
  await pool.recordFailure(24)

  const picked = pool.pick('deepseek-chat-only-route', 'chat')
  assert.equal(picked?.channelId, 24)
  assert.equal(picked?.upstreamModel, 'deepseek-chat')
  assert.equal(pool.health(24)?.status, 'degraded')
  assert.equal(pool.health(24)?.disabledUntil, null)
  assert.equal(pool.describe('deepseek-chat-only-route').bindings[0].status, 'available')
  assert.ok(updates.some(([id, value]) => id === 24 && value.disabledUntil === null))
})

test('路径级健康不让 Chat 成功清零同渠道 Responses 失败，并只熔断失败协议', async () => {
  const channels = [
    { ...channel(41, ['chat', 'responses']), consecutiveErrors: 0, disabledUntil: null },
    { ...channel(42, ['responses'], 'responses'), consecutiveErrors: 0, disabledUntil: null },
  ]
  const models = [{
    id: 410,
    name: 'strict-path-health',
    status: 1,
    bindings: [
      { channelId: 41, upstreamModel: 'primary', priority: 10 },
      { channelId: 42, upstreamModel: 'responses-backup', priority: 0 },
    ],
  }]
  const pool = new ChannelPoolService(
    { find: async () => channels, update: async () => {} } as any,
    { find: async () => models } as any,
    { find: async () => [] } as any,
    { jwt: { secret }, relay: { autoCircuitBreakerEnabled: true, channelDisableSeconds: 300 } } as any,
    routeStore(models) as any,
  )

  await pool.refresh()
  await pool.recordSuccess(42, 'strict-path-health', 'responses')
  await pool.recordFailure(41, 'strict-path-health', 'responses')
  await pool.recordFailure(41, 'strict-path-health', 'responses')
  // Success on another protocol must not clear the Responses error sequence.
  await pool.recordSuccess(41, 'strict-path-health', 'chat')
  await pool.recordFailure(41, 'strict-path-health', 'responses')

  assert.equal(pool.pick('strict-path-health', 'responses')?.channelId, 42)
  assert.equal(pool.pick('strict-path-health', 'chat')?.channelId, 41)
  assert.equal(pool.health(41)?.status, 'circuit_open')
})

test('未作用域的旧成功只更新渠道汇总，不能清零严格路径失败', async () => {
  const channels = [
    { ...channel(52, ['responses'], 'responses'), consecutiveErrors: 0, disabledUntil: null },
    { ...channel(53, ['responses'], 'responses'), consecutiveErrors: 0, disabledUntil: null },
  ]
  const models = [{
    name: 'legacy-summary-cannot-recover-route', status: 1,
    bindings: [
      { channelId: 52, upstreamModel: 'primary', priority: 10 },
      { channelId: 53, upstreamModel: 'verified-backup', priority: 0 },
    ],
  }]
  const pool = new ChannelPoolService(
    { find: async () => channels, update: async () => {} } as any,
    { find: async () => models } as any,
    { find: async () => [] } as any,
    { jwt: { secret }, relay: { autoCircuitBreakerEnabled: true, channelDisableSeconds: 300 } } as any,
    routeStore(models) as any,
  )

  await pool.refresh()
  await pool.recordSuccess(53, 'legacy-summary-cannot-recover-route', 'responses')
  await pool.recordFailure(52, 'legacy-summary-cannot-recover-route', 'responses')
  await pool.recordFailure(52, 'legacy-summary-cannot-recover-route', 'responses')
  // A legacy caller knows only the channel, so this cannot prove that the
  // failed Responses path recovered.
  await pool.recordSuccess(52)
  await pool.recordFailure(52, 'legacy-summary-cannot-recover-route', 'responses')

  assert.equal(pool.pick('legacy-summary-cannot-recover-route', 'responses')?.channelId, 53)
  assert.equal(pool.health(52)?.status, 'circuit_open')
})

test('无真实绑定的结果不创建路径健康证据', async () => {
  const channels = [{ ...channel(54, ['responses'], 'responses') }]
  const models = [{
    id: 540,
    name: 'strict-outcome-binding',
    status: 1,
    bindings: [{ channelId: 54, upstreamModel: 'upstream', priority: 0 }],
  }]
  const routeHealthQueries: unknown[][] = []
  const pool = new ChannelPoolService(
    { find: async () => channels, update: async () => {} } as any,
    { find: async () => models } as any,
    { find: async () => [] } as any,
    { jwt: { secret }, relay: { autoCircuitBreakerEnabled: true, channelDisableSeconds: 300 } } as any,
    routeStore(models) as any,
    {
      find: async () => [],
      query: async (_sql: string, values: unknown[]) => { routeHealthQueries.push(values) },
    } as any,
  )

  await pool.refresh()
  // The channel does not offer Chat for this binding. It must not be recorded
  // as a synthetic Chat success that could later justify a circuit decision.
  await pool.recordSuccess(54, 'strict-outcome-binding', 'chat')

  assert.equal(routeHealthQueries.length, 0)
  assert.equal(pool.pick('strict-outcome-binding', 'responses')?.channelId, 54)
})

test('冷备可被正常选择，但未在同路径成功前不能支撑自动熔断', async () => {
  const channels = [
    { ...channel(43, ['responses'], 'responses'), consecutiveErrors: 0, disabledUntil: null },
    { ...channel(44, ['responses'], 'responses'), consecutiveErrors: 0, disabledUntil: null },
  ]
  const models = [{
    name: 'cold-fallback',
    status: 1,
    bindings: [
      { channelId: 43, upstreamModel: 'primary', priority: 10 },
      { channelId: 44, upstreamModel: 'cold-backup', priority: 0 },
    ],
  }]
  const pool = new ChannelPoolService(
    { find: async () => channels, update: async () => {} } as any,
    { find: async () => models } as any,
    { find: async () => [] } as any,
    { jwt: { secret }, relay: { autoCircuitBreakerEnabled: true, channelDisableSeconds: 300 } } as any,
    routeStore(models) as any,
  )

  await pool.refresh()
  assert.equal(pool.pick('cold-fallback', 'responses', new Set([43]))?.channelId, 44)
  await pool.recordFailure(43, 'cold-fallback', 'responses')
  await pool.recordFailure(43, 'cold-fallback', 'responses')
  await pool.recordFailure(43, 'cold-fallback', 'responses')
  assert.equal(pool.pick('cold-fallback', 'responses')?.channelId, 43)
  assert.equal(pool.health(43)?.status, 'degraded')
})

test('跨模型成功不能作为当前模型路径的熔断备用', async () => {
  const channels = [
    { ...channel(45, ['responses'], 'responses'), consecutiveErrors: 0, disabledUntil: null },
    { ...channel(46, ['responses'], 'responses'), consecutiveErrors: 0, disabledUntil: null },
  ]
  const models = [
    {
      name: 'strict-primary-model', status: 1,
      bindings: [
        { channelId: 45, upstreamModel: 'primary-a', priority: 10 },
        { channelId: 46, upstreamModel: 'backup-a', priority: 0 },
      ],
    },
    {
      name: 'different-model', status: 1,
      bindings: [{ channelId: 46, upstreamModel: 'backup-b', priority: 0 }],
    },
  ]
  const pool = new ChannelPoolService(
    { find: async () => channels, update: async () => {} } as any,
    { find: async () => models } as any,
    { find: async () => [] } as any,
    { jwt: { secret }, relay: { autoCircuitBreakerEnabled: true, channelDisableSeconds: 300 } } as any,
    routeStore(models) as any,
  )

  await pool.refresh()
  await pool.recordSuccess(46, 'different-model', 'responses')
  await pool.recordFailure(45, 'strict-primary-model', 'responses')
  await pool.recordFailure(45, 'strict-primary-model', 'responses')
  await pool.recordFailure(45, 'strict-primary-model', 'responses')

  assert.equal(pool.pick('strict-primary-model', 'responses')?.channelId, 45)
  assert.equal(pool.health(45)?.status, 'degraded')
})

test('迟到的旧成功不会覆盖同路径更新失败', async () => {
  const channels = [{ ...channel(47, ['responses'], 'responses'), consecutiveErrors: 0, disabledUntil: null }]
  const models = [{
    name: 'outcome-ordering', status: 1,
    bindings: [{ channelId: 47, upstreamModel: 'ordering', priority: 0 }],
  }]
  const pool = new ChannelPoolService(
    { find: async () => channels, update: async () => {} } as any,
    { find: async () => models } as any,
    { find: async () => [] } as any,
    { jwt: { secret }, relay: { autoCircuitBreakerEnabled: true, channelDisableSeconds: 300 } } as any,
    routeStore(models) as any,
  )
  const newerFailure = new Date('2026-08-20T04:00:01.000Z')
  const olderSuccess = new Date('2026-08-20T04:00:00.000Z')

  await pool.refresh()
  await pool.recordFailure(47, 'outcome-ordering', 'responses', newerFailure)
  await pool.recordSuccess(47, 'outcome-ordering', 'responses', olderSuccess)

  assert.equal(pool.health(47)?.consecutiveErrors, 1)
  assert.equal(pool.health(47)?.status, 'degraded')
})

test('最后失败晚于成功时，即使错误计数异常为零也不能作为健康备用', async () => {
  const channels = [
    { ...channel(48, ['responses'], 'responses'), consecutiveErrors: 0, disabledUntil: null },
    { ...channel(49, ['responses'], 'responses'), consecutiveErrors: 0, disabledUntil: null },
  ]
  const models = [{
    id: 480,
    name: 'persisted-order-guard',
    status: 1,
    bindings: [
      { channelId: 48, upstreamModel: 'primary', priority: 10 },
      { channelId: 49, upstreamModel: 'badly-persisted-backup', priority: 0 },
    ],
  }]
  const pool = new ChannelPoolService(
    { find: async () => channels, update: async () => {} } as any,
    { find: async () => models } as any,
    { find: async () => [] } as any,
    { jwt: { secret }, relay: { autoCircuitBreakerEnabled: true, channelDisableSeconds: 300 } } as any,
    routeStore(models) as any,
    {
      find: async () => [{
        channelId: 49,
        modelIdentity: 'id:480',
        modelName: 'persisted-order-guard',
        protocol: 'responses',
        consecutiveErrors: 0,
        disabledUntil: null,
        totalRequests: 2,
        failedRequests: 1,
        lastSuccessAt: new Date('2026-08-20T04:00:00.000Z'),
        lastFailureAt: new Date('2026-08-20T04:00:01.000Z'),
        lastOutcomeAt: new Date('2026-08-20T04:00:01.000Z'),
      }],
    } as any,
  )

  await pool.refresh()
  await pool.recordFailure(48, 'persisted-order-guard', 'responses')
  await pool.recordFailure(48, 'persisted-order-guard', 'responses')
  await pool.recordFailure(48, 'persisted-order-guard', 'responses')

  assert.equal(pool.pick('persisted-order-guard', 'responses')?.channelId, 48)
  assert.equal(pool.health(48)?.status, 'degraded')
})

test('模型缺失 ID 时以模型名隔离路径健康，不能跨模型借用成功', async () => {
  const channels = [
    { ...channel(50, ['responses'], 'responses'), consecutiveErrors: 0, disabledUntil: null },
    { ...channel(51, ['responses'], 'responses'), consecutiveErrors: 0, disabledUntil: null },
  ]
  const models = [
    { name: 'name-identity-primary', status: 1 },
    { name: 'name-identity-other', status: 1 },
  ]
  // The real store is keyed by a database ID. This test deliberately supplies
  // no ID and verifies the name fallback remains isolated instead of merging.
  const pool = new ChannelPoolService(
    { find: async () => channels, update: async () => {} } as any,
    { find: async () => models } as any,
    { find: async () => [] } as any,
    { jwt: { secret }, relay: { autoCircuitBreakerEnabled: true, channelDisableSeconds: 300 } } as any,
    {
      bindingsByModel: async () => new Map([
        [undefined, [
          { channelId: 50, upstreamModel: 'primary', priority: 10, status: 1 },
          { channelId: 51, upstreamModel: 'backup', priority: 0, status: 1 },
        ]],
      ]),
    } as any,
  )

  await pool.refresh()
  // Both no-ID models share a store key in this malformed fixture, but the
  // distinct model names still produce different route-health identities.
  await pool.recordSuccess(51, 'name-identity-other', 'responses')
  await pool.recordFailure(50, 'name-identity-primary', 'responses')
  await pool.recordFailure(50, 'name-identity-primary', 'responses')
  await pool.recordFailure(50, 'name-identity-primary', 'responses')

  assert.equal(pool.pick('name-identity-primary', 'responses')?.channelId, 50)
})

test('关闭自动熔断不影响管理员手动停用渠道和供应商账户', async () => {
  const manuallyDisabled = {
    ...channel(10, ['chat']),
    status: 0,
    supplierAccountId: null,
  }
  const accountDisabled = {
    ...channel(11, ['chat']),
    supplierAccountId: 21,
  }
  const available = {
    ...channel(12, ['chat']),
    supplierAccountId: 22,
  }
  const models = [{
    name: 'manual-control-test',
    status: 1,
    bindings: [
      { channelId: 10, upstreamModel: 'manual-disabled', priority: 30 },
      { channelId: 11, upstreamModel: 'account-disabled', priority: 20 },
      { channelId: 12, upstreamModel: 'available', priority: 10 },
    ],
  }]
  const accounts = [
    { id: 21, name: 'Disabled account', routingEnabled: 0 },
    { id: 22, name: 'Available account', routingEnabled: 1 },
  ]
  const pool = new ChannelPoolService(
    { find: async () => [manuallyDisabled, accountDisabled, available] } as any,
    { find: async () => models } as any,
    { find: async () => accounts } as any,
    {
      jwt: { secret },
      relay: {
        autoCircuitBreakerEnabled: false,
        channelDisableSeconds: 300,
      },
    } as any,
    routeStore(models) as any,
  )

  await pool.refresh()

  assert.equal(pool.pick('manual-control-test', 'chat')?.channelId, 12)
  const routing = pool.describe('manual-control-test')
  assert.equal(
    routing.bindings.find((binding) => binding.channelId === 10)?.status,
    'channel_disabled',
  )
  assert.equal(
    routing.bindings.find((binding) => binding.channelId === 11)?.status,
    'account_disabled',
  )
  assert.equal(
    routing.bindings.find((binding) => binding.channelId === 12)?.status,
    'available',
  )
})

test('渠道池优先最高优先级，重试时选择尚未尝试的备用渠道', async () => {
  const primary = { ...channel(1, ['responses'], 'responses'), priority: 20 }
  const fallback = { ...channel(2, ['responses'], 'responses'), priority: 5 }
  const models = [{
    name: 'priority-test',
    status: 1,
    bindings: [
      { channelId: 1, upstreamModel: 'primary', priority: 20 },
      { channelId: 2, upstreamModel: 'fallback', priority: 5 },
    ],
  }]
  const pool = new ChannelPoolService(
    { find: async () => [primary, fallback] } as any,
    { find: async () => models } as any,
    { find: async () => [] } as any,
    { jwt: { secret } } as any,
    routeStore(models) as any,
  )

  await pool.refresh()
  assert.equal(pool.pick('priority-test', 'responses')?.channelId, 1)
  assert.equal(pool.pick('priority-test', 'responses')?.channelId, 1)
  assert.equal(
    pool.pick('priority-test', 'responses', new Set([1]))?.channelId,
    2,
  )
  const routing = pool.describe('priority-test')
  assert.equal(routing.strategy, 'failover')
  assert.equal(routing.configuredBindingCount, 2)
  assert.equal(routing.routableBindingCount, 2)
  assert.equal(routing.availableBindingCount, 2)
  assert.equal(routing.protocolAvailability.responses, 2)
  assert.doesNotMatch(JSON.stringify(routing), /upstream-key/)
})

test('同优先级渠道按权重确定性轮询', async () => {
  const weighted = [
    { ...channel(1, ['chat']), weight: 3 },
    { ...channel(2, ['chat']), weight: 1 },
  ]
  const models = [{
    name: 'weighted-test',
    status: 1,
    bindings: [
      { channelId: 1, upstreamModel: 'weighted-primary', priority: 5 },
      { channelId: 2, upstreamModel: 'weighted-secondary', priority: 5 },
    ],
  }]
  const pool = new ChannelPoolService(
    { find: async () => weighted } as any,
    { find: async () => models } as any,
    { find: async () => [] } as any,
    { jwt: { secret } } as any,
    routeStore(models) as any,
  )

  await pool.refresh()
  const picks = Array.from({ length: 8 }, () => pool.pick('weighted-test', 'chat')?.channelId)

  assert.deepEqual(picks, [1, 1, 2, 1, 1, 1, 2, 1])
  const routing = pool.describe('weighted-test')
  assert.equal(routing.strategy, 'load_balance')
  assert.deepEqual(routing.bindings.map((binding) => binding.weight), [3, 1])
  assert.doesNotMatch(JSON.stringify(routing), /upstream-key/)
})

test('停用供应商账户后关联渠道退出路由池，未归属旧渠道保持兼容', async () => {
  const linked = { ...channel(1, ['chat']), supplierAccountId: 7 }
  const legacy = { ...channel(2, ['chat']), supplierAccountId: null }
  const models = [{
    name: 'account-routing-test',
    status: 1,
    bindings: [
      { channelId: 1, upstreamModel: 'linked', priority: 10 },
      { channelId: 2, upstreamModel: 'legacy', priority: 0 },
    ],
  }]
  const pool = new ChannelPoolService(
    { find: async () => [linked, legacy] } as any,
    { find: async () => models } as any,
    { find: async () => [] } as any,
    { jwt: { secret } } as any,
    routeStore(models) as any,
  )

  await pool.refresh()

  assert.equal(pool.pick('account-routing-test', 'chat')?.channelId, 2)
  const routing = pool.describe('account-routing-test')
  assert.equal(routing.strategy, 'failover')
  assert.equal(routing.configuredBindingCount, 2)
  assert.equal(routing.routableBindingCount, 1)
  assert.equal(routing.availableBindingCount, 1)
  assert.equal(routing.bindings.find((binding) => binding.channelId === 1)?.status, 'account_missing')
  assert.equal(routing.bindings.find((binding) => binding.channelId === 2)?.status, 'available')
})

test('熔断锁不可用或共享状态查询失败时保留当前路径', async () => {
  for (const mode of ['busy', 'query-error'] as const) {
    const channels = [
      { ...channel(61, ['responses'], 'responses') },
      { ...channel(62, ['responses'], 'responses') },
    ]
    const models = [{
      id: 610,
      name: `circuit-${mode}-keeps-route`,
      status: 1,
      bindings: [
        { channelId: 61, upstreamModel: 'primary', priority: 10 },
        { channelId: 62, upstreamModel: 'verified-backup', priority: 0 },
      ],
    }]
    const conservativeWrites: unknown[][] = []
    const runner = {
      connect: async () => {},
      release: async () => {},
      query: async (sql: string) => {
        if (sql.includes('GET_LOCK')) return [{ acquired: mode === 'busy' ? 0 : 1 }]
        if (sql.includes('SELECT channelId')) throw new Error('database unavailable')
        return [{ released: 1 }]
      },
    }
    const pool = new ChannelPoolService(
      { find: async () => channels, update: async () => {} } as any,
      { find: async () => models } as any,
      { find: async () => [] } as any,
      { jwt: { secret }, relay: { autoCircuitBreakerEnabled: true, channelDisableSeconds: 300 } } as any,
      routeStore(models) as any,
      {
        find: async () => [],
        query: async (_sql: string, values: unknown[]) => { conservativeWrites.push(values) },
        manager: { connection: { createQueryRunner: () => runner } },
      } as any,
    )

    await pool.refresh()
    const identity = 'id:610'
    const now = new Date()
    ;(pool as any).routeHealth.set(`61:${identity}:responses`, {
      channelId: 61,
      modelIdentity: identity,
      modelName: models[0].name,
      protocol: 'responses',
      consecutiveErrors: 2,
      disabledUntil: null,
      totalRequests: 2,
      failedRequests: 2,
      lastSuccessAt: now,
      lastFailureAt: now,
      lastOutcomeAt: now,
    })
    ;(pool as any).routeHealth.set(`62:${identity}:responses`, {
      channelId: 62,
      modelIdentity: identity,
      modelName: models[0].name,
      protocol: 'responses',
      consecutiveErrors: 0,
      disabledUntil: null,
      totalRequests: 1,
      failedRequests: 0,
      lastSuccessAt: now,
      lastFailureAt: null,
      lastOutcomeAt: now,
    })

    const outcomeAt = mode === 'busy'
      ? new Date(now.getTime() - 1_000)
      : new Date(now.getTime() + 1_000)
    ;(pool as any).routeHealth.get(`61:${identity}:responses`).disabledUntil = Date.now() + 60_000
    await pool.recordFailure(61, models[0].name, 'responses', outcomeAt)

    assert.equal(pool.pick(models[0].name, 'responses')?.channelId, 61)
    assert.equal(pool.health(61)?.disabledUntil, null)
    assert.equal(pool.describe(models[0].name).bindings[0].status, 'available')
    assert.equal(conservativeWrites.length, 1)
  }
})

test('熔断锁释放异常不会覆盖保守路由结果', async () => {
  const channels = [{ ...channel(63, ['responses'], 'responses') }]
  const models = [{
    id: 630,
    name: 'circuit-release-failure-keeps-route',
    status: 1,
    bindings: [{ channelId: 63, upstreamModel: 'only-route', priority: 0 }],
  }]
  const runner = {
    connect: async () => {},
    release: async () => { throw new Error('connection already closed') },
    query: async (sql: string) => {
      if (sql.includes('GET_LOCK')) return [{ acquired: 1 }]
      if (sql.includes('SELECT channelId')) return []
      if (sql.includes('RELEASE_LOCK')) return [{ released: 0 }]
      return []
    },
  }
  const pool = new ChannelPoolService(
    { find: async () => channels, update: async () => {} } as any,
    { find: async () => models } as any,
    { find: async () => [] } as any,
    { jwt: { secret }, relay: { autoCircuitBreakerEnabled: true, channelDisableSeconds: 300 } } as any,
    routeStore(models) as any,
    {
      find: async () => [],
      query: async () => [],
      manager: { connection: { createQueryRunner: () => runner } },
    } as any,
  )

  await pool.refresh()
  await assert.doesNotReject(pool.recordFailure(63, models[0].name, 'responses'))
  assert.equal(pool.pick(models[0].name, 'responses')?.channelId, 63)
  assert.equal(pool.health(63)?.disabledUntil, null)
})
