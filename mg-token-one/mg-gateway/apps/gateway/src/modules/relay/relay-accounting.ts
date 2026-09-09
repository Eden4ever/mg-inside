import { Injectable, Logger } from '@nestjs/common'
import { nanoid } from 'nanoid'
import { GatewayTokenInfo } from '@/common/middleware/token-auth.middleware'
import { RelayProtocol } from '@/common/utils/upstream-protocol.util'
import { ModelConfig } from '@/entities/model-config.entity'
import { PickedChannel } from './channel-pool.service'
import { LogService } from './log.service'
import { QuotaService } from './quota.service'
import { calculatePrice, PriceQuote, quoteModelPrice } from './pricing-policy'

export interface RelayAccountingContext {
  readonly protocol: RelayProtocol
  readonly requestId: string
  readonly startTs: number
  readonly clientIp: string | null
  readonly info: GatewayTokenInfo
  readonly model: string
}

interface AccountingState {
  modelConfig: ModelConfig | null
  quote: PriceQuote | null
  estimatedCost: number
  reserved: boolean
  finalized: boolean
}

interface RelayCompletion {
  picked: PickedChannel
  inputTokens: number
  cachedTokens?: number
  outputTokens: number
  totalTokens: number
  isStream: boolean
  usageEstimated: boolean
  firstTokenMs: number
  retryCount: number
}

interface RelayFailure {
  code: string
  message: string
  responseStatus?: number
  picked?: PickedChannel | null
  isStream?: boolean
  retryCount?: number
  partial?: boolean
}

@Injectable()
export class RelayAccounting {
  private readonly logger = new Logger(RelayAccounting.name)
  private readonly states = new WeakMap<RelayAccountingContext, AccountingState>()

  constructor(
    private readonly quota: QuotaService,
    private readonly log: LogService,
  ) {}

  begin(input: {
    protocol: RelayProtocol
    info: GatewayTokenInfo
    model?: unknown
    clientIp: string | null
  }): RelayAccountingContext {
    const model = typeof input.model === 'string' && input.model.trim()
      ? input.model.trim()
      : 'unknown'
    const context: RelayAccountingContext = {
      protocol: input.protocol,
      info: input.info,
      model,
      clientIp: input.clientIp,
      requestId: nanoid(),
      startTs: Date.now(),
    }
    this.states.set(context, {
      modelConfig: null,
      quote: null,
      estimatedCost: 0,
      reserved: false,
      finalized: false,
    })
    return context
  }

  async reserve(
    context: RelayAccountingContext,
    modelConfig: ModelConfig,
    maxOutputTokens: number,
  ): Promise<boolean> {
    const state = this.stateFor(context)
    state.modelConfig = modelConfig
    state.quote = quoteModelPrice(modelConfig, new Date())
    state.estimatedCost = this.estimateCost(state.quote, maxOutputTokens)
    const allowed = await this.quota.preCheck(context.info, state.estimatedCost)
    state.reserved = allowed
    return allowed
  }

  async succeed(context: RelayAccountingContext, completion: RelayCompletion) {
    const state = this.finalize(context)
    if (!state) return
    const quote = state.quote
    const cachedTokens = Math.min(
      Math.max(0, completion.cachedTokens || 0),
      Math.max(0, completion.inputTokens || 0),
    )
    const costYuan = quote
      ? calculatePrice(quote, {
          inputTokens: completion.inputTokens,
          cachedTokens,
          outputTokens: completion.outputTokens,
        })
      : 0
    const quotaCost = Math.round(costYuan * 1e6) / 1e6
    if (state.reserved) {
      await this.runSafely(
        '成功请求额度结算失败',
        () => this.quota.settle(context.info, quotaCost, state.estimatedCost),
      )
    }
    await this.runSafely(
      '令牌使用时间更新失败',
      () => this.quota.touchToken(context.info.tokenId),
    )
    this.log.record({
      ...this.baseLog(context, completion),
      status: 1,
      promptTokens: completion.inputTokens,
      cachedTokens,
      completionTokens: completion.outputTokens,
      totalTokens: completion.totalTokens,
      quotaCost,
      costYuan: quotaCost,
      pricingTier: quote?.tier || 'fixed',
      appliedInputPrice: quote?.inputPrice || 0,
      appliedCachePrice: quote?.cachePrice || 0,
      appliedOutputPrice: quote?.outputPrice || 0,
      usageEstimated: completion.usageEstimated ? 1 : 0,
      partial: 0,
    })
  }

