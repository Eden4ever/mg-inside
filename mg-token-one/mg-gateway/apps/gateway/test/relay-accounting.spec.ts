import test from 'node:test'
import assert from 'node:assert/strict'
import { RelayAccounting } from '../src/modules/relay/relay-accounting'

const tokenInfo = {
  tokenId: 7,
  userId: 9,
  groupTag: 'default',
  userDepartment: '研发',
} as any

const modelConfig = {
  pricingMode: 'fixed',
  inputPrice: 2,
  cachePrice: 0.5,
  outputPrice: 4,
} as any

test('RelayAccounting 统一处理成功结算、失败回滚和协议日志', async () => {
  const settlements: Array<[number, number]> = []
  const touched: number[] = []
  const logs: any[] = []
  const quota = {
    preCheck: async () => true,
    settle: async (_info: any, actual: number, estimated: number) => {
      settlements.push([actual, estimated])
    },
    touchToken: async (tokenId: number) => { touched.push(tokenId) },
  }
  const accounting = new RelayAccounting(quota as any, {
    record: (input: any) => logs.push(input),
  } as any)

  const failed = accounting.begin({
    protocol: 'responses',
    info: tokenInfo,
    model: 'gpt-test',
    clientIp: '127.0.0.1',
  })
  assert.equal(await accounting.reserve(failed, modelConfig, 1000), true)
  await accounting.fail(failed, {
    code: 'upstream_error',
    message: 'rate limited',
    isStream: false,
    retryCount: 2,
  })
  await accounting.fail(failed, {
    code: 'duplicate',
    message: 'must not be recorded twice',
  })

  const succeeded = accounting.begin({
    protocol: 'chat',
    info: tokenInfo,
    model: 'gpt-test',
    clientIp: null,
  })
  assert.equal(await accounting.reserve(succeeded, modelConfig, 1000), true)
  await accounting.succeed(succeeded, {
    picked: {
      channelId: 3,
      upstreamModel: 'gpt-upstream',
    } as any,
    inputTokens: 100,
    cachedTokens: 40,
    outputTokens: 50,
    totalTokens: 150,
    isStream: true,
    usageEstimated: false,
    firstTokenMs: 25,
    retryCount: 0,
  })

  assert.deepEqual(settlements, [
    [0, 0.004512],
    [0.00034, 0.004512],
  ])
  assert.deepEqual(touched, [7, 7])
  assert.equal(logs.length, 2)
  assert.deepEqual(
    logs.map((log) => [log.protocol, log.status, log.totalTokens]),
    [['responses', 0, 0], ['chat', 1, 150]],
  )
  assert.match(logs[0].errorMessage, /upstream_error: rate limited/)
  assert.equal(logs[0].errorCode, 'upstream_error')
  assert.equal(logs[0].responseStatus, 502)
  assert.equal(logs[1].channelId, 3)
  assert.equal(logs[1].cachedTokens, 40)
  assert.equal(logs[1].quotaCost, 0.00034)
})

test('RelayAccounting 为本地和上游失败保留可聚合的错误码与 HTTP 状态', async () => {
  const logs: any[] = []
  const accounting = new RelayAccounting({
    preCheck: async () => true,
    settle: async () => {},
    touchToken: async () => {},
  } as any, {
    record: (input: any) => logs.push(input),
  } as any)

  const noChannel = accounting.begin({ protocol: 'responses', info: tokenInfo, model: 'gpt-test', clientIp: null })
  await accounting.fail(noChannel, {
    code: 'no_responses_channel',
    message: '没有原生渠道',
  })
  const upstream = accounting.begin({ protocol: 'responses', info: tokenInfo, model: 'gpt-test', clientIp: null })
  await accounting.fail(upstream, {
    code: 'upstream_error',
    message: 'service unavailable',
    responseStatus: 503,
  })
  const disconnect = accounting.begin({ protocol: 'responses', info: tokenInfo, model: 'gpt-test', clientIp: null })
  await accounting.fail(disconnect, {
    code: 'client_disconnected',
    message: 'caller closed',
  })

  assert.deepEqual(logs.map((log) => [log.errorCode, log.responseStatus]), [
    ['no_responses_channel', 503],
    ['upstream_error', 503],
    ['client_disconnected', null],
  ])
})
