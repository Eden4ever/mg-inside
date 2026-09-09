import test from 'node:test'
import assert from 'node:assert/strict'
import { calculatePrice, isDeepSeekPeakTime, quoteModelPrice } from '../src/modules/relay/pricing-policy'

const model = {
  pricingMode: 'deepseek_peak_valley',
  inputPrice: 1.5,
  cachePrice: 0.05,
  outputPrice: 4.5,
  peakInputPrice: 3,
  peakCachePrice: 0.1,
  peakOutputPrice: 9,
} as any

function shanghai(iso: string) {
  return new Date(iso)
}

test('DeepSeek 峰谷时段按北京时间边界判断', () => {
  assert.equal(isDeepSeekPeakTime(shanghai('2026-08-19T00:59:00.000Z')), false) // 08:59
  assert.equal(isDeepSeekPeakTime(shanghai('2026-08-19T01:00:00.000Z')), true) // 09:00
  assert.equal(isDeepSeekPeakTime(shanghai('2026-08-19T03:59:00.000Z')), true) // 11:59
  assert.equal(isDeepSeekPeakTime(shanghai('2026-08-19T04:00:00.000Z')), false) // 12:00
  assert.equal(isDeepSeekPeakTime(shanghai('2026-08-19T05:59:00.000Z')), false) // 13:59
  assert.equal(isDeepSeekPeakTime(shanghai('2026-08-19T06:00:00.000Z')), true) // 14:00
  assert.equal(isDeepSeekPeakTime(shanghai('2026-08-19T09:59:00.000Z')), true) // 17:59
  assert.equal(isDeepSeekPeakTime(shanghai('2026-08-19T10:00:00.000Z')), false) // 18:00
})

test('DeepSeek 报价选择峰谷单价并冻结报价时间', () => {
  const peak = quoteModelPrice(model, shanghai('2026-08-19T01:00:00.000Z'))
  assert.deepEqual(
    { tier: peak.tier, input: peak.inputPrice, cache: peak.cachePrice, output: peak.outputPrice },
    { tier: 'peak', input: 3, cache: 0.1, output: 9 },
  )
  assert.equal(peak.quotedAt.toISOString(), '2026-08-19T01:00:00.000Z')
  const offPeak = quoteModelPrice(model, shanghai('2026-08-19T04:00:00.000Z'))
  assert.deepEqual(
    { tier: offPeak.tier, input: offPeak.inputPrice, cache: offPeak.cachePrice, output: offPeak.outputPrice },
    { tier: 'off_peak', input: 1.5, cache: 0.05, output: 4.5 },
  )
})

test('缓存价为 0 时回退到同一时段输入价，价格按百万 token 计算', () => {
  const quote = quoteModelPrice({ ...model, cachePrice: 0, peakCachePrice: 0 } as any, shanghai('2026-08-19T01:00:00.000Z'))
  assert.equal(quote.cachePrice, 3)
  assert.equal(calculatePrice(quote, { inputTokens: 100, cachedTokens: 40, outputTokens: 50 }), 0.00075)
})
