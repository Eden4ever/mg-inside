import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough, Readable } from 'node:stream'
import {
  NativeResponsesTransport,
  UpstreamPostAdapter,
} from '../src/modules/relay/native-responses-transport'
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

  status(code: number) {
    this.statusCode = code
    return this
  }

  type(value: string) {
    this.headers['Content-Type'] = value
    return this
  }

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

  end() {
    this.writableEnded = true
    return this
  }

  text() {
    return Buffer.concat(this.chunks).toString('utf8')
  }
}

const picked = {
  channelId: 4,
  upstreamModel: 'gpt-upstream',
  baseUrl: 'https://www.cctq.ai/v1',
  protocol: 'responses' as const,
  key: 'upstream-secret',
  proxy: 'https://proxy.example.com:8443',
}

test('非流式 Responses 请求保留原生字段，仅映射上游模型名', async () => {
  const upstreamBody = JSON.stringify({
    id: 'resp_test',
    object: 'response',
    status: 'completed',
    usage: {
      input_tokens: 7,
      input_tokens_details: { cached_tokens: 5 },
      output_tokens: 3,
      total_tokens: 10,
    },
  })
  const http = new FakeHttp({
    status: 200,
    headers: { 'content-type': 'application/json' },
    data: Readable.from([Buffer.from(upstreamBody)]),
  })
  const transport = new NativeResponsesTransport(http as any)
  const res = new FakeResponse()
  const body = {
    model: 'gpt-public',
    input: [{ role: 'user', content: [{ type: 'input_text', text: 'hello' }] }],
    instructions: 'Be precise.',
    tools: [{ type: 'function', name: 'lookup', parameters: { type: 'object' } }],
    reasoning: { effort: 'high', summary: 'auto' },
    previous_response_id: 'resp_previous',
    store: false,
    metadata: { trace: 'native' },
    stream: false,
  }

  const result = await transport.forward({
    picked,
    body,
    res: res as any,
    isStream: false,
    startTs: Date.now(),
    requestHeaders: {
      'user-agent': 'codex_cli/0.147.0',
      'openai-beta': 'responses=experimental',
      authorization: 'Bearer client-token',
    },
  })

  assert.equal(http.calls[0].url, 'https://www.cctq.ai/v1/responses')
  assert.deepEqual(http.calls[0].body, { ...body, model: 'gpt-upstream' })
  assert.equal(http.calls[0].config.headers.Authorization, 'Bearer upstream-secret')
  assert.equal(http.calls[0].config.headers['user-agent'], 'codex_cli/0.147.0')
  assert.equal(http.calls[0].config.headers['openai-beta'], 'responses=experimental')
  assert.equal(http.calls[0].config.headers.authorization, undefined)
  assert.deepEqual(http.calls[0].config.proxy, {
    protocol: 'https',
    host: 'proxy.example.com',
    port: 8443,
  })
  assert.equal(res.text(), upstreamBody)
  assert.deepEqual(result, {
    kind: 'success',
    usage: { inputTokens: 7, cachedTokens: 5, outputTokens: 3, totalTokens: 10 },
    firstTokenMs: 0,
  })
})

test('流式 Responses 原样透传 event、id、data 和注释字节', async () => {
  const chunks = [
    Buffer.from(': keepalive\n'),
    Buffer.from('event: response.output_text.delta\nid: evt_1\nda'),
    Buffer.from('ta: {"type":"response.output_text.delta","delta":"OK"}\n\n'),
    Buffer.from('event: response.completed\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":5,"output_tokens":2,"total_tokens":7}}}\n\n'),
  ]
  const http = new FakeHttp({
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
      'x-request-id': 'upstream-request',
    },
    data: Readable.from(chunks),
  })
  const transport = new NativeResponsesTransport(http as any)
  const res = new FakeResponse()

  const result = await transport.forward({
    picked,
    body: { model: 'gpt-public', input: 'hello', stream: true },
    res: res as any,
    isStream: true,
    startTs: Date.now() - 5,
  })

  assert.equal(res.text(), Buffer.concat(chunks).toString('utf8'))
  assert.equal(res.headers['X-Request-Id'], 'upstream-request')
  assert.equal(res.writableEnded, true)
  assert.equal(result.kind, 'success')
  if (result.kind === 'success') {
    assert.deepEqual(result.usage, {
      inputTokens: 5,
      cachedTokens: 0,
      outputTokens: 2,
      totalTokens: 7,
    })
    assert.ok(result.firstTokenMs >= 0)
  }
})

