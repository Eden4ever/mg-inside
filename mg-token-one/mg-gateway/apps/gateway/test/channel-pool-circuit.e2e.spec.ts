import 'reflect-metadata'
import assert from 'node:assert/strict'
import test from 'node:test'
import mysql from 'mysql2/promise'
import { DataSource } from 'typeorm'
import { ChannelPoolService } from '../src/modules/relay/channel-pool.service'
import { Channel } from '../src/entities/channel.entity'
import { ChannelRouteHealth } from '../src/entities/channel-route-health.entity'
import { ModelConfig } from '../src/entities/model-config.entity'
import { SupplierAccount } from '../src/entities/supplier-account.entity'
import { CryptoUtil } from '../src/common/utils/crypto.util'

const secret = 'channel-pool-circuit-e2e-secret'

function routeStore(model: ModelConfig, bindings: Array<{ channelId: number; upstreamModel: string; priority: number }>) {
  return {
    bindingsByModel: async () => new Map([[model.id, bindings.map((binding) => ({ ...binding, status: 1 }))]]),
  }
}

function stalePath(
  channelId: number,
  model: ModelConfig,
  consecutiveErrors: number,
  lastFailureAt: Date | null,
) {
  const now = new Date()
  return {
    channelId,
    modelIdentity: `id:${model.id}`,
    modelName: model.name,
    protocol: 'responses' as const,
    consecutiveErrors,
    disabledUntil: null,
    totalRequests: 2,
    failedRequests: consecutiveErrors,
    lastSuccessAt: new Date(now.getTime() - 20_000),
    lastFailureAt,
    lastOutcomeAt: lastFailureAt || new Date(now.getTime() - 20_000),
  }
}

test('MySQL 锁下按最新路径健康状态复核，两个旧缓存实例最多熔断一条 Responses 路径', async () => {
  const database = `mg_gateway_circuit_${process.pid}_${Date.now()}`
  assert.match(database, /^mg_gateway_circuit_\d+_\d+$/)
  const root = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USERNAME || 'root',
    password: process.env.DB_PASSWORD || '',
  })
  const sources: DataSource[] = []
  try {
    await root.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
    for (let index = 0; index < 2; index += 1) {
      const source = new DataSource({
        type: 'mysql',
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT || 3306),
        username: process.env.DB_USERNAME || 'root',
        password: process.env.DB_PASSWORD || '',
        database,
        entities: [Channel, ChannelRouteHealth, ModelConfig, SupplierAccount],
        synchronize: index === 0,
        timezone: '+08:00',
        extra: { connectionLimit: 4 },
      })
      await source.initialize()
      sources.push(source)
    }
    const primarySource = sources[0]
    const channels = primarySource.getRepository(Channel)
    const models = primarySource.getRepository(ModelConfig)
    const routeHealth = primarySource.getRepository(ChannelRouteHealth)
    const primaryInput = {
      name: 'Circuit primary',
      type: 'openai',
      protocol: 'responses',
      protocols: ['responses'],
      baseUrl: 'https://primary.example.test',
      keysEncrypted: CryptoUtil.encrypt('primary-key', secret),
      status: 1,
    } as any as Channel
    const primary = await channels.save(primaryInput)
    const backupInput = {
      name: 'Circuit backup',
      type: 'openai',
      protocol: 'responses',
      protocols: ['responses'],
      baseUrl: 'https://backup.example.test',
      keysEncrypted: CryptoUtil.encrypt('backup-key', secret),
      status: 1,
    } as any as Channel
    const backup = await channels.save(backupInput)
    const model = await models.save({ name: 'circuit-e2e-model', status: 1 } as any as ModelConfig)
    const bindings = [
      { channelId: primary.id, upstreamModel: 'primary-upstream', priority: 10 },
      { channelId: backup.id, upstreamModel: 'backup-upstream', priority: 0 },
    ]
    const failureAt = new Date(Date.now() - 2_000)
    // Canonically, only primary is at its third consecutive failure; backup
    // is verified healthy. The second gateway's local cache is deliberately
    // stale and believes backup is also at its third failure while primary is
    // healthy. The old in-memory implementation would disable both paths.
    const initialHealth: ChannelRouteHealth[] = [
      stalePath(primary.id, model, 2, failureAt) as any as ChannelRouteHealth,
      stalePath(backup.id, model, 0, null) as any as ChannelRouteHealth,
    ]
    await routeHealth.save(initialHealth)

    const createPool = (source: DataSource) => new ChannelPoolService(
      source.getRepository(Channel),
      source.getRepository(ModelConfig),
      source.getRepository(SupplierAccount),
      { jwt: { secret }, relay: { autoCircuitBreakerEnabled: true, channelDisableSeconds: 300 } } as any,
      routeStore(model, bindings) as any,
      source.getRepository(ChannelRouteHealth),
    )
    const first = createPool(sources[0])
    const second = createPool(sources[1])
    await Promise.all([first.refresh(), second.refresh()])

    // Recreate the stale-cache split. Both local instances believe their own
    // path is at failure number three and the other is healthy.
    const identity = `id:${model.id}`
    const healthyAt = new Date(Date.now() - 1_000)
    ;(first as any).routeHealth.set(`${primary.id}:${identity}:responses`, stalePath(primary.id, model, 2, failureAt))
    ;(first as any).routeHealth.set(`${backup.id}:${identity}:responses`, stalePath(backup.id, model, 0, null))
    ;(second as any).routeHealth.set(`${backup.id}:${identity}:responses`, stalePath(backup.id, model, 2, failureAt))
    ;(second as any).routeHealth.set(`${primary.id}:${identity}:responses`, {
      ...stalePath(primary.id, model, 0, null),
      lastSuccessAt: healthyAt,
      lastOutcomeAt: healthyAt,
    })

    await Promise.all([
      first.recordFailure(primary.id, model.name, 'responses'),
      second.recordFailure(backup.id, model.name, 'responses'),
    ])

    const persisted = await routeHealth.find({ order: { channelId: 'ASC' } })
    assert.equal(persisted.length, 2)
    assert.ok(persisted.every((row) => row.consecutiveErrors >= 1))
    const disabled = persisted.filter((row) => Number(row.disabledUntil || 0) > Date.now())
    assert.ok(disabled.length <= 1)

    const observer = createPool(sources[0])
    await observer.refresh()
    const settled = await routeHealth.find({ order: { channelId: 'ASC' } })
    const settledDisabled = settled.filter((row) => Number(row.disabledUntil || 0) > Date.now())
    assert.ok(settledDisabled.length <= 1)
    const picked = observer.pick(model.name, 'responses')
    assert.ok(picked)
    if (settledDisabled.length === 1) {
      assert.notEqual(picked.channelId, settledDisabled[0].channelId)
    }
  } finally {
    await Promise.all(sources.map(async (source) => {
      if (source.isInitialized) await source.destroy()
    }))
    await root.query(`DROP DATABASE IF EXISTS \`${database}\``)
    await root.end()
  }
})
