import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDeepSeekBalanceSnapshot,
  classifyDeepSeekBalanceError,
} from '../src/modules/deepseek-account/deepseek-account.policy'

test('DeepSeek 余额优先映射 CNY 并换算为分', () => {
  const snapshot = buildDeepSeekBalanceSnapshot({
    is_available: true,
    balance_infos: [
      { currency: 'USD', total_balance: '12.34' },
      { currency: 'CNY', total_balance: '56.789' },
    ],
  })

  assert.equal(snapshot.quotaAvailableRaw, 5679)
  assert.equal(snapshot.quotaDisplayType, 'CNY')
  assert.equal(snapshot.quotaPerUnit, 100)
  assert.equal(snapshot.billingPreference, 'available')
})

test('DeepSeek 余额在没有 CNY 时保留上游币种', () => {
  const snapshot = buildDeepSeekBalanceSnapshot({
    is_available: false,
    balance_infos: [{ currency: 'USD', total_balance: 8.5 }],
  })

  assert.equal(snapshot.quotaAvailableRaw, 850)
  assert.equal(snapshot.quotaDisplayType, 'USD')
  assert.equal(snapshot.billingPreference, 'unavailable')
})

test('DeepSeek 非法余额响应不会静默映射为零', () => {
  assert.throws(
    () => buildDeepSeekBalanceSnapshot({ balance_infos: [] }),
    /余额响应格式无效/,
  )
  assert.throws(
    () => buildDeepSeekBalanceSnapshot({
      balance_infos: [{ currency: 'CNY', total_balance: 'invalid' }],
    }),
    /余额响应格式无效/,
  )
})

test('DeepSeek 余额错误按鉴权、限流、上游和超时分类', () => {
  assert.deepEqual(classifyDeepSeekBalanceError({ response: { status: 401 } }), {
    code: 'credential_invalid',
    message: 'DeepSeek API Key 无效或无余额查询权限',
    credentialInvalid: true,
  })
  assert.equal(classifyDeepSeekBalanceError({ response: { status: 403 } }).credentialInvalid, true)
  assert.equal(classifyDeepSeekBalanceError({ response: { status: 429 } }).code, 'rate_limited')
  assert.equal(classifyDeepSeekBalanceError({ response: { status: 503 } }).code, 'upstream_unavailable')
  assert.equal(classifyDeepSeekBalanceError({ code: 'ECONNABORTED' }).code, 'timeout')
  assert.equal(classifyDeepSeekBalanceError({ code: 'ECONNREFUSED' }).code, 'network_error')
})
