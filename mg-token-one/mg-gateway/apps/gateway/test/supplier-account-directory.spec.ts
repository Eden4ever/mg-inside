import test from 'node:test'
import assert from 'node:assert/strict'
import { SupplierAccountDirectoryService } from '../src/modules/supplier-account/supplier-account-directory.service'
import { SupplierAccountAdapterRegistry } from '../src/modules/supplier-account/supplier-account-adapter.registry'

const adapterRegistry = {
  supportsConfiguration: (code: string) => code === 'cctq',
  get: (code: string) => code === 'deepseek' ? {
    code: 'deepseek',
    supplierCode: 'deepseek',
    displayName: 'DeepSeek 官方 API',
    credentialLabel: 'API Key',
    baseUrl: 'https://api.deepseek.com',
    capabilities: { configuration: true, balanceSync: true },
    defaults: { syncIntervalMinutes: 10, quotaDisplayType: 'CNY', quotaPerUnit: 100 },
  } : null,
}

function createDirectory(accounts: any[], suppliers: any[]) {
  return new SupplierAccountDirectoryService(
    { find: async () => accounts } as any,
    { find: async () => suppliers } as any,
    { refresh: async () => {} } as any,
    adapterRegistry as any,
  )
}

test('供应商账户目录返回全部账户并归一化 CCTQ 状态', async () => {
  const directory = createDirectory([
    {
      id: 1,
      code: 'cctq-global',
      supplierId: 6,
      adapterCode: 'cctq',
      name: 'CCTQ 全局账户',
      displayName: 'Example Account',
      credentialEncrypted: 'must-not-leak',
      enabled: 1,
      lastSyncStatus: 'healthy',
      quotaAvailableRaw: 1000000,
      quotaDisplayType: 'CNY',
      quotaPerUnit: 500000,
      models: ['gpt-test', 'claude-test'],
      lastSyncAt: '2026-08-19T08:00:00.000Z',
    },
    {
      id: 2,
      code: 'deepseek-default',
      supplierId: 3,
      adapterCode: 'manual',
      name: 'DeepSeek 默认账户',
      displayName: null,
      credentialEncrypted: null,
      enabled: 1,
      lastSyncStatus: 'unconfigured',
      quotaAvailableRaw: null,
      quotaDisplayType: 'CNY',
      quotaPerUnit: 500000,
      models: null,
      lastSyncAt: null,
    },
  ], [
    { id: 6, code: 'cctq', name: 'CCTQ', kind: 'third_party' },
    { id: 3, code: 'deepseek', name: 'DeepSeek 官方', kind: 'official' },
  ])

  const list = await directory.list()

  assert.equal(list.length, 2)
  assert.deepEqual(list[0], {
    id: 1,
    code: 'cctq-global',
    supplierId: 6,
    supplierCode: 'cctq',
    supplierName: 'CCTQ',
    supplierKind: 'third_party',
    adapterCode: 'cctq',
    supportsDetail: true,
    name: 'CCTQ 全局账户',
    accountName: 'Example Account',
    configured: true,
    enabled: true,
    routingEnabled: true,
    status: 'healthy',
    quotaAvailableRaw: 1000000,
    quotaDisplayType: 'CNY',
    quotaPerUnit: 500000,
    modelCount: 2,
    lastSyncAt: '2026-08-19T08:00:00.000Z',
  })
  assert.equal(list[1].status, 'manual')
  assert.equal(list[1].supportsDetail, false)
  assert.equal(list[1].configured, true)
  assert.doesNotMatch(JSON.stringify(list), /must-not-leak/)
})

test('供应商账户目录稳定处理未知供应商和异常数值', async () => {
  const directory = createDirectory([{
    id: 9,
    code: 'unknown-account',
    supplierId: 99,
    adapterCode: 'custom',
    name: 'Unknown',
    displayName: null,
    credentialEncrypted: null,
    enabled: 0,
    lastSyncStatus: 'unexpected',
    quotaAvailableRaw: 'invalid',
    quotaPerUnit: 0,
    models: null,
  }], [])

  const [summary] = await directory.list()

  assert.equal(summary.supplierName, '未知供应商')
  assert.equal(summary.status, 'unconfigured')
  assert.equal(summary.quotaAvailableRaw, null)
  assert.equal(summary.quotaPerUnit, 500000)
  assert.equal(summary.modelCount, 0)
  assert.equal(summary.accountName, 'Unknown')
})

test('通用账户创建后可返回目录摘要并拒绝重复编码', async () => {
  const accounts: any[] = []
  const suppliers = [{ id: 3, code: 'deepseek', name: 'DeepSeek 官方', kind: 'official', status: 1 }]
  const accountRepo = {
    find: async () => accounts,
    findOne: async ({ where }: any) => accounts.find((item) =>
      where.id !== undefined ? item.id === where.id : item.code === where.code,
    ) || null,
    create: (value: any) => ({ ...value }),
    save: async (value: any) => {
      if (!value.id) value.id = accounts.length + 1
      if (!accounts.includes(value)) accounts.push(value)
      return value
    },
  }
  const directory = new SupplierAccountDirectoryService(
    accountRepo as any,
    {
      find: async () => suppliers,
      findOne: async ({ where }: any) => suppliers.find((item) => item.id === where.id) || null,
    } as any,
    { refresh: async () => {} } as any,
    adapterRegistry as any,
  )

  const created = await directory.create({
    code: 'deepseek-backup',
    supplierId: 3,
    name: 'DeepSeek 备用账户',
  })

  assert.equal(created.code, 'deepseek-backup')
  assert.equal(created.adapterCode, 'manual')
  assert.equal(created.routingEnabled, true)
  await assert.rejects(
    () => directory.create({ code: 'deepseek-backup', supplierId: 3, name: '重复' }),
    /账户编码已存在/,
  )
})

