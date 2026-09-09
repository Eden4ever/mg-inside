import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCctqApiKeyModels,
  buildCctqApiKeyBalanceSnapshot,
  buildCctqApiKeyUsageSnapshot,
  buildCctqRemoteSnapshot,
  classifyCctqApiKeyError,
  classifyCctqError,
  normalizeSyncInterval,
} from '../src/modules/cctq-account/cctq-account.policy'

test('CCTQ API Key 额度契约保留原始额度、无限额和模型限制', () => {
  const usage = buildCctqApiKeyUsageSnapshot({
    code: true,
    data: {
      name: 'codex-key',
      total_granted: 500000,
      total_used: 120000,
      total_available: 380000,
      unlimited_quota: false,
      model_limits: { 'gpt-5.6-terra': 1 },
      model_limits_enabled: true,
      expires_at: 1780000000,
    },
  })

  assert.equal(usage.totalAvailableRaw, 380000)
  assert.equal(usage.unlimitedQuota, false)
  assert.deepEqual(usage.modelLimits, { 'gpt-5.6-terra': 1 })
  assert.equal(usage.expiresAt, 1780000000)
})

test('CCTQ API Key 模型目录去重并拒绝非法条目', () => {
  assert.deepEqual(
    buildCctqApiKeyModels({ data: [{ id: 'gpt-5.6-terra' }, { id: 'gpt-5.6-terra' }, { id: 'deepseek-chat' }] }),
    ['gpt-5.6-terra', 'deepseek-chat'],
  )
  assert.throws(() => buildCctqApiKeyModels({ data: [{ name: 'missing-id' }] }), /模型响应格式无效/)
})

test('CCTQ API Key 余额快照只映射可用/已用额度，不伪造套餐和无限额语义', () => {
  const snapshot = buildCctqApiKeyBalanceSnapshot({
      code: true,
      data: {
        name: 'api-key',
        total_granted: 100,
        total_used: 25,
        total_available: 75,
        unlimited_quota: false,
        model_limits: {},
        model_limits_enabled: false,
        expires_at: 0,
      },
  })

  assert.equal(snapshot.quotaAvailableRaw, 75)
  assert.equal(snapshot.billingPreference, null)
  assert.equal(snapshot.externalAccountId, null)
  assert.deepEqual(snapshot.subscriptions, [])
  assert.deepEqual(snapshot.models, [])
})

test('CCTQ API Key 无限额响应保留无限额、到期和模型限制语义', () => {
  const snapshot = buildCctqApiKeyBalanceSnapshot({
    code: true,
    data: {
      total_granted: 0,
      total_used: 0,
      total_available: 0,
      unlimited_quota: true,
      model_limits: {},
      model_limits_enabled: false,
      expires_at: 0,
    },
  })
  assert.equal(snapshot.unlimitedQuota, true)
  assert.equal(snapshot.expiresAt, 0)
  assert.deepEqual(snapshot.modelLimits, {})
  assert.equal(snapshot.modelLimitsEnabled, false)
  assert.equal(snapshot.quotaAvailableRaw, 0)
})

for (const invalid of [
  {},
  { code: true, data: { total_granted: 1, total_used: 0, total_available: 'NaN', unlimited_quota: false, model_limits: {}, model_limits_enabled: false, expires_at: 0 } },
  { code: true, data: { total_granted: 1, total_used: 0, total_available: 0, unlimited_quota: 'false', model_limits: {}, model_limits_enabled: false, expires_at: 0 } },
]) {
  test('CCTQ API Key 非法额度响应不会被当作零余额', () => {
    assert.throws(() => buildCctqApiKeyUsageSnapshot(invalid), /额度响应格式无效/)
  })
}

test('CCTQ 账户响应映射为供应商账户快照且不保留敏感字段', () => {
  const snapshot = buildCctqRemoteSnapshot({
    account: {
      id: 16457,
      display_name: 'example',
      email: 'must-not-be-copied@example.com',
      group: 'default',
      quota: 103834469,
      used_quota: 26165531,
      request_count: 2689,
    },
    status: { quota_display_type: 'CNY', quota_per_unit: 500000, usd_exchange_rate: 1 },
    stats: { quota: 26165531, rpm: 5, tpm: 621567 },
    groups: {
      'CodeX专用': { ratio: 0.3, desc: 'Codex | Pro号池 可外接' },
      auto: { ratio: '自动', desc: '自动路由' },
    },
    models: ['gpt-5.6-terra', 'gpt-5.6-terra', 'claude-sonnet-5'],
    subscriptions: { billing_preference: 'subscription_first', subscriptions: [] },
  })

  assert.equal(snapshot.upstreamAccountId, 16457)
  assert.equal(snapshot.quotaAvailableRaw, 103834469)
  assert.equal(snapshot.last30dQuotaRaw, 26165531)
  assert.equal(snapshot.groups.length, 2)
  assert.deepEqual(snapshot.models, ['gpt-5.6-terra', 'claude-sonnet-5'])
  assert.equal((snapshot as any).email, undefined)
})

test('同步间隔限制在 5 到 1440 分钟', () => {
  assert.equal(normalizeSyncInterval(10), 10)
  assert.throws(() => normalizeSyncInterval(4), /5-1440/)
  assert.throws(() => normalizeSyncInterval(1441), /5-1440/)
})

test('CCTQ 错误分类不回传上游响应正文', () => {
  assert.deepEqual(classifyCctqError({ response: { status: 401, data: { secret: 'x' } } }), {
    code: 'credential_invalid',
    message: 'CCTQ Dashboard Access Token 无效或已过期',
    credentialInvalid: true,
  })
  assert.equal(classifyCctqError({ response: { status: 503 } }).code, 'upstream_unavailable')
  assert.equal(classifyCctqError({ code: 'ECONNABORTED' }).code, 'timeout')
  assert.equal(
    classifyCctqApiKeyError({ response: { status: 401 } }).message,
    'CCTQ API Key 无效或无余额查询权限',
  )
})
