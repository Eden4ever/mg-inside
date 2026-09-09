import test from 'node:test'
import assert from 'node:assert/strict'
import { CryptoUtil } from '../src/common/utils/crypto.util'
import { CctqAccountService } from '../src/modules/cctq-account/cctq-account.service'
import { SupplierAccountSnapshot } from '../src/common/types/supplier-account.types'

const secret = 'unit-test-secret-0123456789abcdef'

const remoteSnapshot: SupplierAccountSnapshot = {
  externalAccountId: 16457,
  displayName: 'CCTQ Test',
  accountGroup: 'default',
  quotaAvailableRaw: 1000,
  quotaUsedRaw: 250,
  requestCount: 12,
  last30dQuotaRaw: 200,
  rpm: 3,
  tpm: 4000,
  quotaDisplayType: 'CNY',
  quotaPerUnit: 500000,
  usdExchangeRate: 1,
  billingPreference: 'subscription_first',
  subscriptions: [],
  groups: [{ name: 'default', ratio: 1, description: '默认分组' }],
  models: ['gpt-test'],
}

function accountFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    code: 'cctq-global',
    supplierId: 6,
    adapterCode: 'cctq',
    name: 'CCTQ 全局账户',
    credentialEncrypted: CryptoUtil.encrypt('old-token', secret),
    enabled: 1,
    syncIntervalMinutes: 10,
    upstreamAccountId: 100,
    displayName: 'Old Account',
    accountGroup: 'old-group',
    quotaAvailableRaw: 800,
    quotaUsedRaw: 200,
    requestCount: 10,
    last30dQuotaRaw: 180,
    rpm: 2,
    tpm: 3000,
    quotaDisplayType: 'CNY',
    quotaPerUnit: 500000,
    usdExchangeRate: 1,
    billingPreference: null,
    subscriptions: [],
    groups: [],
    models: ['old-model'],
    lastSyncStatus: 'healthy',
    lastAttemptAt: new Date('2026-08-18T00:00:00Z'),
    lastSyncAt: new Date('2026-08-18T00:00:00Z'),
    lastErrorCode: null,
    lastErrorMessage: null,
    createdAt: new Date('2026-08-18T00:00:00Z'),
    updatedAt: new Date('2026-08-18T00:00:00Z'),
    ...overrides,
  }
}

function createHarness(options: {
  account?: any
  history?: any[]
  fetchSnapshot: (credential: string, adapterCode?: string) => Promise<SupplierAccountSnapshot>
  fetchModels?: (credential: string) => Promise<string[]>
}) {
  let account = options.account ?? null
  const accountSaves: any[] = []
  const snapshots = [...(options.history || [])]
  const snapshotSaves: any[] = []
  const accountRepo = {
    findOne: async () => account,
    create: (value: any) => ({ ...value }),
    save: async (value: any) => {
      account = value
      accountSaves.push(value)
      return value
    },
  }
  const snapshotRepo = {
    find: async () => [...snapshots],
    create: (value: any) => ({ ...value, capturedAt: new Date() }),
    save: async (value: any) => {
      snapshots.push(value)
      snapshotSaves.push(value)
      return value
    },
    delete: async () => ({ affected: 0 }),
  }
  const service = new CctqAccountService(
    accountRepo as any,
    snapshotRepo as any,
    {
      findOne: async () => ({ id: 6, code: 'cctq' }),
      create: (value: any) => value,
      save: async (value: any) => ({ id: 6, ...value }),
    } as any,
    { jwt: { secret } } as any,
    {
      get: (code: string) => options.fetchModels && code === 'cctq-api-key'
        ? { fetchModels: options.fetchModels }
        : null,
      require: (code: string) => {
        return { fetchSnapshot: (credential: string) => options.fetchSnapshot(credential, code) }
      },
    } as any,
    {
      tryAcquire: async () => ({ release: async () => undefined }),
    } as any,
  )
  return {
    service,
    getAccount: () => account,
    accountSaves,
    snapshots,
    snapshotSaves,
  }
}

