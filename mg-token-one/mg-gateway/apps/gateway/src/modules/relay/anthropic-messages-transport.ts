import { Injectable } from '@nestjs/common'
import { Response } from 'express'
import { PickedChannel } from './channel-pool.service'
import { AxiosUpstreamPostAdapter } from './native-responses-transport'
export type { UpstreamPostAdapter } from './native-responses-transport'
import { buildUpstreamUrl } from '@/common/utils/upstream-protocol.util'
import { parseChannelHeaders, parseChannelProxy } from '@/modules/channel/channel-policy'
import { RelayClientAbortError } from './relay-client-abort.error'

export interface AnthropicMessagesUsage {
  inputTokens: number
  cachedTokens?: number
  outputTokens: number
  totalTokens: number
}

export type AnthropicMessagesTransportResult =
  | {
      kind: 'success'
      usage: AnthropicMessagesUsage
      firstTokenMs: number
    }
  | {
      kind: 'upstream_error'
      status: number
      body: string
      contentType: string
      requestId?: string
    }

/**
 * Anthropic Messages 的原生传输适配器。
 * 外部接口只关心一份请求体和一份响应流；协议字段、未知 content block 与 SSE 字节均由实现隐藏。
 */
@Injectable()
export class AnthropicMessagesTransport {
  constructor(private readonly http: AxiosUpstreamPostAdapter) {}

