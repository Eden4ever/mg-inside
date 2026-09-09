import { Injectable } from '@nestjs/common'
import { Response } from 'express'
import axios from 'axios'
import { PickedChannel } from './channel-pool.service'
import { buildUpstreamUrl } from '@/common/utils/upstream-protocol.util'
import { parseChannelHeaders, parseChannelProxy } from '@/modules/channel/channel-policy'
import { RelayClientAbortError } from './relay-client-abort.error'

export interface UpstreamPostAdapter {
  post(url: string, body: any, config: any): Promise<any>
}

@Injectable()
export class AxiosUpstreamPostAdapter implements UpstreamPostAdapter {
  post(url: string, body: any, config: any) {
    return axios.post(url, body, config)
  }
}

export interface NativeResponsesUsage {
  inputTokens: number
  cachedTokens?: number
  outputTokens: number
  totalTokens: number
}

export interface NativeResponsesSseTimeouts {
  firstEventMs: number
  idleMs: number
}

// First output can legitimately include model queueing; tool calls may then pause a stream.
export const NATIVE_RESPONSES_SSE_TIMEOUTS: Readonly<NativeResponsesSseTimeouts> = Object.freeze({
  firstEventMs: 120_000,
  idleMs: 120_000,
})

export type NativeResponsesTransportResult =
  | {
      kind: 'success'
      usage: NativeResponsesUsage
      firstTokenMs: number
    }
  | {
      kind: 'upstream_error'
      status: number
      body: string
      contentType: string
    }

@Injectable()
export class NativeResponsesTransport {
  constructor(private readonly http: AxiosUpstreamPostAdapter) {}