  async fail(context: RelayAccountingContext, failure: RelayFailure) {
    const state = this.finalize(context)
    if (!state) return
    if (state.reserved) {
      await this.runSafely(
        '失败请求额度回滚失败',
        () => this.quota.settle(context.info, 0, state.estimatedCost),
      )
    }
    await this.runSafely(
      '令牌使用时间更新失败',
      () => this.quota.touchToken(context.info.tokenId),
    )
    this.log.record({
      ...this.baseLog(context, failure, state.quote),
      status: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      quotaCost: 0,
      costYuan: 0,
      usageEstimated: 0,
      partial: failure.partial ? 1 : 0,
      errorCode: failure.code,
      responseStatus: this.failureResponseStatus(failure),
      errorMessage: this.errorSummary(failure.code, failure.message),
    })
  }

  private baseLog(
    context: RelayAccountingContext,
    result: Pick<RelayCompletion, 'picked' | 'isStream' | 'firstTokenMs' | 'retryCount'> |
      RelayFailure,
    quote: PriceQuote | null = null,
  ) {
    const picked = result.picked || null
    return {
      requestId: context.requestId,
      protocol: context.protocol,
      userId: context.info.userId,
      tokenId: context.info.tokenId,
      model: context.model,
      upstreamModel: picked?.upstreamModel || null,
      channelId: picked?.channelId || null,
      department: context.info.userDepartment || null,
      isStream: result.isStream ? 1 : 0,
      latencyMs: Date.now() - context.startTs,
      firstTokenMs: 'firstTokenMs' in result ? result.firstTokenMs : 0,
      retryCount: result.retryCount || 0,
      pricingTier: quote?.tier || 'fixed',
      appliedInputPrice: quote?.inputPrice || 0,
      appliedCachePrice: quote?.cachePrice || 0,
      appliedOutputPrice: quote?.outputPrice || 0,
      clientIp: context.clientIp,
      createdAt: new Date(),
    }
  }

  private stateFor(context: RelayAccountingContext): AccountingState {
    const state = this.states.get(context)
    if (!state) throw new Error('未知的 RelayAccountingContext')
    if (state.finalized) throw new Error('请求已经完成结算')
    return state
  }

  private finalize(context: RelayAccountingContext): AccountingState | null {
    const state = this.states.get(context)
    if (!state || state.finalized) return null
    state.finalized = true
    return state
  }

  private estimateCost(quote: PriceQuote, maxOutputTokens: number): number {
    const safeMaxOutput = Number.isFinite(Number(maxOutputTokens))
      ? Math.max(0, Number(maxOutputTokens))
      : 0
    const cost = (
      256 * quote.inputPrice +
      safeMaxOutput * quote.outputPrice
    ) / 1_000_000
    return Math.round(cost * 1e6) / 1e6
  }

  private errorSummary(code: string, message: string): string {
    const summary = `${code}: ${message || '请求失败'}`
    return summary.length > 2000 ? `${summary.slice(0, 1997)}...` : summary
  }

  private failureResponseStatus(failure: RelayFailure): number | null {
    if (Number.isInteger(failure.responseStatus) && failure.responseStatus! >= 100) {
      return failure.responseStatus!
    }
    const known: Record<string, number> = {
      invalid_request_error: 400,
      vision_not_supported: 400,
      responses_not_supported: 400,
      anthropic_not_supported: 400,
      forbidden: 403,
      model_not_found: 404,
      quota_exceeded: 429,
      no_channel: 503,
      no_responses_channel: 503,
      no_anthropic_channel: 529,
      upstream_error: 502,
    }
    return known[failure.code] || null
  }

  private async runSafely(label: string, action: () => Promise<unknown>) {
    try {
      await action()
    } catch (error) {
      this.logger.error(`${label}: ${error?.message || error}`)
    }
  }
}
