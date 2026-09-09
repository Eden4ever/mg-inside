import test from 'node:test'
import assert from 'node:assert/strict'
import { RelayExecutor } from '../src/modules/relay/relay-executor'
import { classifyUpstreamFailure } from '../src/modules/relay/relay-retry-policy'
import { RelayClientAbortError } from '../src/modules/relay/relay-client-abort.error'

const picked = (channelId: number) => ({
  channelId,
  upstreamModel: 'upstream-model',
  baseUrl: 'https://example.test/v1',
  protocol: 'responses' as const,
  key: 'upstream-key',
})

function config(maxTries = 3) {
  return { relay: { maxTries } } as any
}

test('RelayExecutor 统一处理跨协议重试，并在成功后恢复渠道健康状态', async () => {
  const picks = [picked(1), picked(2)]
  const failures: Array<[number, string, string]> = []
  const successes: Array<[number, string, string]> = []
  const pool = {
    pick: (_model: string, protocol: string) => {
      assert.equal(protocol, 'responses')
      return picks.shift() || null
    },
    recordFailure: async (channelId: number, model: string, protocol: string) => { failures.push([channelId, model, protocol]) },
    recordSuccess: async (channelId: number, model: string, protocol: string) => { successes.push([channelId, model, protocol]) },
  }
  const executor = new RelayExecutor(pool as any, config(3))
  let calls = 0

  const result = await executor.execute({
    protocol: 'responses',
    model: 'public-model',
    forward: async (channel) => {
      calls++
      if (calls === 1) {
        return {
          kind: 'upstream_error',
          status: 429,
          body: '{"error":{"message":"rate limited"}}',
          contentType: 'application/json',
        }
      }
      assert.equal(channel.channelId, 2)
      return {
        kind: 'success',
        usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
        firstTokenMs: 7,
      }
    },
  })

  assert.equal(result.kind, 'success')
  assert.equal(calls, 2)
  assert.deepEqual(failures, [[1, 'public-model', 'responses']])
  assert.deepEqual(successes, [[2, 'public-model', 'responses']])
  if (result.kind === 'success') assert.equal(result.attempt, 1)
})

test('RelayExecutor 最终上游错误只返回一次且不吞掉响应元数据', async () => {
  const pool = {
    pick: () => picked(9),
    recordFailure: async () => {},
    recordSuccess: async () => {},
  }
  const executor = new RelayExecutor(pool as any, config(2))
  const result = await executor.execute({
    protocol: 'anthropic',
    model: 'claude-sonnet-4-6',
    forward: async () => ({
      kind: 'upstream_error',
      status: 529,
      body: '{"type":"error"}',
      contentType: 'application/json',
      requestId: 'req-1',
    }),
  })

  assert.equal(result.kind, 'upstream_error')
  if (result.kind === 'upstream_error') {
    assert.equal(result.attempt, 1)
    assert.equal(result.result.requestId, 'req-1')
  }
})

test('同一请求重试同一渠道时只记一次健康失败', async () => {
  const failures: number[] = []
  let calls = 0
  const pool = {
    pick: () => picked(9),
    recordFailure: async (channelId: number) => { failures.push(channelId) },
    recordSuccess: async () => {},
  }
  const executor = new RelayExecutor(pool as any, config(3))
  const result = await executor.execute({
    protocol: 'responses',
    model: 'gpt-5.6-terra',
    forward: async () => {
      calls++
      return {
        kind: 'upstream_error',
        status: 403,
        body: '{"error":{"message":"forbidden"}}',
        contentType: 'application/json',
      }
    },
  })

  assert.equal(result.kind, 'upstream_error')
  assert.equal(calls, 3)
  assert.deepEqual(failures, [9])
})

test('RelayExecutor 没有可用渠道时不调用 transport', async () => {
  const pool = {
    pick: () => null,
    recordFailure: async () => {},
    recordSuccess: async () => {},
  }
  const executor = new RelayExecutor(pool as any, config())
  let called = false
  const result = await executor.execute({
    protocol: 'chat',
    model: 'missing',
    forward: async () => {
      called = true
      throw new Error('must not call')
    },
  })

  assert.equal(result.kind, 'no_channel')
  assert.equal(called, false)
})

