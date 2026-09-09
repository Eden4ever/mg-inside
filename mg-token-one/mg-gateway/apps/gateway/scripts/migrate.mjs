import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'

const root = path.dirname(fileURLToPath(import.meta.url))
const migrationOrder = [
  'migration-add-responses.sql',
  'migration-add-channel-protocols.sql',
  'migration-add-request-protocol.sql',
  'migration-add-request-error-dimensions.sql',
  'migration-add-availability-alerts.sql',
  'migration-add-availability-alert-evaluation-key.sql',
  'migration-add-anthropic.sql',
  'migration-add-cache-pricing.sql',
  'migration-add-peak-valley-pricing.sql',
  'migration-add-cctq-account.sql',
  'migration-add-supplier-metadata.sql',
  'migration-link-official-supplier-accounts.sql',
  'migration-allow-multiple-supplier-accounts.sql',
  'migration-add-supplier-account-routing-state.sql',
  'migration-ensure-cctq-global-account.sql',
  'migration-enable-deepseek-account-adapter.sql',
  'migration-set-deepseek-balance-unit.sql',
  'migration-add-channel-health.sql',
  'migration-backfill-channel-request-counts.sql',
  'migration-add-user-quota-packages.sql',
  'migration-add-user-quota-adjustments.sql',
  'migration-add-quota-nonnegative-constraints.sql',
  'migration-add-model-routes.sql',
  'migration-add-channel-route-health.sql',
  'migration-add-cctq-api-key-state.sql',
  'migration-add-request-log-retention-index.sql',
  'migration-add-identity.sql',
]

function required(name, fallback = '') {
  const value = process.env[name] || fallback
  if (!value) throw new Error(`缺少 ${name}`)
  return value
}

const connection = await mysql.createConnection({
  host: required('DB_HOST', '127.0.0.1'),
  port: Number(required('DB_PORT', '3306')),
  user: required('DB_USERNAME', 'root'),
  password: required('DB_PASSWORD'),
  database: required('DB_DATABASE', 'mg_gateway'),
  multipleStatements: true,
})

try {
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id VARCHAR(160) NOT NULL PRIMARY KEY,
      appliedAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    )
  `)

  const [rows] = await connection.query('SELECT id, appliedAt FROM schema_migrations ORDER BY id')
  const applied = new Map(rows.map((row) => [row.id, row.appliedAt]))
  const statusOnly = process.argv.includes('--status')
  for (const file of migrationOrder) {
    if (statusOnly) {
      console.log(`${applied.has(file) ? 'applied' : 'pending'} ${file}`)
      continue
    }
    if (applied.has(file)) {
      console.log(`skip ${file}`)
      continue
    }
    const sql = await fs.readFile(path.join(root, file), 'utf8')
    console.log(`apply ${file}`)
    await connection.beginTransaction()
    try {
      await connection.query(sql)
      await connection.execute('INSERT INTO schema_migrations (id) VALUES (?)', [file])
      await connection.commit()
    } catch (error) {
      await connection.rollback()
      throw new Error(`${file} 执行失败：${error.message}`)
    }
  }
} finally {
  await connection.end()
}