  async forward(input: {
    picked: PickedChannel
    body: any
    res: Response
    isStream: boolean
    startTs: number
    requestHeaders?: Record<string, string | string[] | undefined>
  }): Promise<AnthropicMessagesTransportResult> {
    const { picked, body, res, isStream, startTs, requestHeaders = {} } = input
    const controller = new AbortController()
    const closeHandler = () => {
      if (!res.writableEnded) controller.abort()
    }
    res.once('close', closeHandler)

    try {
      const upstream = await this.http.post(
        buildUpstreamUrl(picked.baseUrl, '/messages'),
        {
          ...body,
          model: picked.upstreamModel || body.model,
        },
        {
          headers: this.buildHeaders(picked, requestHeaders),
          responseType: 'stream',
          proxy: parseChannelProxy(picked.proxy),
          timeout: 3_600_000,
          validateStatus: () => true,
          signal: controller.signal,
        },
      )
      const contentType = this.headerValue(
        upstream.headers,
        'content-type',
        isStream ? 'text/event-stream' : 'application/json',
      )
      const upstreamRequestId = this.headerValue(
        upstream.headers,
        'request-id',
        this.headerValue(upstream.headers, 'x-request-id', ''),
      )

      if (upstream.status < 200 || upstream.status >= 300) {
        return {
          kind: 'upstream_error',
          status: upstream.status,
          body: await this.readStream(upstream.data),
          contentType,
          ...(upstreamRequestId ? { requestId: upstreamRequestId } : {}),
        }
      }

      if (!isStream) {
        const raw = await this.readStream(upstream.data)
        let parsed: any
        try {
          parsed = JSON.parse(raw)
        } catch {
          return {
            kind: 'upstream_error',
            status: 502,
            body: JSON.stringify({
              type: 'error',
              error: {
                type: 'api_error',
                message: '上游 Anthropic API 返回了无效 JSON',
              },
            }),
            contentType: 'application/json',
            ...(upstreamRequestId ? { requestId: upstreamRequestId } : {}),
          }
        }
        if (parsed?.type === 'error' || parsed?.error) {
          return {
            kind: 'upstream_error',
            status: 502,
            body: raw,
            contentType,
            ...(upstreamRequestId ? { requestId: upstreamRequestId } : {}),
          }
        }
        if (upstreamRequestId) res.setHeader('request-id', upstreamRequestId)
        res.status(200).type(contentType).send(raw)
        return {
          kind: 'success',
          usage: this.extractUsage(parsed?.usage),
          firstTokenMs: 0,
        }
      }

      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        ...(upstreamRequestId ? { 'request-id': upstreamRequestId } : {}),
      })
      return await this.pipeSse(upstream.data, res, startTs)
    } catch (error) {
      if (controller.signal.aborted) throw new RelayClientAbortError(error)
      throw error
    } finally {
      res.off('close', closeHandler)
    }
  }

  private buildHeaders(
    picked: PickedChannel,
    requestHeaders: Record<string, string | string[] | undefined>,
  ): Record<string, string> {
    const forwarded: Record<string, string> = {}
    for (const [name, value] of Object.entries(requestHeaders)) {
      const lower = name.toLowerCase()
      if (!this.isForwardableHeader(lower) || value === undefined) continue
      forwarded[lower] = Array.isArray(value) ? value.join(', ') : String(value)
    }

    const custom = parseChannelHeaders(picked.headersJson)

    return {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      ...forwarded,
      ...custom,
      // 上游密钥必须来自渠道，不能被客户端或自定义头覆盖。
      'x-api-key': picked.key,
    }
  }

  private isForwardableHeader(name: string): boolean {
    if (name === 'authorization' || name === 'x-api-key') return false
    if (name === 'content-length' || name === 'host' || name === 'connection') return false
    return (
      name === 'anthropic-version' ||
      name === 'anthropic-beta' ||
      name === 'anthropic-dangerous-direct-browser-access' ||
      name === 'user-agent' ||
      name === 'x-app' ||
      name.startsWith('x-stainless-')
    )
  }

  private pipeSse(
    stream: NodeJS.ReadableStream,
    res: Response,
    startTs: number,
  ): Promise<AnthropicMessagesTransportResult> {
    return new Promise((resolve, reject) => {
      let buffer = ''
      let firstTokenMs = 0
      let usage: AnthropicMessagesUsage = {
        inputTokens: 0,
        cachedTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      }
      let streamError: string | null = null

      const inspect = (eventName: string, payload: string) => {
        if (!payload || payload === '[DONE]') return
        try {
          const event = JSON.parse(payload)
          if (eventName === 'error' || event.type === 'error') {
            streamError = payload
            return
          }
          if (event.type === 'message_start' && event.message?.usage) {
            usage = this.extractUsage(event.message.usage)
          } else if (event.type === 'message_delta' && event.usage) {
            usage = this.mergeUsage(usage, event.usage)
          }
          if (
            event.type === 'content_block_delta' &&
            firstTokenMs === 0
          ) {
            firstTokenMs = Date.now() - startTs
          }
        } catch {
          // 原始 SSE 仍是权威响应；旁路指标解析失败不能破坏客户端字节流。
        }
      }

      const consume = (line: string) => {
        if (line.startsWith('event:')) {
          currentEvent = line.slice(6).trim()
        } else if (line.startsWith('data:')) {
          inspect(currentEvent, line.slice(5).trimStart())
        }
      }
      let currentEvent = ''

      stream.on('data', (chunk: Buffer) => {
        if (res.writableEnded) return
        res.write(chunk)
        buffer += chunk.toString('utf8')
        let newline: number
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline).replace(/\r$/, '')
          buffer = buffer.slice(newline + 1)
          consume(line)
        }
      })
      stream.on('end', () => {
        if (buffer) consume(buffer.replace(/\r$/, ''))
        if (!res.writableEnded) res.end()
        if (streamError) {
          resolve({
            kind: 'upstream_error',
            status: 502,
            body: streamError,
            contentType: 'text/event-stream',
          })
          return
        }
        resolve({ kind: 'success', usage, firstTokenMs })
      })
      stream.on('error', reject)
    })
  }

  private extractUsage(usage: any): AnthropicMessagesUsage {
    const inputTokens = Number(usage?.input_tokens || 0)
    const cachedTokens = Number(usage?.cache_read_input_tokens || 0)
    const outputTokens = Number(usage?.output_tokens || 0)
    return {
      inputTokens,
      cachedTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    }
  }

  private mergeUsage(
    previous: AnthropicMessagesUsage,
    usage: any,
  ): AnthropicMessagesUsage {
    const next = this.extractUsage(usage)
    return {
      inputTokens: next.inputTokens || previous.inputTokens,
      cachedTokens: next.cachedTokens || previous.cachedTokens,
      outputTokens: next.outputTokens || previous.outputTokens,
      totalTokens: (next.inputTokens || previous.inputTokens) +
        (next.outputTokens || previous.outputTokens),
    }
  }

  private headerValue(
    headers: Record<string, unknown> | undefined,
    name: string,
    fallback: string,
  ): string {
    const lowerName = name.toLowerCase()
    const entry = Object.entries(headers || {}).find(([key]) => key.toLowerCase() === lowerName)
    const value = entry?.[1]
    if (Array.isArray(value)) return value.map(String).join(', ')
    if (typeof value === 'string' || typeof value === 'number') return String(value)
    return fallback
  }

  private async readStream(stream: AsyncIterable<any>): Promise<string> {
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(Buffer.from(chunk))
    return Buffer.concat(chunks).toString('utf8')
  }
}