test('客户端语义错误不重试且不污染渠道健康状态', async () => {
  const failures: number[] = []
  let calls = 0
  const pool = {
    pick: () => picked(7),
    recordFailure: async (channelId: number) => { failures.push(channelId) },
    recordSuccess: async () => {},
  }
  const executor = new RelayExecutor(pool as any, config(3))
  const result = await executor.execute({
    protocol: 'responses',
    model: 'public-model',
    forward: async () => {
      calls++
      return {
        kind: 'upstream_error',
        status: 400,
        body: '{"error":{"message":"invalid input"}}',
        contentType: 'application/json',
      }
    },
  })

  assert.equal(result.kind, 'upstream_error')
  if (result.kind === 'upstream_error') assert.equal(result.attempt, 0)
  assert.equal(calls, 1)
  assert.deepEqual(failures, [])
})

test('流式响应开始后发生传输错误时不重试，避免重复写响应头', async () => {
  const failures: number[] = []
  let calls = 0
  let headersSent = false
  const pool = {
    pick: () => picked(4),
    recordFailure: async (channelId: number) => { failures.push(channelId) },
    recordSuccess: async () => {},
  }
  const executor = new RelayExecutor(pool as any, config(3))
  const result = await executor.execute({
    protocol: 'responses',
    model: 'gpt-5.6-terra',
    canRetry: () => !headersSent,
    forward: async () => {
      calls++
      headersSent = true
      throw new Error('upstream stream terminated')
    },
  })

  assert.equal(result.kind, 'transport_error')
  if (result.kind === 'transport_error') assert.equal(result.attempt, 0)
  assert.equal(calls, 1)
  assert.deepEqual(failures, [4])
})

test('客户端主动断开时不重试且不污染渠道健康状态', async () => {
  const failures: number[] = []
  let calls = 0
  const pool = {
    pick: () => picked(4),
    recordFailure: async (channelId: number) => { failures.push(channelId) },
    recordSuccess: async () => {},
  }
  const executor = new RelayExecutor(pool as any, config(3))
  const result = await executor.execute({
    protocol: 'responses',
    model: 'gpt-5.6-terra',
    forward: async () => {
      calls++
      throw new RelayClientAbortError(new Error('canceled'))
    },
  })

  assert.equal(result.kind, 'client_abort')
  if (result.kind === 'client_abort') assert.equal(result.attempt, 0)
  assert.equal(calls, 1)
  assert.deepEqual(failures, [])
})

test('流式响应开始后返回上游错误时不重试', async () => {
  const failures: number[] = []
  let calls = 0
  let headersSent = false
  const pool = {
    pick: () => picked(4),
    recordFailure: async (channelId: number) => { failures.push(channelId) },
    recordSuccess: async () => {},
  }
  const executor = new RelayExecutor(pool as any, config(3))
  const result = await executor.execute({
    protocol: 'responses',
    model: 'gpt-5.6-terra',
    canRetry: () => !headersSent,
    forward: async () => {
      calls++
      headersSent = true
      return {
        kind: 'upstream_error',
        status: 500,
        body: '{"error":{"message":"stream failed"}}',
        contentType: 'application/json',
      }
    },
  })

  assert.equal(result.kind, 'upstream_error')
  if (result.kind === 'upstream_error') assert.equal(result.attempt, 0)
  assert.equal(calls, 1)
  assert.deepEqual(failures, [4])
})

test('重试策略区分客户端语义错误与渠道故障', () => {
  assert.deepEqual(classifyUpstreamFailure(400), {
    retry: false,
    recordChannelFailure: false,
  })
  assert.deepEqual(classifyUpstreamFailure(413), {
    retry: false,
    recordChannelFailure: false,
  })
  for (const status of [401, 403, 404, 408, 409, 425, 429, 500, 529]) {
    assert.deepEqual(classifyUpstreamFailure(status), {
      retry: true,
      recordChannelFailure: true,
    })
  }
})