test('全局 CCTQ 账户显式选择 API Key 适配器并保留凭据模式', async () => {
  const harness = createHarness({
    fetchSnapshot: async (credential, adapterCode) => {
      assert.equal(credential, 'new-api-key')
      assert.equal(adapterCode, 'cctq-api-key')
      return {
        ...remoteSnapshot,
        externalAccountId: null,
        displayName: 'CCTQ API Key',
        billingPreference: 'api_key',
        models: ['gpt-5.6-terra'],
      }
    },
    fetchModels: async (credential) => {
      assert.equal(credential, 'new-api-key')
      return ['gpt-5.6-terra']
    },
  })

  const state: any = await harness.service.save({ apiKey: ' new-api-key ', enabled: true })
  const account = harness.getAccount()
  assert.equal(account.adapterCode, 'cctq-api-key')
  assert.equal(state.credentialType, 'api_key')
  assert.equal(state.credentialLabel, 'API Key')
  assert.equal(state.models[0], 'gpt-5.6-terra')
})

test('CCTQ 凭据类型与字段不匹配时拒绝猜测并保留单账号状态', async () => {
  const original = accountFixture()
  const harness = createHarness({
    account: original,
    fetchSnapshot: async () => {
      throw new Error('不应调用上游')
    },
  })

  await assert.rejects(
    () => harness.service.save({ credentialType: 'api_key', dashboardToken: 'dashboard-token' }),
    /credentialType=api_key/,
  )
  await assert.rejects(
    () => harness.service.save({ credentialType: 'api_key' }),
    /必须同时提供新凭据/,
  )
  assert.equal(harness.getAccount(), original)
  assert.equal(harness.accountSaves.length, 0)
})

test('保存新凭据时先验证，成功后仅返回脱敏账户状态', async () => {
  const harness = createHarness({
    fetchSnapshot: async (credential) => {
      assert.equal(credential, 'new-token')
      return remoteSnapshot
    },
  })

  const state: any = await harness.service.save({
    dashboardToken: ' new-token ',
    enabled: true,
    syncIntervalMinutes: 15,
  })

  const stored = harness.getAccount()
  assert.equal(stored.enabled, 1)
  assert.equal(stored.syncIntervalMinutes, 15)
  assert.notEqual(stored.credentialEncrypted, 'new-token')
  assert.equal(CryptoUtil.decrypt(stored.credentialEncrypted, secret), 'new-token')
  assert.equal(state.configured, true)
  assert.equal(state.lastSyncStatus, 'healthy')
  assert.equal((state as any).dashboardTokenEncrypted, undefined)
  assert.equal((state as any).credentialEncrypted, undefined)
  assert.doesNotMatch(JSON.stringify(state), /new-token/)
  assert.equal(harness.snapshotSaves.length, 1)
})

test('新凭据验证失败时不覆盖旧凭据和最后成功快照', async () => {
  const original = accountFixture()
  const history = [{
    id: 1,
    quotaAvailableRaw: 800,
    quotaUsedRaw: 200,
    requestCount: 10,
    last30dQuotaRaw: 180,
    capturedAt: new Date('2026-08-18T00:00:00Z'),
  }]
  const before = JSON.stringify(original)
  const harness = createHarness({
    account: original,
    history,
    fetchSnapshot: async () => {
      throw { response: { status: 401, data: { token: 'must-not-leak' } } }
    },
  })

  await assert.rejects(
    () => harness.service.save({ dashboardToken: 'invalid-token' }),
    /Dashboard Access Token 无效或已过期/,
  )

  assert.equal(JSON.stringify(harness.getAccount()), before)
  assert.equal(harness.accountSaves.length, 0)
  assert.deepEqual(harness.snapshots, history)
  assert.equal(harness.snapshotSaves.length, 0)
})

test('同步遇到上游故障时标记数据过期并保留最后成功快照', async () => {
  const original = accountFixture()
  const history = [{
    id: 1,
    quotaAvailableRaw: 800,
    quotaUsedRaw: 200,
    requestCount: 10,
    last30dQuotaRaw: 180,
    capturedAt: new Date('2026-08-18T00:00:00Z'),
  }]
  const harness = createHarness({
    account: original,
    history,
    fetchSnapshot: async () => {
      throw { response: { status: 503 } }
    },
  })

  await assert.rejects(() => harness.service.synchronize(), /暂不可用/)

  const stored = harness.getAccount()
  assert.equal(stored.lastSyncStatus, 'stale')
  assert.equal(stored.lastErrorCode, 'upstream_unavailable')
  assert.equal(stored.quotaAvailableRaw, 800)
  assert.deepEqual(stored.models, ['old-model'])
  assert.equal(harness.snapshotSaves.length, 0)
  assert.deepEqual(harness.snapshots, history)
  const publicState: any = await harness.service.getState()
  assert.equal(publicState.history.length, 1)
  assert.equal((publicState as any).dashboardTokenEncrypted, undefined)
  assert.equal((publicState as any).credentialEncrypted, undefined)
})

