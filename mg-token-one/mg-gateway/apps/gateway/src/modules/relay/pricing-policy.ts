import { ModelConfig } from '@/entities/model-config.entity'

export const PRICING_MODES = ['fixed', 'deepseek_peak_valley'] as const
export type PricingMode = (typeof PRICING_MODES)[number]
export type PricingTier = 'fixed' | 'off_peak' | 'peak'

export interface PriceQuote {
  mode: PricingMode
  tier: PricingTier
  inputPrice: number
  cachePrice: number
  outputPrice: number
  quotedAt: Date
}

export function normalizePricingMode(value: unknown, fallback: PricingMode = 'fixed'): PricingMode {
  const mode = value === undefined || value === null || value === '' ? fallback : String(value)
  if (!PRICING_MODES.includes(mode as PricingMode)) {
    throw new Error('计价模式必须是 fixed 或 deepseek_peak_valley')
  }
  return mode as PricingMode
}

export function normalizePrice(value: unknown, fallback = 0): number {
  const price = value === undefined || value === null || value === '' ? fallback : Number(value)
  if (!Number.isFinite(price) || price < 0) throw new Error('价格必须是非负数字')
  return price
}

export function isDeepSeekPeakTime(at: Date): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)
  const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value || 0)
  const minuteOfDay = hour * 60 + minute
  return (
    (minuteOfDay >= 9 * 60 && minuteOfDay < 12 * 60) ||
    (minuteOfDay >= 14 * 60 && minuteOfDay < 18 * 60)
  )
}

export function quoteModelPrice(model: ModelConfig, at: Date): PriceQuote {
  const mode = normalizePricingMode(model.pricingMode)
  const peak = mode === 'deepseek_peak_valley' && isDeepSeekPeakTime(at)
  const inputPrice = peak ? model.peakInputPrice : model.inputPrice
  const configuredCachePrice = peak ? model.peakCachePrice : model.cachePrice
  const outputPrice = peak ? model.peakOutputPrice : model.outputPrice
  return {
    mode,
    tier: mode === 'fixed' ? 'fixed' : peak ? 'peak' : 'off_peak',
    inputPrice: normalizePrice(inputPrice),
    cachePrice: normalizePrice(configuredCachePrice) || normalizePrice(inputPrice),
    outputPrice: normalizePrice(outputPrice),
    quotedAt: new Date(at),
  }
}

export function calculatePrice(
  quote: Pick<PriceQuote, 'inputPrice' | 'cachePrice' | 'outputPrice'>,
  usage: { inputTokens: number; cachedTokens?: number; outputTokens: number },
): number {
  const inputTokens = Math.max(0, Number(usage.inputTokens) || 0)
  const cachedTokens = Math.min(
    Math.max(0, Number(usage.cachedTokens) || 0),
    inputTokens,
  )
  const uncachedInputTokens = inputTokens - cachedTokens
  return (
    uncachedInputTokens * quote.inputPrice +
    cachedTokens * quote.cachePrice +
    Math.max(0, Number(usage.outputTokens) || 0) * quote.outputPrice
  ) / 1_000_000
}