test('Responses 终止帧写出后不等待上游 keep-alive 关闭，并销毁上游读取', async () => {
  const stream = new PassThrough()
  const http = new FakeHttp({
    status: 200,
    headers: { 'content-type': 'TEXT/EVENT-STREAM; charset=utf-8' },
    data: stream,
  })
  const transport = new NativeResponsesTransport(http as any)
  const res = new FakeResponse()
  const terminal = Buffer.from(
    'event: response.completed\r\nid: evt_complete\r\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":3,"output_tokens":2,"total_tokens":5}}}\r\n\r\n',
  )

  const pending = transport.forward({
    picked,
    body: { model: 'gpt-public', input: 'hello', stream: true },
    res: res as any,
    isStream: true,
    startTs: Date.now(),
  })
  await new Promise<void>((resolve) => setImmediate(resolve))
  stream.write(terminal)

  const result = await Promise.race([
    pending,
    new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('等待了上游 keep-alive')), 100)),
  ])
  assert.equal(res.text(), terminal.toString('utf8'))
  assert.equal(res.writableEnded, true)
  assert.equal((stream as any).destroyed, true)
  assert.deepEqual(result, {
    kind: 'success',
    usage: { inputTokens: 3, cachedTokens: 0, outputTokens: 2, totalTokens: 5 },
    firstTokenMs: 0,
  })
})

test('Responses data [DONE] 仅在完整 SSE 事件边界后终止，且保留所有原始字节', async () => {
  const stream = new PassThrough()
  const http = new FakeHttp({
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
    data: stream,
  })
  const transport = new NativeResponsesTransport(http as any)
  const res = new FakeResponse()
  const chunks = [
    Buffer.from(': ping\r\nevent: response.output_text.delta\r\nid: evt_1\r\nretry: 1200\r\ndata: {"type":"response.output_text.delta","delta":"hel'),
    Buffer.from('lo"}\r\n\r\ndata: [DONE]\r\n\r\n'),
  ]

  const pending = transport.forward({
    picked,
    body: { model: 'gpt-public', input: 'hello', stream: true },
    res: res as any,
    isStream: true,
    startTs: Date.now() - 5,
  })
  await new Promise<void>((resolve) => setImmediate(resolve))
  stream.write(chunks[0])
  assert.equal(res.writableEnded, false)
  stream.write(chunks[1])

  const result = await pending
  assert.equal(res.text(), Buffer.concat(chunks).toString('utf8'))
  assert.equal(result.kind, 'success')
  if (result.kind === 'success') assert.ok(result.firstTokenMs >= 0)
})

test('Responses 不会把普通事件内容中的终止字样误判为完成', async () => {
  const stream = new PassThrough()
  const http = new FakeHttp({
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
    data: stream,
  })
  const transport = new NativeResponsesTransport(http as any)
  const res = new FakeResponse()
  const ordinaryEvent = 'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"response.completed [DONE]"}\n\n'
  const pending = transport.forward({
    picked,
    body: { model: 'gpt-public', input: 'hello', stream: true },
    res: res as any,
    isStream: true,
    startTs: Date.now(),
  })
  await new Promise<void>((resolve) => setImmediate(resolve))
  stream.write(ordinaryEvent)
  assert.equal(res.writableEnded, false)
  stream.destroy()

  await assert.rejects(pending, /终止事件前关闭/)
  assert.equal(res.text(), ordinaryEvent)
})