test('CCTQ 定时同步在取得跨实例锁后复核到期时间，不重复生成快照', async () => {
  const account = accountFixture({ lastAttemptAt: new Date() })
  const harness = createHarness({
    account,
    fetchSnapshot: async () => remoteSnapshot,
  })

  await (harness.service as any).synchronize('scheduled')

  assert.equal(harness.snapshotSaves.length, 0)
})

test('无限额 API Key 持久化额度限制与过期提示，但绝不自动停用路由', async () => {
  const expiresAt = Math.floor(Date.now() / 1000) - 60
  const account = accountFixture({
    adapterCode: 'cctq-api-key',
    routingEnabled: 1,
    enabled: 1,
  })
  const harness = createHarness({
    account,
    fetchSnapshot: async () => ({
      ...remoteSnapshot,
      quotaAvailableRaw: 0,
      quotaUsedRaw: 0,
      unlimitedQuota: true,
      expiresAt,
      modelLimits: { 'gpt-5.6-terra': 2000000 },
      modelLimitsEnabled: true,
    }),
  })

  const state: any = await harness.service.synchronize()
  const stored = harness.getAccount()

  assert.equal(stored.unlimitedQuota, 1)
  assert.equal(stored.expiresAt, expiresAt)
  assert.deepEqual(stored.modelLimits, { 'gpt-5.6-terra': 2000000 })
  assert.equal(stored.modelLimitsEnabled, 1)
  assert.equal(stored.enabled, 1)
  assert.equal(stored.routingEnabled, 1)
  assert.equal(state.unlimitedQuota, true)
  assert.equal(state.quotaAvailableDisplay, '无限额')
  assert.equal(state.expiresAt, expiresAt)
  assert.equal(state.expiresStatus, 'expired')
  assert.deepEqual(state.modelLimits, { 'gpt-5.6-terra': 2000000 })
  assert.equal(state.modelLimitsEnabled, true)
})

test('Dashboard 附加数据失败时余额仍成功同步并保留历史附加数据', async () => {
  const account = accountFixture({
    groups: [{ name: 'old-group', ratio: 1, description: '旧分组' }],
    models: ['old-model'],
    subscriptions: [{ id: 'old', name: '旧套餐', status: 'active', quotaRaw: 1, usedQuotaRaw: 0, startsAt: null, endsAt: null }],
    billingPreference: 'old-billing',
  })
  const harness = createHarness({
    account,
    fetchSnapshot: async () => ({
      ...remoteSnapshot,
      groups: [],
      models: [],
      subscriptions: [],
      billingPreference: null,
      optionalDataWarnings: [
        { source: 'groups', code: 'upstream_unavailable', message: 'CCTQ 暂不可用（HTTP 503）' },
        { source: 'models', code: 'timeout', message: 'CCTQ 请求超时' },
        { source: 'subscriptions', code: 'invalid_response', message: 'CCTQ 附加数据响应格式无效' },
      ],
    }),
  })

  await harness.service.synchronize()
  const stored = harness.getAccount()

  assert.equal(stored.quotaAvailableRaw, 1000)
  assert.deepEqual(stored.groups, account.groups)
  assert.deepEqual(stored.models, account.models)
  assert.deepEqual(stored.subscriptions, account.subscriptions)
  assert.equal(stored.billingPreference, 'old-billing')
  assert.equal(stored.lastSyncStatus, 'healthy')
  assert.equal(stored.lastErrorCode, 'optional_sync_failed')
  assert.match(stored.lastErrorMessage, /groups.*models.*subscriptions/)
  assert.doesNotMatch(JSON.stringify(stored), /old-token/)
})
