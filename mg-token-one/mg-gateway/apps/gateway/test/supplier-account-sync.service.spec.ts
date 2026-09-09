import test from 'node:test'
import assert from 'node:assert/strict'
import { CryptoUtil } from '../src/common/utils/crypto.util'
import { SupplierAccountSnapshot } from '../src/common/types/supplier-account.types'
import { SupplierAccountAdapterError } from '../src/modules/supplier-account/supplier-account-adapter'
import { SupplierAccountSyncService } from '../src/modules/supplier-account/supplier-account-sync.service'

const secret = 'supplier-account-test-secret-0123456789'
const remoteSnapshot: SupplierAccountSnapshot = {
  externalAccountId: null,
  displayName: 'DeepSeek API',
  accountGroup: null,
  quotaAvailableRaw: 1234,
  quotaUsedRaw: 0,
  requestCount: 0,
  last30dQuotaRaw: 0,
  rpm: 0,
  tpm: 0,
  quotaDisplayType: 'CNY',
  quotaPerUnit: 100,
  usdExchangeRate: 1,
  billingPreference: 'available',
  subscriptions: [],
  groups: [],
  models: [],
}

function createHarness(options: {
  credentialEncrypted?: string | null
  fetchSnapshot: (credential: string) => Promise<SupplierAccountSnapshot>
  fetchModels?: (credential: string) => Promise<string[]>
}) {
  let account: any = {
    id: 4,
    code: 'deepseek-default',
    supplierId: 3,
    adapterCode: 'deepseek',
    name: 'DeepSeek 默认账户',
    credentialEncrypted: options.credentialEncrypted ?? null,
    enabled: options.credentialEncrypted ? 1 : 0,
    routingEnabled: 1,
    syncIntervalMinutes: 10,
    quotaAvailableRaw: options.credentialEncrypted ? 800 : null,
    quotaUsedRaw: 0,
    requestCount: 0,
    last30dQuotaRaw: 0,
    quotaDisplayType: 'CNY',
    quotaPerUnit: 100,
    subscriptions: [],
    groups: [],
    models: [],
    lastSyncStatus: options.credentialEncrypted ? 'healthy' : 'unconfigured',
    lastAttemptAt: null,
    lastSyncAt: options.credentialEncrypted ? new Date('2026-08-19T00:00:00Z') : null,
    lastErrorCode: null,
    lastErrorMessage: null,
  }
  const accountSaves: any[] = []
  const snapshots: any[] = options.credentialEncrypted ? [{
    id: 1,
    supplierAccountId: 4,
    quotaAvailableRaw: 800,
    quotaUsedRaw: 0,
    requestCount: 0,
    last30dQuotaRaw: 0,
    capturedAt: new Date('2026-08-19T00:00:00Z'),
  }] : []
  const snapshotSaves: any[] = []
  const adapter = {
    code: 'deepseek',
    supplierCode: 'deepseek',
    displayName: 'DeepSeek 官方 API',
    credentialLabel: 'API Key',
    baseUrl: 'https://api.deepseek.com',
    capabilities: { configuration: true, balanceSync: true },
    defaults: { syncIntervalMinutes: 10, quotaDisplayType: 'CNY', quotaPerUnit: 100 },
    fetchSnapshot: options.fetchSnapshot,
    ...(options.fetchModels ? { fetchModels: options.fetchModels } : {}),
  }
  const service = new SupplierAccountSyncService(
    {
      findOne: async () => account,
      find: async () => [account],
      save: async (value: any) => {
        account = value
        accountSaves.push({ ...value })
        return value
      },
    } as any,
    {
      find: async () => [...snapshots].reverse(),
      create: (value: any) => ({ ...value, capturedAt: new Date() }),
      save: async (value: any) => {
        snapshots.push(value)
        snapshotSaves.push(value)
        return value
      },
      delete: async () => ({ affected: 0 }),
    } as any,
    {
      findOne: async () => ({
        id: 3,
        code: 'deepseek',
        name: 'DeepSeek 官方',
        kind: 'official',
      }),
    } as any,
    { jwt: { secret } } as any,
    {
      get: (code: string) => code === 'deepseek' ? adapter : null,
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

test('通用账户保存新凭据时先验证并仅返回脱敏状态', async () => {
  const harness = createHarness({
    fetchSnapshot: async (credential) => {
      assert.equal(credential, 'new-deepseek-key')
      return remoteSnapshot
    },
  })

  const state: any = await harness.service.saveCredential(4, {
    credential: ' new-deepseek-key ',
    enabled: true,
    syncIntervalMinutes: 15,
  })

  const account = harness.getAccount()
  assert.notEqual(account.credentialEncrypted, 'new-deepseek-key')
  assert.equal(CryptoUtil.decrypt(account.credentialEncrypted, secret), 'new-deepseek-key')
  assert.equal(account.quotaAvailableRaw, 1234)
  assert.equal(state.configured, true)
  assert.equal(state.baseUrl, 'https://api.deepseek.com')
  assert.equal(state.adapter.credentialLabel, 'API Key')
  assert.equal((state as any).credentialEncrypted, undefined)
  assert.doesNotMatch(JSON.stringify(state), /new-deepseek-key/)
  assert.equal(harness.snapshotSaves.length, 1)
})

test('新凭据验证失败时不覆盖已有凭据和快照', async () => {
  const encrypted = CryptoUtil.encrypt('old-key', secret)
  const harness = createHarness({
    credentialEncrypted: encrypted,
    fetchSnapshot: async () => {
      throw new SupplierAccountAdapterError(
        'credential_invalid',
        'DeepSeek API Key 无效或无余额查询权限',
        true,
      )
    },
  })

  await assert.rejects(
    () => harness.service.saveCredential(4, { credential: 'invalid-key' }),
    /API Key 无效/,
  )
  assert.equal(harness.getAccount().credentialEncrypted, encrypted)
  assert.equal(harness.getAccount().quotaAvailableRaw, 800)
  assert.equal(harness.accountSaves.length, 0)
  assert.equal(harness.snapshotSaves.length, 0)
  assert.equal(harness.snapshots.length, 1)
})

test('手动同步失败时标记过期并保留最后成功快照', async () => {
  const harness = createHarness({
    credentialEncrypted: CryptoUtil.encrypt('stored-key', secret),
    fetchSnapshot: async () => {
      throw new SupplierAccountAdapterError(
        'upstream_unavailable',
        'DeepSeek 暂不可用（HTTP 503）',
      )
    },
  })

  await assert.rejects(() => harness.service.synchronize(4), /暂不可用/)
  assert.equal(harness.getAccount().lastSyncStatus, 'stale')
  assert.equal(harness.getAccount().lastErrorCode, 'upstream_unavailable')
  assert.equal(harness.getAccount().quotaAvailableRaw, 800)
  assert.equal(harness.snapshotSaves.length, 0)
  assert.equal(harness.snapshots.length, 1)
})

test('模型目录同步失败时仍保存额度并保留上次模型目录', async () => {
  const harness = createHarness({
    credentialEncrypted: CryptoUtil.encrypt('stored-key', secret),
    fetchSnapshot: async () => ({ ...remoteSnapshot, quotaAvailableRaw: 1234 }),
    fetchModels: async () => {
      throw new SupplierAccountAdapterError('upstream_unavailable', '模型目录上游暂不可用（HTTP 503）')
    },
  })

  await harness.service.synchronize(4)
  assert.equal(harness.getAccount().quotaAvailableRaw, 1234)
  assert.deepEqual(harness.getAccount().models, [])
  assert.equal(harness.getAccount().lastSyncStatus, 'healthy')
  assert.equal(harness.getAccount().lastErrorCode, 'models_upstream_unavailable')
  assert.match(harness.getAccount().lastErrorMessage, /模型目录同步失败/)
  assert.equal(harness.snapshotSaves.length, 1)
})

test('定时同步在取得跨实例锁后复核到期时间，不重复生成快照', async () => {
  const harness = createHarness({
    credentialEncrypted: CryptoUtil.encrypt('stored-key', secret),
    fetchSnapshot: async () => remoteSnapshot,
  })
  const account = harness.getAccount()
  account.lastAttemptAt = new Date()

  await (harness.service as any).synchronize(4, 'scheduled')

  assert.equal(harness.snapshotSaves.length, 0)
})
