// This script is deliberately narrow: it only replaces CCTQ-Claude ciphertext.
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import mysql from 'mysql2/promise'

export function requireNonBlank(name, value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`缺少 ${name}`)
  }
  return value
}

// This matches CryptoUtil so the running gateway can decrypt the replacement key.
export function encrypt(plain, secret) {
  const key = crypto.createHash('sha256').update(String(secret)).digest()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64')
}

export async function configureClaudeCredential({ db, claudeKey, jwtSecret }) {
  const key = requireNonBlank('CCTQ_CLAUDE_KEY', claudeKey)
  const secret = requireNonBlank('JWT_SECRET', jwtSecret)
  const encryptedKey = encrypt(key, secret)

  await db.beginTransaction()
  try {
    const [channels] = await db.execute(
      'SELECT id FROM channels WHERE name = ? ORDER BY id FOR UPDATE',
      ['CCTQ-Claude'],
    )
    if (channels.length === 0) {
      throw new Error('生产数据库缺少 CCTQ-Claude 渠道；拒绝创建伪渠道')
    }
    if (channels.length !== 1) throw new Error('CCTQ-Claude 渠道不唯一，拒绝更新凭据')
    const [channel] = channels

    const [updated] = await db.execute(
      'UPDATE channels SET keysEncrypted = ? WHERE id = ?',
      [encryptedKey, channel.id],
    )
    if (updated.affectedRows !== 1) {
      throw new Error('CCTQ-Claude 凭据更新未命中唯一渠道')
    }
    await db.commit()
    return Number(channel.id)
  } catch (error) {
    await db.rollback()
    throw error
  }
}

async function main() {
  const claudeKey = requireNonBlank('CCTQ_CLAUDE_KEY', process.env.CCTQ_CLAUDE_KEY)
  const jwtSecret = requireNonBlank('JWT_SECRET', process.env.JWT_SECRET)
  const db = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || '3306'),
    user: process.env.DB_USERNAME || 'root',
    password: requireNonBlank('DB_PASSWORD', process.env.DB_PASSWORD),
    database: process.env.DB_DATABASE || 'mg_gateway',
  })
  try {
    const channelId = await configureClaudeCredential({ db, claudeKey, jwtSecret })
    console.log(JSON.stringify({ channel: 'CCTQ-Claude', channelId, credentialUpdated: true }))
  } finally {
    await db.end()
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main()
}