test('同一供应商可创建多个匹配的 DeepSeek 适配器账户', async () => {
  const accounts: any[] = []
  const suppliers = [{ id: 3, code: 'deepseek', name: 'DeepSeek 官方', kind: 'official', status: 1 }]
  const accountRepo = {
    find: async () => accounts,
    findOne: async ({ where }: any) => accounts.find((item) =>
      where.id !== undefined ? item.id === where.id : item.code === where.code,
    ) || null,
    create: (value: any) => ({ ...value }),
    save: async (value: any) => {
      if (!value.id) value.id = accounts.length + 1
      if (!accounts.includes(value)) accounts.push(value)
      return value
    },
  }
  const directory = new SupplierAccountDirectoryService(
    accountRepo as any,
    {
      find: async () => suppliers,
      findOne: async ({ where }: any) => suppliers.find((item) => item.id === where.id) || null,
    } as any,
    { refresh: async () => {} } as any,
    adapterRegistry as any,
  )

  const first = await directory.create({
    code: 'deepseek-primary', supplierId: 3, name: 'DeepSeek 主账户', adapterCode: 'deepseek',
  })
  const second = await directory.create({
    code: 'deepseek-backup', supplierId: 3, name: 'DeepSeek 备用账户', adapterCode: 'deepseek',
  })

  assert.equal(first.adapterCode, 'deepseek')
  assert.equal(second.adapterCode, 'deepseek')
  assert.equal(accounts[0].quotaPerUnit, 100)
  assert.equal(accounts[1].quotaDisplayType, 'CNY')
  assert.equal(first.configured, false)
})

test('创建账户拒绝未知适配器和供应商不匹配的适配器', async () => {
  const suppliers = [
    { id: 3, code: 'deepseek', name: 'DeepSeek 官方', kind: 'official', status: 1 },
    { id: 4, code: 'minimax', name: 'MiniMax 官方', kind: 'official', status: 1 },
  ]
  const directory = new SupplierAccountDirectoryService(
    { findOne: async () => null } as any,
    {
      findOne: async ({ where }: any) => suppliers.find((item) => item.id === where.id) || null,
    } as any,
    { refresh: async () => {} } as any,
    adapterRegistry as any,
  )

  await assert.rejects(
    () => directory.create({ code: 'unknown', supplierId: 3, name: 'Unknown', adapterCode: 'missing' }),
    /适配器不可用/,
  )
  await assert.rejects(
    () => directory.create({ code: 'wrong', supplierId: 4, name: 'Wrong', adapterCode: 'deepseek' }),
    /不适用于供应商/,
  )
})

test('CCTQ 不能通过通用接口创建第二个账户', async () => {
  const directory = new SupplierAccountDirectoryService(
    { findOne: async () => null } as any,
    {
      findOne: async () => ({ id: 6, code: 'cctq', name: 'CCTQ', status: 1 }),
    } as any,
    { refresh: async () => {} } as any,
    adapterRegistry as any,
  )

  await assert.rejects(
    () => directory.create({ code: 'cctq-second', supplierId: 6, name: 'CCTQ 第二账户' }),
    /唯一全局账户/,
  )
})

test('停用账户会保存独立路由开关并刷新渠道池', async () => {
  const account: any = {
    id: 2,
    code: 'deepseek-default',
    supplierId: 3,
    adapterCode: 'manual',
    name: 'DeepSeek 默认账户',
    credentialEncrypted: null,
    enabled: 0,
    routingEnabled: 1,
    lastSyncStatus: 'unconfigured',
    quotaAvailableRaw: null,
    quotaDisplayType: 'CNY',
    quotaPerUnit: 500000,
    models: null,
  }
  let refreshCount = 0
  const directory = new SupplierAccountDirectoryService(
    {
      find: async () => [account],
      findOne: async () => account,
      save: async (value: any) => value,
    } as any,
    {
      find: async () => [{ id: 3, code: 'deepseek', name: 'DeepSeek 官方', kind: 'official' }],
    } as any,
    { refresh: async () => { refreshCount++ } } as any,
    adapterRegistry as any,
  )

  const updated = await directory.update(2, { name: 'DeepSeek 主账户', routingEnabled: false })

  assert.equal(updated.name, 'DeepSeek 主账户')
  assert.equal(updated.routingEnabled, false)
  assert.equal(updated.status, 'disabled')
  assert.equal(refreshCount, 1)
})

test('适配器注册表按编码提供能力目录并拒绝重复注册', () => {
  const registry = new SupplierAccountAdapterRegistry()
  const cctq = {
    code: 'cctq',
    supplierCode: 'cctq',
    displayName: 'CCTQ Dashboard',
    credentialLabel: 'Dashboard Token',
    baseUrl: 'https://www.cctq.ai',
    capabilities: { configuration: true, balanceSync: true },
    defaults: { syncIntervalMinutes: 10, quotaDisplayType: 'CNY', quotaPerUnit: 500000 },
    fetchSnapshot: async () => ({}) as any,
  }
  registry.register(cctq)

  assert.equal(registry.require('CCTQ'), cctq)
  assert.equal(registry.supportsConfiguration('cctq'), true)
  assert.deepEqual(registry.catalog(), [{
    code: 'cctq',
    supplierCode: 'cctq',
    displayName: 'CCTQ Dashboard',
    credentialLabel: 'Dashboard Token',
    baseUrl: 'https://www.cctq.ai',
    capabilities: { configuration: true, balanceSync: true },
    defaults: { syncIntervalMinutes: 10, quotaDisplayType: 'CNY', quotaPerUnit: 500000 },
  }])
  assert.throws(() => registry.register({ ...cctq }), /重复注册/)
  assert.throws(() => registry.require('missing'), /未注册/)
})
