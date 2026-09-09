import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import {
  AnthropicMessagesTransport,
  UpstreamPostAdapter,
} from '../src/modules/relay/anthropic-messages-transport'
import { RelayClientAbortError } from '../src/modules/relay/relay-client-abort.error'

class FakeHttp implements UpstreamPostAdapter {
  calls: { url: string; body: any; config: any }[] = []

  constructor(private readonly response: any) {}

  async post(url: string, body: any, config: any) {
    this.calls.push({ url, body, config })
    return this.response
  }
}

class FakeResponse extends EventEmitter {
  statusCode = 200
  headers: Record<string, string> = {}
  headersSent = false
  writableEnded = false
  chunks: Buffer[] = []

  status(code: number) { this.statusCode = code; return this }
  type(value: string) { this.headers['Content-Type'] = value; return this }
  setHeader(name: string, value: string) { this.headers[name] = value; return this }
  send(value: string) {
    this.headersSent = true
    this.chunks.push(Buffer.from(value))
    this.writableEnded = true
    return this
  }
  writeHead(code: number, headers: Record<string, string>) {
    this.statusCode = code
    this.headers = { ...this.headers, ...headers }
    this.headersSent = true
    return this
  }
  write(value: Buffer | string) {
    this.headersSent = true
    this.chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(value))
    return true
  }
  end() { this.writableEnded = true; return this }
  text() { return Buffer.concat(this.chunks).toString('utf8') }
}

const picked = {
  channelId: 5,
  upstreamModel: 'claude-upstream',
  baseUrl: 'https://api.anthropic.com/v1',
  protocol: 'anthropic' as const,
  key: 'upstream-secret',
  proxy: 'http://proxy.example.com:3128',
}

test('非流式 Anthropic Messages 原样保留 body，仅映射模型和上游鉴权头', async () => {
  const responseBody = JSON.stringify({
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    content: [
      { type: 'tool_use', id: 'tool_1', name: 'lookup', input: { city: 'Shanghai' } },
      { type: 'future_block', value: 'preserved by upstream' },
    ],
    usage: { input_tokens: 11, output_tokens: 7, cache_read_input_tokens: 4 },
  })
  const http = new FakeHttp({
    status: 200,
    headers: { 'content-type': 'application/json', 'request-id': 'req_anthropic' },
    data: Readable.from([Buffer.from(responseBody)]),
  })
  const transport = new AnthropicMessagesTransport(http as any)
  const res = new FakeResponse()
  const body = {
    model: 'claude-public',
    max_tokens: 128,
    system: [{ type: 'text', text: 'Be precise.' }],
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    tools: [{ name: 'lookup', input_schema: { type: 'object' } }],
    thinking: { type: 'enabled', budget_tokens: 64 },
    stream: false,
  }

  const result = await transport.forward({
    picked,
    body,
    res: res as any,
    isStream: false,
    startTs: Date.now(),
    requestHeaders: {
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'interleaved-thinking-2025-05-14',
      'user-agent': 'claude-code/test',
      authorization: 'Bearer gateway-secret',
      'x-api-key': 'gateway-secret',
    },
  })

  assert.equal(http.calls[0].url, 'https://api.anthropic.com/v1/messages')
  assert.deepEqual(http.calls[0].body, { ...body, model: 'claude-upstream' })
  assert.equal(http.calls[0].config.headers['x-api-key'], 'upstream-secret')
  assert.equal(http.calls[0].config.headers['anthropic-beta'], 'interleaved-thinking-2025-05-14')
  assert.equal(http.calls[0].config.headers['user-agent'], 'claude-code/test')
  assert.equal(http.calls[0].config.headers.authorization, undefined)
  assert.deepEqual(http.calls[0].config.proxy, {
    protocol: 'http',
    host: 'proxy.example.com',
    port: 3128,
  })
  assert.equal(res.text(), responseBody)
  assert.equal(res.headers['request-id'], 'req_anthropic')
  assert.deepEqual(result, {
    kind: 'success',
    usage: { inputTokens: 11, cachedTokens: 4, outputTokens: 7, totalTokens: 18 },
    firstTokenMs: 0,
  })
})

test('Anthropic SSE 原样透传未知事件、注释和 content block，并提取最终 usage', async () => {
  const chunks = [
    Buffer.from(': keepalive\n'),
    Buffer.from('event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":5}}}\n\n'),
    Buffer.from('event: content_block_delta\nid: evt_1\ndata: {"type":"content_block_delta","delta":{"type":"future_delta","value":"OK"}}\n\n'),
    Buffer.from('event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":3}}\n\n'),
    Buffer.from('event: message_stop\ndata: {"type":"message_stop"}\n\n'),
  ]
  const http = new FakeHttp({
    status: 200,
    headers: { 'content-type': 'text/event-stream', 'request-id': 'req_stream' },
    data: Readable.from(chunks),
  })
  const transport = new AnthropicMessagesTransport(http as any)
  const res = new FakeResponse()
  const result = await transport.forward({
    picked,
    body: { model: 'claude-public', max_tokens: 16, messages: [], stream: true },
    res: res as any,
    isStream: true,
    startTs: Date.now() - 5,
  })

  assert.equal(res.text(), Buffer.concat(chunks).toString('utf8'))
  assert.equal(res.headers['request-id'], 'req_stream')
  assert.equal(res.writableEnded, true)
  assert.equal(result.kind, 'success')
  if (result.kind === 'success') {
    assert.deepEqual(result.usage, { inputTokens: 5, cachedTokens: 0, outputTokens: 3, totalTokens: 8 })
    assert.ok(result.firstTokenMs >= 0)
  }
})

test('Anthropic 上游错误保留状态码、body 和 content type', async () => {
  const errorBody = JSON.stringify({
    type: 'error',
    error: { type: 'rate_limit_error', message: 'slow down' },
    request_id: 'req_error',
  })
  const http = new FakeHttp({
    status: 429,
    headers: { 'content-type': 'application/json' },
    data: Readable.from([Buffer.from(errorBody)]),
  })
  const transport = new AnthropicMessagesTransport(http as any)
  const res = new FakeResponse()
  const result = await transport.forward({
    picked,
    body: { model: 'claude-public', max_tokens: 16, messages: [] },
    res: res as any,
    isStream: false,
    startTs: Date.now(),
  })

  assert.deepEqual(result, {
    kind: 'upstream_error',
    status: 429,
    body: errorBody,
    contentType: 'application/json',
  })
  assert.equal(res.headersSent, false)
})

test('Anthropic 客户端断开被转换为专用取消错误', async () => {
  const res = new FakeResponse()
  const http = {
    post: async (_url: string, _body: any, config: any) =>
      new Promise((_resolve, reject) => {
        config.signal.addEventListener(
          'abort',
          () => reject(new Error('canceled')),
          { once: true },
        )
      }),
  }
  const transport = new AnthropicMessagesTransport(http as any)
  const pending = transport.forward({
    picked,
    body: { model: 'claude-public', max_tokens: 16, messages: [], stream: true },
    res: res as any,
    isStream: true,
    startTs: Date.now(),
  })

  res.emit('close')
  await assert.rejects(pending, RelayClientAbortError)
})