  async forward(input: {
    picked: PickedChannel
    body: any
    res: Response
    isStream: boolean
    startTs: number
    requestHeaders?: Record<string, string | string[] | undefined>
    sseTimeouts?: Partial<NativeResponsesSseTimeouts>
  }): Promise<NativeResponsesTransportResult> {
    const { picked, body, res, isStream, startTs, requestHeaders = {} } = input
    const controller = new AbortController()
    const closeHandler = () => {
      if (!res.writableEnded) controller.abort()
    }
    res.once('close', closeHandler)

    const extraHeaders = parseChannelHeaders(picked.headersJson)

    try {
      const upstream = await this.http.post(
        buildUpstreamUrl(picked.baseUrl, '/responses'),
        {
          ...body,
          model: picked.upstreamModel || body.model,
        },
        {
          headers: {
            ...this.forwardClientHeaders(requestHeaders),
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
        isStream ? '' : 'application/json',
      )
      const upstreamRequestId = this.headerValue(upstream.headers, 'x-request-id', '')

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
        let parsed: any
        try {
          parsed = JSON.parse(raw)
        } catch {
          return {
            kind: 'upstream_error',
            status: 502,
            body: JSON.stringify({
              error: {
                type: 'invalid_upstream_response',
                code: 'invalid_upstream_response',
                message: '上游 Responses API 返回了无效 JSON',
              },
            }),
            contentType: 'application/json',
          }
        }
        res.status(200).type(contentType).send(raw)
        return {
          kind: 'success',
          usage: this.extractUsage(parsed?.usage),
          firstTokenMs: 0,
        }
      }

      if (!this.isEventStreamContentType(contentType)) {
        this.stopStream(upstream.data)
        return {
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
        }
      }

      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        ...(upstreamRequestId
          ? { 'X-Request-Id': upstreamRequestId }
          : {}),
      })

      return await this.pipeSse(
        upstream.data,
        res,
        startTs,
        controller.signal,
        this.resolveSseTimeouts(input.sseTimeouts),
      )
    } catch (error) {
      if (error instanceof RelayClientAbortError) throw error
      if (controller.signal.aborted) throw new RelayClientAbortError(error)
      throw error
    } finally {
      res.off('close', closeHandler)
    }
  }

  private forwardClientHeaders(
    requestHeaders: Record<string, string | string[] | undefined>,
  ): Record<string, string> {
    const forwarded: Record<string, string> = {}
    for (const [name, value] of Object.entries(requestHeaders)) {
      const lower = name.toLowerCase()
      if (value === undefined || !this.isForwardableClientHeader(lower)) continue
      forwarded[lower] = Array.isArray(value) ? value.join(', ') : String(value)
    }
    return forwarded
  }

  private isForwardableClientHeader(name: string): boolean {
    if (name === 'authorization' || name === 'x-api-key') return false
    if (name === 'content-length' || name === 'host' || name === 'connection') return false
    return (
      name === 'user-agent' ||
      name === 'accept' ||
      name === 'accept-encoding' ||
      name === 'openai-beta' ||
      name.startsWith('openai-') ||
      name.startsWith('x-stainless-') ||
      name.startsWith('x-client-')
    )
  }

  private pipeSse(
    stream: NodeJS.ReadableStream,
    res: Response,
    startTs: number,
    signal: AbortSignal,
    timeouts: NativeResponsesSseTimeouts,
  ): Promise<NativeResponsesTransportResult> {
    return new Promise((resolve, reject) => {
      let settled = false
      let pending = Buffer.alloc(0)
      let eventData: string[] = []
      let receivedFirstEvent = false
      let watchdog: ReturnType<typeof setTimeout> | undefined
      let usage: NativeResponsesUsage = {
        inputTokens: 0,
        cachedTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      }
      let firstTokenMs = 0

      const inspectEvent = (): boolean => {
        const payload = eventData.join('\n')
        eventData = []
        if (payload === '[DONE]') return true
        if (!payload) return false
        try {
          const event = JSON.parse(payload)
          if (event.type === 'response.completed') {
            if (event.response?.usage) usage = this.extractUsage(event.response.usage)
            return true
          }
          if (event.type === 'response.output_text.delta' && firstTokenMs === 0) {
            firstTokenMs = Date.now() - startTs
          }
        } catch {
          // 非 JSON 数据仍须原样透传；这里只做旁路指标提取。
        }
        return false
      }

      const endResponse = () => {
        if (res.writableEnded || (res as any).destroyed || (res as any).closed) return
        try {
          res.end()
        } catch {
          // 客户端已关闭时，不能让清理动作再触发一次 HTTP 错误响应。
        }
      }

      const cleanup = () => {
        stream.off('data', onData)
        stream.off('end', onEnd)
        stream.off('error', onError)
        stream.off('aborted', onAborted)
        stream.off('close', onClose)
        signal.removeEventListener('abort', onClientAbort)
        if (watchdog) clearTimeout(watchdog)
      }

      const succeed = () => {
        if (settled) return
        settled = true
        cleanup()
        endResponse()
        this.stopStream(stream)
        resolve({ kind: 'success', usage, firstTokenMs })
      }

      const fail = (error: unknown, stopUpstream = false) => {
        if (settled) return
        settled = true
        cleanup()
        endResponse()
        if (stopUpstream) this.stopStream(stream)
        reject(error)
      }

      const resetWatchdog = () => {
        if (watchdog) clearTimeout(watchdog)
        const timeoutMs = receivedFirstEvent ? timeouts.idleMs : timeouts.firstEventMs
        watchdog = setTimeout(() => {
          fail(
            new Error(
              receivedFirstEvent
                ? '上游 Responses SSE 流空闲超时'
                : '上游 Responses SSE 流首个事件超时',
            ),
            true,
          )
        }, timeoutMs)
        watchdog.unref?.()
      }

      const write = (value: Buffer) => {
        if (res.writableEnded || (res as any).destroyed || (res as any).closed) {
          fail(new RelayClientAbortError())
          return false
        }
        try {
          res.write(value)
          return true
        } catch (error) {
          fail(error)
          return false
        }
      }

      const onData = (chunk: Buffer | string) => {
        if (settled || res.writableEnded || (res as any).destroyed || (res as any).closed) return
        const rawChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        if (receivedFirstEvent) resetWatchdog()
        const priorPendingLength = pending.length
        let consumed = 0
        let written = 0
        pending = Buffer.concat([pending, rawChunk])
        let newline: number
        while ((newline = pending.indexOf(0x0a)) >= 0) {
          const rawLine = pending.subarray(0, newline + 1)
          pending = pending.subarray(newline + 1)
          consumed += rawLine.length
          const line = rawLine
            .subarray(0, rawLine.length - 1)
            .toString('utf8')
            .replace(/\r$/, '')

          if (line.startsWith('data:')) {
            const value = line.slice(5)
            eventData.push(value.startsWith(' ') ? value.slice(1) : value)
          }

          const writableLength = Math.max(
            0,
            Math.min(rawChunk.length, consumed - priorPendingLength),
          )
          if (writableLength > written) {
            if (!write(rawChunk.subarray(written, writableLength))) return
            written = writableLength
          }

          if (line === '') {
            const hadEventData = eventData.length > 0
            const terminal = inspectEvent()
            if (hadEventData && !receivedFirstEvent) {
              receivedFirstEvent = true
              resetWatchdog()
            }
            if (terminal) {
              succeed()
              return
            }
          }
        }
        if (written < rawChunk.length) write(rawChunk.subarray(written))
      }
      const interrupted = () => new Error('上游 Responses SSE 流在终止事件前关闭')
      const onEnd = () => {
        if (settled) return
        fail(interrupted())
      }
      const onError = (error: unknown) => fail(error)
      const onAborted = () => fail(interrupted())
      const onClose = () => fail(interrupted())
      const onClientAbort = () => {
        fail(new RelayClientAbortError(), true)
      }

      if (signal.aborted) {
        onClientAbort()
        return
      }
      stream.on('data', onData)
      stream.once('end', onEnd)
      stream.once('error', onError)
      stream.once('aborted', onAborted)
      stream.once('close', onClose)
      signal.addEventListener('abort', onClientAbort, { once: true })
      resetWatchdog()
    })
  }

  private resolveSseTimeouts(
    overrides?: Partial<NativeResponsesSseTimeouts>,
  ): NativeResponsesSseTimeouts {
    const select = (value: unknown, fallback: number) =>
      typeof value === 'number' && Number.isFinite(value) && value > 0
        ? value
        : fallback
    return {
      firstEventMs: select(overrides?.firstEventMs, NATIVE_RESPONSES_SSE_TIMEOUTS.firstEventMs),
      idleMs: select(overrides?.idleMs, NATIVE_RESPONSES_SSE_TIMEOUTS.idleMs),
    }
  }

  private isEventStreamContentType(contentType: string): boolean {
    return /^\s*text\/event-stream(?:\s*;|\s*$)/i.test(contentType)
  }

  private stopStream(stream: NodeJS.ReadableStream | undefined): void {
    const destroy = (stream as any)?.destroy
    if (typeof destroy !== 'function') return
    try {
      destroy.call(stream)
    } catch {
      // 清理上游读取失败不能覆盖已确定的协议结果。
    }
  }

  private extractUsage(usage: any): NativeResponsesUsage {
    const inputTokens = Number(usage?.input_tokens || 0)
    const cachedTokens = Number(usage?.input_tokens_details?.cached_tokens || 0)
    const outputTokens = Number(usage?.output_tokens || 0)
    return {
      inputTokens,
      cachedTokens,
      outputTokens,
      totalTokens: usage?.total_tokens || inputTokens + outputTokens,
    }
  }

  private headerValue(
    headers: Record<string, unknown> | undefined,
    name: string,
    fallback: string,
  ): string {
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
