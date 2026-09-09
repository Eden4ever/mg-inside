import { Injectable } from '@nestjs/common'
import { Response } from 'express'
import { AxiosUpstreamPostAdapter } from './native-responses-transport'
import { PickedChannel } from './channel-pool.service'
import { buildUpstreamUrl } from '@/common/utils/upstream-protocol.util'
import { parseChannelHeaders, parseChannelProxy } from '@/modules/channel/channel-policy'
import { RelayClientAbortError } from './relay-client-abort.error'

export interface ChatCompletionsUsage {
  inputTokens: number
  cachedTokens?: number
  outputTokens: number
  totalTokens: number
  estimated: boolean
}

export type ChatCompletionsTransportResult =
  | { kind: 'success'; usage: ChatCompletionsUsage; firstTokenMs: number }
  | { kind: 'upstream_error'; status: number; body: string; contentType: string }

@Injectable()
export class ChatCompletionsTransport {
  constructor(private readonly http: AxiosUpstreamPostAdapter) {}

  async forward(input: {
    picked: PickedChannel
    body: any
    res: Response
    isStream: boolean
    startTs: number
    estimateUsage: boolean
  }): Promise<ChatCompletionsTransportResult> {
    const { picked, body, res, isStream, startTs, estimateUsage } = input
    const controller = new AbortController()
    const closeHandler = () => {
      if (!res.writableEnded) controller.abort()
    }
    res.once('close', closeHandler)
    const extraHeaders = parseChannelHeaders(picked.headersJson)
    try {
      const upstream = await this.http.post(
        buildUpstreamUrl(picked.baseUrl, '/chat/completions'),
        {
          ...body,
          model: picked.upstreamModel || body.model,
          messages: this.normalizeRoles(body.messages),
          stream: isStream,
          stream_options: isStream ? { include_usage: true } : undefined,
        },
        {
          headers: {
            ...extraHeaders,
            Authorization: `Bearer ${picked.key}`,
            'Content-Type': 'application/json',
          },
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
      if (upstream.status < 200 || upstream.status >= 300) {
        return {
          kind: 'upstream_error',
          status: upstream.status,
          body: await this.readStream(upstream.data),
          contentType,
        }
      }
      if (!isStream) {
        const raw = await this.readStream(upstream.data)
        let json: any
        try { json = JSON.parse(raw) } catch {
          return {
            kind: 'upstream_error',
            status: 502,
            body: JSON.stringify({ error: { type: 'invalid_upstream_response', message: '上游 Chat API 返回了无效 JSON' } }),
            contentType: 'application/json',
          }
        }
        if (json?.error) {
          return { kind: 'upstream_error', status: 502, body: raw, contentType }
        }
        res.status(200).type(contentType).send(raw)
        return { kind: 'success', usage: this.chatUsage(json?.usage), firstTokenMs: 0 }
      }
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })
      return await this.pipeSse(upstream.data, res, startTs, estimateUsage)
    } catch (error) {
      if (controller.signal.aborted) throw new RelayClientAbortError(error)
      throw error
    } finally {
      res.off('close', closeHandler)
    }
  }

  private pipeSse(
    stream: NodeJS.ReadableStream,
    res: Response,
    startTs: number,
    estimateUsage: boolean,
  ): Promise<ChatCompletionsTransportResult> {
    return new Promise((resolve, reject) => {
      let buffer = ''
      let completionTextLength = 0
      let firstTokenMs = 0
      let usage = this.chatUsage(null)
      const inspect = (payload: string) => {
        if (!payload || payload === '[DONE]') return
        try {
          const event = JSON.parse(payload)
          const delta = event.choices?.[0]?.delta?.content
          if (delta) {
            completionTextLength += String(delta).length
            if (!firstTokenMs) firstTokenMs = Date.now() - startTs
          }
          if (event.usage) usage = this.chatUsage(event.usage)
        } catch { /* raw SSE remains authoritative */ }
      }
      stream.on('data', (chunk: Buffer) => {
        if (res.writableEnded) return
        res.write(chunk)
        buffer += chunk.toString('utf8')
        let newline: number
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline).replace(/\r$/, '')
          buffer = buffer.slice(newline + 1)
          if (line.startsWith('data:')) inspect(line.slice(5).trimStart())
        }
      })
      stream.on('end', () => {
        if (buffer.startsWith('data:')) inspect(buffer.slice(5).trimStart())
        if (!usage.totalTokens && estimateUsage) {
          usage = {
            inputTokens: usage.inputTokens,
            cachedTokens: usage.cachedTokens,
            outputTokens: Math.ceil(completionTextLength / 4),
            totalTokens: usage.inputTokens + Math.ceil(completionTextLength / 4),
            estimated: true,
          }
        }
        if (!res.writableEnded) res.end()
        resolve({ kind: 'success', usage, firstTokenMs })
      })
      stream.on('error', reject)
    })
  }

  private chatUsage(usage: any): ChatCompletionsUsage {
    const inputTokens = Number(usage?.prompt_tokens || 0)
    const cachedTokens = Number(usage?.prompt_tokens_details?.cached_tokens || 0)
    const outputTokens = Number(usage?.completion_tokens || 0)
    return {
      inputTokens,
      cachedTokens,
      outputTokens,
      totalTokens: usage?.total_tokens || inputTokens + outputTokens,
      estimated: false,
    }
  }

  private normalizeRoles(messages: any): any {
    if (!Array.isArray(messages)) return messages
    return messages.map((message: any) =>
      message?.role === 'developer' ? { ...message, role: 'system' } : message,
    )
  }

  private headerValue(headers: Record<string, unknown> | undefined, name: string, fallback: string): string {
    const value = headers?.[name]
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
