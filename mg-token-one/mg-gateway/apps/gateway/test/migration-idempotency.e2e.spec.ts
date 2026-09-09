import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import mysql from 'mysql2/promise'

const migrationFiles = [
  'migration-add-availability-alerts.sql',
  'migration-add-availability-alert-evaluation-key.sql',
  'migration-add-quota-nonnegative-constraints.sql',
  'migration-add-channel-route-health.sql',
  'migration-add-cctq-api-key-state.sql',
  'migration-add-request-log-retention-index.sql',
]

test('告警、路径健康与额度迁移可重复执行并由数据库拒绝负额度', async () => {
  const database = `mg_gateway_migration_${process.pid}_${Date.now()}`
  assert.match(database, /^mg_gateway_migration_\d+_\d+$/)
  const root = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USERNAME || 'root',
    password: process.env.DB_PASSWORD || '',
  })
  let connection: mysql.Connection | undefined
  try {
    await root.query(
      `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    )
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USERNAME || 'root',
      password: process.env.DB_PASSWORD || '',
      database,
      multipleStatements: true,
    })
    await connection.query(`
      CREATE TABLE users (
        id INT PRIMARY KEY AUTO_INCREMENT,
        fixedMonthlyQuota DECIMAL(14,6) NOT NULL DEFAULT 0
      );
      CREATE TABLE user_monthly_quotas (
        id INT PRIMARY KEY AUTO_INCREMENT,
        userId INT NOT NULL,
        period VARCHAR(7) NOT NULL,
        quotaUsed DECIMAL(14,6) NOT NULL DEFAULT 0,
        temporaryMonthlyQuota DECIMAL(14,6) NOT NULL DEFAULT 0,
        UNIQUE KEY uq_user_period (userId, period)
      );
      CREATE TABLE \`groups\` (
        id INT PRIMARY KEY AUTO_INCREMENT,
        monthlyQuota DECIMAL(12,2) NULL
      );
      CREATE TABLE supplier_accounts (
        id BIGINT PRIMARY KEY AUTO_INCREMENT,
        code VARCHAR(64) NOT NULL
      );
      CREATE TABLE request_logs (
        id BIGINT PRIMARY KEY AUTO_INCREMENT,
        createdAt DATETIME(6) NOT NULL
      );
      INSERT INTO users (fixedMonthlyQuota) VALUES (-1);
      INSERT INTO user_monthly_quotas
        (userId, period, quotaUsed, temporaryMonthlyQuota)
        VALUES (1, '2026-08', -2, -3);
      INSERT INTO \`groups\` (monthlyQuota) VALUES (-4);
    `)

    const scriptsRoot = path.resolve(__dirname, '../scripts')
    const migrations = await Promise.all(
      migrationFiles.map((file) => fs.readFile(path.join(scriptsRoot, file), 'utf8')),
    )
    for (let pass = 0; pass < 2; pass += 1) {
      for (const migration of migrations) await connection.query(migration)
    }

    const [tables]: any = await connection.query(`
      SELECT COUNT(*) AS count
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN ('availability_alert_states', 'availability_alert_events')
    `)
    const [routeHealth]: any = await connection.query(`
      SELECT COUNT(*) AS count
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'channel_route_health'
    `)
    const [routeHealthUnique]: any = await connection.query(`
      SELECT COUNT(*) AS count
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'channel_route_health'
        AND INDEX_NAME = 'uq_channel_route_health_path'
    `)
    const [routeHealthRows]: any = await connection.query(`
      SELECT COUNT(*) AS count
      FROM channel_route_health
    `)
    const [evaluationKey]: any = await connection.query(`
      SELECT COUNT(*) AS count
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'availability_alert_states'
        AND COLUMN_NAME = 'lastEvaluationKey'
    `)
    const [constraints]: any = await connection.query(`
      SELECT COUNT(*) AS count
      FROM information_schema.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_TYPE = 'CHECK'
    `)
    const [cctqContractColumns]: any = await connection.query(`
      SELECT COLUMN_NAME, COLUMN_DEFAULT
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'supplier_accounts'
        AND COLUMN_NAME IN ('unlimitedQuota', 'expiresAt', 'modelLimits', 'modelLimitsEnabled')
      ORDER BY FIELD(COLUMN_NAME, 'unlimitedQuota', 'expiresAt', 'modelLimits', 'modelLimitsEnabled')
    `)
    const [requestLogRetentionIndex]: any = await connection.query(`
      SELECT INDEX_NAME, COLUMN_NAME, SEQ_IN_INDEX
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'request_logs'
        AND INDEX_NAME = 'IDX_request_logs_retention_created_at_id'
      ORDER BY SEQ_IN_INDEX
    `)
    const [normalized]: any = await connection.query(`
      SELECT
        (SELECT fixedMonthlyQuota FROM users LIMIT 1) AS fixedQuota,
        (SELECT quotaUsed FROM user_monthly_quotas LIMIT 1) AS usedQuota,
        (SELECT temporaryMonthlyQuota FROM user_monthly_quotas LIMIT 1) AS temporaryQuota,
        (SELECT monthlyQuota FROM \`groups\` LIMIT 1) AS groupQuota
    `)
    assert.equal(Number(tables[0].count), 2)
    assert.equal(Number(routeHealth[0].count), 1)
    assert.equal(Number(routeHealthUnique[0].count), 3)
    // The migration only defines the strict-path schema. Channel-level history
    // must never be backfilled as success evidence for a model/protocol path.
    assert.equal(Number(routeHealthRows[0].count), 0)
    assert.equal(Number(evaluationKey[0].count), 1)
    assert.equal(Number(constraints[0].count), 4)
    assert.deepEqual(
      cctqContractColumns.map((column: any) => column.COLUMN_NAME),
      ['unlimitedQuota', 'expiresAt', 'modelLimits', 'modelLimitsEnabled'],
    )
    assert.deepEqual(
      cctqContractColumns.map((column: any) => Number(column.COLUMN_DEFAULT)),
      [0, 0, 0, 0],
    )
    assert.deepEqual(
      requestLogRetentionIndex.map((row: any) => [row.COLUMN_NAME, Number(row.SEQ_IN_INDEX)]),
      [['createdAt', 1], ['id', 2]],
    )
    assert.deepEqual(
      Object.values(normalized[0]).map(Number),
      [0, 0, 0, 0],
    )
    await assert.rejects(
      connection.query('UPDATE users SET fixedMonthlyQuota = -1 WHERE id = 1'),
    )
    await assert.rejects(
      connection.query(
        'UPDATE user_monthly_quotas SET quotaUsed = -1, temporaryMonthlyQuota = -1 WHERE id = 1',
      ),
    )
    await assert.rejects(
      connection.query('UPDATE `groups` SET monthlyQuota = -1 WHERE id = 1'),
    )
  } finally {
    if (connection) await connection.end()
    await root.query(`DROP DATABASE IF EXISTS \`${database}\``)
    await root.end()
  }
})
