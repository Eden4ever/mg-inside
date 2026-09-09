import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { RelayService } from '../src/modules/relay/relay.service'

class StartedResponse extends EventEmitter {
  headersSent = true
  writableEnded = false
  destroyed = false
  endCalls = 0
  writeCalls = 0
  setHeaderCalls = 0
  statusCalls = 0

  end() {
    this.endCalls++
    this.writableEnded = true
    return this
  }

  write() {
    this.writeCalls++
    throw new Error('流开始后不得写错误体')
  }

  setHeader() {
    this.setHeaderCalls++
    throw new Error('流开始后不得修改响应头')
  }

  status() {
    this.statusCalls++
    throw new Error('流开始后不得修改状态码')
  }
}

function relayService(accounting: any = {}, executor: any = {}) {
  return new RelayService(
    {} as any,
    accounting,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    executor,
  )
}

test('Responses 流开始后，RelayService 不再写协议错误体或响应头', () => {
  const service = relayService()
  const res = new StartedResponse()

  ;(service as any).sendResponsesError(res, 502, 'upstream_error', '上游中断')
  ;(service as any).sendUpstreamError(
    res,
    'responses',
    502,
    '{"error":{"message":"上游中断"}}',
    'application/json',
    'upstream-request-id',
  )

  assert.equal(res.endCalls, 1)
  assert.equal(res.writeCalls, 0)
  assert.equal(res.setHeaderCalls, 0)
  assert.equal(res.statusCalls, 0)
})

test('Responses 流中断仍记录部分失败，但不会重试或再次写响应', async () => {
  const failures: any[] = []
  const accounting = {
    fail: async (_context: unknown, failure: any) => { failures.push(failure) },
  }
  const executor = {
    execute: async (input: any) => {
      assert.equal(input.canRetry(), false)
      return {
        kind: 'transport_error',
        picked: {
          channelId: 4,
          upstreamModel: 'gpt-upstream',
          baseUrl: 'https://upstream.example/v1',
          protocol: 'responses',
          key: 'secret',
        },
        attempt: 0,
        error: new Error('upstream stream terminated'),
      }
    },
  }
  const service = relayService(accounting, executor)
  const res = new StartedResponse()
  const context = { accounting: {}, model: 'gpt-public', modelConfig: {} }

  await (service as any).executeProtocol({
    protocol: 'responses',
    context,
    res,
    isStream: true,
    noChannel: { status: 503, code: 'no_responses_channel', message: 'unused' },
    transportErrorMessage: 'unused',
    forward: async () => { throw new Error('must not forward') },
  })

  assert.deepEqual(failures, [{
    code: 'upstream_error',
    message: 'upstream stream terminated',
    responseStatus: 502,
    picked: {
      channelId: 4,
      upstreamModel: 'gpt-upstream',
      baseUrl: 'https://upstream.example/v1',
      protocol: 'responses',
      key: 'secret',
    },
    isStream: true,
    retryCount: 0,
    partial: true,
  }])
  assert.equal(res.endCalls, 1)
  assert.equal(res.writeCalls, 0)
  assert.equal(res.setHeaderCalls, 0)
  assert.equal(res.statusCalls, 0)
})
