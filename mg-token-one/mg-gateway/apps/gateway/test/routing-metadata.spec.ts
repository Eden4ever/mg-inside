import test from 'node:test'
import assert from 'node:assert/strict'
import { RoutingMetadataService } from '../src/modules/routing-metadata/routing-metadata.service'

function repository(rows: any[]) {
  return {
    find: async () => rows,
    findOne: async ({ where }: any) => rows.find((row) => row.id === where.id) || null,
  }
}

test('路由元数据目录关联供应商账户且不暴露凭据', async () => {
  const metadata = new RoutingMetadataService(
    repository([{ id: 1, code: 'openai', name: 'OpenAI' }]) as any,
    repository([{ id: 6, code: 'cctq', name: 'CCTQ' }]) as any,
    repository([{
      id: 1,
      code: 'cctq-global',
      supplierId: 6,
      adapterCode: 'cctq',
      name: 'CCTQ 全局账户',
      enabled: 1,
      lastSyncStatus: 'healthy',
      displayName: 'Example',
      credentialEncrypted: 'must-not-leak',
    }]) as any,
    {
      catalog: () => [{
        code: 'cctq',
        supplierCode: 'cctq',
        capabilities: { configuration: true, balanceSync: true },
      }],
    } as any,
  )

  const catalog = await metadata.catalog()

  assert.equal(catalog.supplierAccounts[0].supplierName, 'CCTQ')
  assert.equal(catalog.supplierAccounts[0].displayName, 'Example')
  assert.equal(catalog.supplierAccountAdapters[0].code, 'cctq')
  assert.doesNotMatch(JSON.stringify(catalog), /must-not-leak/)
})

test('路由元数据拒绝不存在或非法的关联 ID', async () => {
  const metadata = new RoutingMetadataService(
    repository([{ id: 1, code: 'openai', name: 'OpenAI' }]) as any,
    repository([]) as any,
    repository([{ id: 4, code: 'deepseek-default' }]) as any,
    { catalog: () => [] } as any,
  )

  assert.equal(await metadata.requireModelOwner(1), 1)
  assert.equal(await metadata.requireSupplierAccount(null), null)
  await assert.rejects(() => metadata.requireModelOwner(99), /模型所有者不存在/)
  await assert.rejects(() => metadata.requireSupplierAccount('bad'), /必须是正整数或空值/)
})
