import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { ChatCompletionsTransport } from '../src/modules/relay/chat-completions-transport'
import { RelayClientAbortError } from '../src/modules/relay/relay-client-abort.error'

class FakeHttp {
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
  send(value: string) { this.headersSent = true; this.chunks.push(Buffer.from(value)); this.writableEnded = true; return this }
  writeHead(code: number, headers: Record<string, string>) { this.statusCode = code; this.headers = { ...this.headers, ...headers }; this.headersSent = true; return this }
  write(value: Buffer | string) { this.headersSent = true; this.chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(value)); return true }
  end() { this.writableEnded = true; return this }
  text() { return Buffer.concat(this.chunks).toString('utf8') }
}

const picked = {
  channelId: 1,
  upstreamModel: 'upstream-chat',
  baseUrl: 'https://chat.example.com/v1',
  protocol: 'chat' as const,
  key: 'chat-secret',
  proxy: 'http://proxy-user:proxy-pass@proxy.example.com:8080',
}

test('Chat 非流式请求映射模型并在 transport 内降级 developer 角色', async () => {
  const raw = JSON.stringify({
    id: 'chatcmpl_test',
    choices: [{ message: { role: 'assistant', content: 'OK' } }],
    usage: {
      prompt_tokens: 4,
      prompt_tokens_details: { cached_tokens: 3 },
      completion_tokens: 2,
      total_tokens: 6,
    },
  })
  const http = new FakeHttp({
    status: 200,
    headers: { 'content-type': 'application/json' },
    data: Readable.from([Buffer.from(raw)]),
  })
  const transport = new ChatCompletionsTransport(http as any)
  const res = new FakeResponse()
  const result = await transport.forward({
    picked,
    body: {
      model: 'public-chat',
      messages: [{ role: 'developer', content: 'Follow policy.' }],
      stream: false,
    },
    res: res as any,
    isStream: false,
    startTs: Date.now(),
    estimateUsage: true,
  })

  assert.equal(http.calls[0].url, 'https://chat.example.com/v1/chat/completions')
  assert.equal(http.calls[0].body.model, 'upstream-chat')
  assert.deepEqual(http.calls[0].body.messages, [{ role: 'system', content: 'Follow policy.' }])
  assert.deepEqual(http.calls[0].config.proxy, {
    protocol: 'http',
    host: 'proxy.example.com',
    port: 8080,
    auth: { username: 'proxy-user', password: 'proxy-pass' },
  })
  assert.equal(res.text(), raw)
  assert.deepEqual(result, {
    kind: 'success',
    usage: { inputTokens: 4, cachedTokens: 3, outputTokens: 2, totalTokens: 6, estimated: false },
    firstTokenMs: 0,
  })
})

test('Chat 流式响应原样透传并在缺少 usage 时估算输出', async () => {
  const chunks = [
    Buffer.from(': ping\n'),
    Buffer.from('data: {"choices":[{"delta":{"content":"1234"}}]}\n\n'),
    Buffer.from('data: {"choices":[{"delta":{"content":"5678"}}]}\n\ndata: [DONE]\n\n'),
  ]
  const http = new FakeHttp({
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
    data: Readable.from(chunks),
  })
  const transport = new ChatCompletionsTransport(http as any)
  const res = new FakeResponse()
  const result = await transport.forward({
    picked,
    body: { model: 'public-chat', messages: [], stream: true },
    res: res as any,
    isStream: true,
    startTs: Date.now() - 5,
    estimateUsage: true,
  })

  assert.equal(res.text(), Buffer.concat(chunks).toString('utf8'))
  assert.equal(result.kind, 'success')
  if (result.kind === 'success') {
    assert.deepEqual(result.usage, {
      inputTokens: 0,
      cachedTokens: 0,
      outputTokens: 2,
      totalTokens: 2,
      estimated: true,
    })
  }
})

test('Chat 上游错误作为结果返回供编排层重试', async () => {
  const raw = JSON.stringify({ error: { message: 'bad request', type: 'invalid_request_error' } })
  const http = new FakeHttp({
    status: 400,
    headers: { 'content-type': 'application/json' },
    data: Readable.from([Buffer.from(raw)]),
  })
  const transport = new ChatCompletionsTransport(http as any)
  const res = new FakeResponse()
  const result = await transport.forward({
    picked,
    body: { model: 'public-chat', messages: [] },
    res: res as any,
    isStream: false,
    startTs: Date.now(),
    estimateUsage: true,
  })

  assert.deepEqual(result, {
    kind: 'upstream_error',
    status: 400,
    body: raw,
    contentType: 'application/json',
  })
  assert.equal(res.headersSent, false)
})

test('Chat 客户端断开被转换为专用取消错误', async () => {
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
  const transport = new ChatCompletionsTransport(http as any)
  const pending = transport.forward({
    picked,
    body: { model: 'public-chat', messages: [], stream: true },
    res: res as any,
    isStream: true,
    startTs: Date.now(),
    estimateUsage: true,
  })

  res.emit('close')
  await assert.rejects(pending, RelayClientAbortError)
})