test('Responses event: response.completed 携带非法 JSON 时不会错误完成', async () => {
  const stream = new PassThrough()
  const http = new FakeHttp({
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
    data: stream,
  })
  const transport = new NativeResponsesTransport(http as any)
  const res = new FakeResponse()
  const invalidCompleted = 'event: response.completed\ndata: not-json\n\n'
  const pending = transport.forward({
    picked,
    body: { model: 'gpt-public', input: 'hello', stream: true },
    res: res as any,
    isStream: true,
    startTs: Date.now(),
    sseTimeouts: { firstEventMs: 50, idleMs: 50 },
  })
  await new Promise<void>((resolve) => setImmediate(resolve))
  stream.write(invalidCompleted)
  assert.equal(res.writableEnded, false)
  stream.destroy()

  await assert.rejects(pending, /终止事件前关闭/)
  assert.equal(res.text(), invalidCompleted)
})

test('Responses 首个完整 SSE 事件超时会销毁无事件上游', async () => {
  const stream = new PassThrough()
  const http = new FakeHttp({
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
    data: stream,
  })
  const transport = new NativeResponsesTransport(http as any)
  const res = new FakeResponse()
  const pending = transport.forward({
    picked,
    body: { model: 'gpt-public', input: 'hello', stream: true },
    res: res as any,
    isStream: true,
    startTs: Date.now(),
    sseTimeouts: { firstEventMs: 10, idleMs: 50 },
  })

  await assert.rejects(pending, /首个事件超时/)
  assert.equal(res.writableEnded, true)
  assert.equal((stream as any).destroyed, true)
})

test('Responses 首个事件之后无上游字节会在空闲超时后结束', async () => {
  const stream = new PassThrough()
  const http = new FakeHttp({
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
    data: stream,
  })
  const transport = new NativeResponsesTransport(http as any)
  const res = new FakeResponse()
  const firstEvent = 'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"first"}\n\n'
  const pending = transport.forward({
    picked,
    body: { model: 'gpt-public', input: 'hello', stream: true },
    res: res as any,
    isStream: true,
    startTs: Date.now(),
    sseTimeouts: { firstEventMs: 50, idleMs: 10 },
  })
  await new Promise<void>((resolve) => setImmediate(resolve))
  stream.write(firstEvent)

  await assert.rejects(pending, /空闲超时/)
  assert.equal(res.text(), firstEvent)
  assert.equal(res.writableEnded, true)
  assert.equal((stream as any).destroyed, true)
})

test('Responses 同一 chunk 的终止帧后续字节不会写给客户端', async () => {
  const stream = new PassThrough()
  const http = new FakeHttp({
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
    data: stream,
  })
  const transport = new NativeResponsesTransport(http as any)
  const res = new FakeResponse()
  const terminal = 'data: [DONE]\n\n'
  const trailing = 'data: {"type":"response.output_text.delta","delta":"must-not-leak"}\n\n'
  const pending = transport.forward({
    picked,
    body: { model: 'gpt-public', input: 'hello', stream: true },
    res: res as any,
    isStream: true,
    startTs: Date.now(),
  })
  await new Promise<void>((resolve) => setImmediate(resolve))
  stream.write(Buffer.from(terminal + trailing))

  await pending
  assert.equal(res.text(), terminal)
  assert.equal(res.writableEnded, true)
})

test('Responses 上游干净关闭但未发送终止事件时作为流中断失败', async () => {
  const stream = new PassThrough()
  const http = new FakeHttp({
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
    data: stream,
  })
  const transport = new NativeResponsesTransport(http as any)
  const res = new FakeResponse()
  const partial = 'data: {"type":"response.output_text.delta","delta":"partial"}\n\n'

  const pending = transport.forward({
    picked,
    body: { model: 'gpt-public', input: 'hello', stream: true },
    res: res as any,
    isStream: true,
    startTs: Date.now(),
  })
  await new Promise<void>((resolve) => setImmediate(resolve))
  stream.end(partial)

  await assert.rejects(pending, /终止事件前关闭/)
  assert.equal(res.text(), partial)
  assert.equal(res.writableEnded, true)
})

