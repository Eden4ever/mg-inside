import { Inject, Injectable, Logger } from '@nestjs/common'
import { AppConfig } from '@/config/configuration'
import { RelayProtocol } from '@/common/utils/upstream-protocol.util'
import { ChannelPoolService, PickedChannel } from './channel-pool.service'
import { classifyUpstreamFailure } from './relay-retry-policy'
import { isRelayClientAbortError } from './relay-client-abort.error'

export interface RelayTransportUsage {
  inputTokens: number
  cachedTokens?: number
  outputTokens: number
  totalTokens: number
  estimated?: boolean
}

export type RelayTransportResult =
  | {
      kind: 'success'
      usage: RelayTransportUsage
      firstTokenMs: number
    }
  | {
      kind: 'upstream_error'
      status: number
      body: string
      contentType: string
      requestId?: string
    }

export type RelayExecutionResult =
  | {
      kind: 'success'
      picked: PickedChannel
      attempt: number
      result: Extract<RelayTransportResult, { kind: 'success' }>
    }
  | {
      kind: 'no_channel'
      attempt: number
    }
  | {
      kind: 'upstream_error'
      picked: PickedChannel
      attempt: number
      result: Extract<RelayTransportResult, { kind: 'upstream_error' }>
    }
  | {
      kind: 'transport_error'
      picked: PickedChannel
      attempt: number
      error: unknown
    }
  | {
      kind: 'client_abort'
      picked: PickedChannel
      attempt: number
      error: unknown
    }

/**
 * Owns channel selection, retries and health transitions for every relay protocol.
 * Protocol adapters remain responsible for request/response wire semantics.
 */
@Injectable()
export class RelayExecutor {
  private readonly logger = new Logger(RelayExecutor.name)

  constructor(
    private readonly pool: ChannelPoolService,
    @Inject('APP_CONFIG') private readonly config: AppConfig,
  ) {}

  async execute(input: {
    protocol: RelayProtocol
    model: string
    forward: (picked: PickedChannel) => Promise<RelayTransportResult>
    canRetry?: () => boolean
  }): Promise<RelayExecutionResult> {
    const attemptedChannelIds = new Set<number>()
    const failedChannelIds = new Set<number>()
    for (let attempt = 0; attempt < this.config.relay.maxTries; attempt++) {
      const picked = this.pool.pick(input.model, input.protocol, attemptedChannelIds)
      if (!picked) return { kind: 'no_channel', attempt }
      attemptedChannelIds.add(picked.channelId)

      try {
        const result = await input.forward(picked)
        if (result.kind === 'success') {
          void this.pool.recordSuccess(picked.channelId, input.model, input.protocol).catch((error) => {
            this.logger.error(
              `渠道 ${picked.channelId} 成功状态持久化失败: ${error?.message || error}`,
            )
          })
          return { kind: 'success', picked, attempt, result }
        }

        const decision = classifyUpstreamFailure(result.status)
        if (decision.recordChannelFailure && !failedChannelIds.has(picked.channelId)) {
          failedChannelIds.add(picked.channelId)
          await this.recordFailureSafely(picked.channelId, input.model, input.protocol)
        }
        if (!decision.retry) {
          return { kind: 'upstream_error', picked, attempt, result }
        }
        if (input.canRetry && !input.canRetry()) {
          return { kind: 'upstream_error', picked, attempt, result }
        }
        if (attempt === this.config.relay.maxTries - 1) {
          return { kind: 'upstream_error', picked, attempt, result }
        }
      } catch (error) {
        if (isRelayClientAbortError(error)) {
          return { kind: 'client_abort', picked, attempt, error }
        }
        if (!failedChannelIds.has(picked.channelId)) {
          failedChannelIds.add(picked.channelId)
          await this.recordFailureSafely(picked.channelId, input.model, input.protocol)
        }
        if (input.canRetry && !input.canRetry()) {
          return { kind: 'transport_error', picked, attempt, error }
        }
        if (attempt === this.config.relay.maxTries - 1) {
          return { kind: 'transport_error', picked, attempt, error }
        }
      }
    }

    // AppConfig validation guarantees maxTries >= 1.
    return { kind: 'no_channel', attempt: 0 }
  }

  private async recordFailureSafely(channelId: number, model: string, protocol: RelayProtocol) {
    try {
      await this.pool.recordFailure(channelId, model, protocol)
    } catch (error) {
      this.logger.error(
        `渠道 ${channelId} 失败状态持久化失败: ${error?.message || error}`,
      )
    }
  }
}
