import process from 'node:process'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'

export const CODEX_MODELS = ['gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra']

function uniqueRow(rows, label) {
  if (rows.length === 0) throw new Error(`生产数据库缺少 ${label}`)
  if (rows.length !== 1) throw new Error(`${label} 不唯一，拒绝修改`)
  return rows[0]
}

function parseProtocols(value) {
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string' && item)
  if (typeof value !== 'string' || !value.trim()) return []
  try {
    return parseProtocols(JSON.parse(value))
  } catch {
    throw new Error('渠道 protocols 不是合法 JSON，拒绝覆盖现有协议配置')
  }
}

function parseBindings(value) {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string' || !value.trim()) return []
  try {
    return parseBindings(JSON.parse(value))
  } catch {
    throw new Error('模型 legacy bindings 不是合法 JSON，拒绝覆盖现有供应商配置')
  }
}

export function addMissingProtocol(protocols, protocol) {
  return protocols.includes(protocol) ? protocols : [...protocols, protocol]
}

export function appendMissingBinding(bindings, channelId, upstreamModel) {
  if (bindings.some((binding) => binding && Number(binding.channelId) === channelId)) {
    return { bindings, changed: false }
  }
  return {
    bindings: [...bindings, { channelId, upstreamModel, priority: 0, weight: 1, status: 1 }],
    changed: true,
  }
}

async function assertRouteTable(db) {
  const [[routeTable]] = await db.execute(
    `SELECT COUNT(*) AS count FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'model_routes'`,
  )
  if (Number(routeTable.count) !== 1) {
    throw new Error('数据库迁移未完成：缺少 model_routes')
  }
}

/**
 * Add the Codex Responses capability without taking ownership of a model's
 * other suppliers, routes, or operational state. All rows are locked and
 * validated before any write so a partial/ambiguous catalog fails atomically.
 */
export async function configureCodexResponses({ db }) {
  await assertRouteTable(db)
  await db.beginTransaction()
  try {
    const [channels] = await db.execute(
      'SELECT id, protocol, protocols FROM channels WHERE name = ? ORDER BY id FOR UPDATE',
      ['CCTQ-Codex'],
    )
    const channel = uniqueRow(channels, 'CCTQ-Codex 渠道')
    const [accounts] = await db.execute(
      'SELECT id FROM supplier_accounts WHERE code = ? ORDER BY id FOR UPDATE',
      ['cctq-global'],
    )
    const account = uniqueRow(accounts, 'CCTQ 全局供应商账户')
    const [models] = await db.execute(
      `SELECT id, name, bindings FROM model_configs
       WHERE name IN (?, ?, ?) ORDER BY name FOR UPDATE`,
      CODEX_MODELS,
    )
    if (models.length !== CODEX_MODELS.length || new Set(models.map((model) => model.name)).size !== CODEX_MODELS.length) {
      throw new Error(`Codex 模型不完整或不唯一，实际 ${models.length}/${CODEX_MODELS.length}`)
    }

    // Preserve status, disabledUntil, failure counters, base URL and manual
    // protocol choices. This only adds the protocol and supplier association.
    const protocols = addMissingProtocol(
      addMissingProtocol(parseProtocols(channel.protocols), channel.protocol || 'chat'),
      'responses',
    )
    await db.execute(
      `UPDATE channels
       SET supplierAccountId = ?, protocols = ?,
           protocol = CASE WHEN protocol IS NULL OR protocol = '' THEN 'chat' ELSE protocol END
       WHERE id = ?`,
      [account.id, JSON.stringify(protocols), channel.id],
    )

    for (const model of models) {
      const legacy = parseBindings(model.bindings)
      const merged = appendMissingBinding(legacy, Number(channel.id), model.name)
      if (merged.changed) {
        await db.execute(
          'UPDATE model_configs SET supportsResponses = 1, bindings = ? WHERE id = ?',
          [JSON.stringify(merged.bindings), model.id],
        )
      } else {
        await db.execute('UPDATE model_configs SET supportsResponses = 1 WHERE id = ?', [model.id])
      }
      // The unique key is (modelId, channelId). The no-op duplicate branch
      // deliberately preserves an administrator's route status/priority/weight.
      await db.execute(
        `INSERT INTO model_routes (modelId, channelId, upstreamModel, priority, weight, status)
         VALUES (?, ?, ?, 0, 1, 1)
         ON DUPLICATE KEY UPDATE id = id`,
        [model.id, channel.id, model.name],
      )
    }

    await db.commit()
    return { channelId: Number(channel.id), modelCount: models.length }
  } catch (error) {
    await db.rollback()
    throw error
  }
}

function required(name, fallback = '') {
  const value = process.env[name] || fallback
  if (!value) throw new Error(`缺少 ${name}`)
  return value
}

async function main() {
  const db = await mysql.createConnection({
    host: required('DB_HOST', '127.0.0.1'),
    port: Number(required('DB_PORT', '3306')),
    user: required('DB_USERNAME', 'root'),
    password: required('DB_PASSWORD'),
    database: required('DB_DATABASE', 'mg_gateway'),
  })
  try {
    const result = await configureCodexResponses({ db })
    console.log(JSON.stringify({ channel: 'CCTQ-Codex', ...result, responsesConfigured: true }))
  } finally {
    await db.end()
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main()
}