test('Responses 上游 destroy 未发送终止事件时不会悬挂', async () => {
  const stream = new PassThrough()
  const http = new FakeHttp({
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
    data: stream,
  })
  const transport = new NativeResponsesTransport(http as any)
  const res = new FakeResponse()
  const pending = transport.forward({
    picked,
    body: { model: 'gpt-public', input: 'hello', stream: true },
    res: res as any,
    isStream: true,
    startTs: Date.now(),
  })
  await new Promise<void>((resolve) => setImmediate(resolve))
  stream.destroy()

  await assert.rejects(pending, /终止事件前关闭/)
  assert.equal(res.writableEnded, true)
})

test('Responses 流式 2xx 非 SSE 响应在写头前返回可重试的上游错误', async () => {
  const http = new FakeHttp({
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    data: Readable.from([Buffer.from('{"not":"sse"}')]),
  })
  const transport = new NativeResponsesTransport(http as any)
  const res = new FakeResponse()

  const result = await transport.forward({
    picked,
    body: { model: 'gpt-public', input: 'hello', stream: true },
    res: res as any,
    isStream: true,
    startTs: Date.now(),
  })

  assert.deepEqual(result, {
    kind: 'upstream_error',
    status: 502,
    body: JSON.stringify({
      error: {
        type: 'invalid_upstream_response',
        code: 'invalid_upstream_response',
        message: '上游 Responses API 未返回 SSE 流',
      },
    }),
    contentType: 'application/json',
  })
  assert.equal(res.headersSent, false)
})

test('Responses 已建流后客户端关闭会中止上游并以专用取消错误结束', async () => {
  const stream = new PassThrough()
  const http = new FakeHttp({
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
    data: stream,
  })
  const transport = new NativeResponsesTransport(http as any)
  const res = new FakeResponse()
  const pending = transport.forward({
    picked,
    body: { model: 'gpt-public', input: 'hello', stream: true },
    res: res as any,
    isStream: true,
    startTs: Date.now(),
  })
  await new Promise<void>((resolve) => setImmediate(resolve))
  res.emit('close')

  await assert.rejects(pending, RelayClientAbortError)
  assert.equal((stream as any).destroyed, true)
})

test('Responses 上游错误保留状态码、响应体与内容类型', async () => {
  const errorBody = JSON.stringify({
    error: { type: 'rate_limit_error', code: 'rate_limit_exceeded', message: 'slow down' },
  })
  const http = new FakeHttp({
    status: 429,
    headers: { 'content-type': 'application/json' },
    data: Readable.from([Buffer.from(errorBody)]),
  })
  const transport = new NativeResponsesTransport(http as any)
  const res = new FakeResponse()

  const result = await transport.forward({
    picked,
    body: { model: 'gpt-public', input: 'hello' },
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

test('Responses 客户端断开被转换为专用取消错误', async () => {
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
  const transport = new NativeResponsesTransport(http as any)
  const pending = transport.forward({
    picked,
    body: { model: 'gpt-public', input: 'hello', stream: true },
    res: res as any,
    isStream: true,
    startTs: Date.now(),
  })

  res.emit('close')
  await assert.rejects(pending, RelayClientAbortError)
})

test('Responses SSE 已写出字节后上游异常只结束当前流，不重复写头或追加错误体', async () => {
  const stream = new PassThrough()
  const http = new FakeHttp({
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
    data: stream,
  })
  const transport = new NativeResponsesTransport(http as any)
  const res = new FakeResponse()

  const pending = transport.forward({
    picked,
    body: { model: 'gpt-public', input: 'hello', stream: true },
    res: res as any,
    isStream: true,
    startTs: Date.now(),
  })

  await new Promise<void>((resolve) => setImmediate(resolve))
  const firstEvent = 'event: response.output_text.delta\\ndata: {"type":"response.output_text.delta","delta":"ok"}\\n\\n'
  stream.write(firstEvent)
  stream.destroy(new Error('upstream stream terminated'))

  await assert.rejects(pending, /upstream stream terminated/)
  assert.equal(res.statusCode, 200)
  assert.equal(res.text(), firstEvent)
  assert.equal(res.writableEnded, true)
})
