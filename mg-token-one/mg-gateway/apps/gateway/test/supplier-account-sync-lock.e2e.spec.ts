import assert from 'node:assert/strict'
import test from 'node:test'
import mysql from 'mysql2/promise'
import { DataSource } from 'typeorm'
import { SupplierAccountSyncLockService } from '../src/modules/supplier-account/supplier-account-sync-lock.service'

test('供应商账户同步锁在不同 MySQL 连接间互斥，并在释放后可恢复', async () => {
  const database = `mg_gateway_supplier_sync_lock_${process.pid}_${Date.now()}`
  assert.match(database, /^mg_gateway_supplier_sync_lock_\d+_\d+$/)
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
      })
      await source.initialize()
      sources.push(source)
    }
    const first = new SupplierAccountSyncLockService(sources[0])
    const second = new SupplierAccountSyncLockService(sources[1])

    const held = await first.tryAcquire(42)
    assert.ok(held)
    assert.equal(await second.tryAcquire(42), null)

    await held.release()
    const recovered = await second.tryAcquire(42)
    assert.ok(recovered)
    await recovered.release()
  } finally {
    await Promise.all(sources.map(async (source) => {
      if (source.isInitialized) await source.destroy()
    }))
    await root.query(`DROP DATABASE IF EXISTS \`${database}\``)
    await root.end()
  }
})
