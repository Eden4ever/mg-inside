import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import test from 'node:test'

import {
  configureClaudeCredential,
  encrypt,
  requireNonBlank,
} from '../scripts/configure-cctq-claude-upstream.mjs'

function decrypt(value, secret) {
  const payload = Buffer.from(value, 'base64')
  const key = crypto.createHash('sha256').update(String(secret)).digest()
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, payload.subarray(0, 12))
  decipher.setAuthTag(payload.subarray(12, 28))
  return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString('utf8')
}

function mockDb(channels = [{ id: 51 }], affectedRows = 1) {
  const calls = []
  return {
    calls,
    beginTransaction: async () => calls.push(['begin']),
    commit: async () => calls.push(['commit']),
    rollback: async () => calls.push(['rollback']),
    execute: async (query, params) => {
      calls.push(['execute', query, params])
      if (query.startsWith('SELECT id FROM channels')) return [channels]
      if (query.startsWith('UPDATE channels')) return [{ affectedRows }]
      throw new Error(`unexpected query: ${query}`)
    },
  }
}

test('CCTQ Claude 凭据仅更新既有渠道的密文', async () => {
  const db = mockDb()
  const channelId = await configureClaudeCredential({
    db,
    claudeKey: 'claude-only-key',
    jwtSecret: 'jwt-secret-for-test',
  })

  assert.equal(channelId, 51)
  const update = db.calls.find((call) => call[1]?.startsWith('UPDATE channels'))
  assert.ok(update)
  assert.equal(update[1], 'UPDATE channels SET keysEncrypted = ? WHERE id = ?')
  assert.equal(update[2][1], 51)
  assert.equal(decrypt(update[2][0], 'jwt-secret-for-test'), 'claude-only-key')
  assert.equal(db.calls.some((call) => call[1]?.includes('CCTQ-Codex')), false)
  assert.equal(db.calls.some((call) => call[1]?.startsWith('INSERT')), false)
  assert.equal(db.calls.at(-1)[0], 'commit')
})

test('缺失、空白 Claude 凭据在写库前失败', async () => {
  const db = mockDb()
  await assert.rejects(
    configureClaudeCredential({ db, claudeKey: '   ', jwtSecret: 'jwt-secret-for-test' }),
    /缺少 CCTQ_CLAUDE_KEY/,
  )
  assert.deepEqual(db.calls, [])
})

test('未找到 CCTQ-Claude 时回滚且不创建渠道', async () => {
  const db = mockDb([])
  await assert.rejects(
    configureClaudeCredential({ db, claudeKey: 'claude-only-key', jwtSecret: 'jwt-secret-for-test' }),
    /拒绝创建伪渠道/,
  )
  assert.equal(db.calls.some((call) => call[1]?.startsWith('UPDATE')), false)
  assert.equal(db.calls.at(-1)[0], 'rollback')
})

test('重复 CCTQ-Claude 渠道时回滚且不选择第一条', async () => {
  const db = mockDb([{ id: 51 }, { id: 52 }])
  await assert.rejects(
    configureClaudeCredential({ db, claudeKey: 'claude-only-key', jwtSecret: 'jwt-secret-for-test' }),
    /渠道不唯一/,
  )
  assert.equal(db.calls.some((call) => call[1]?.startsWith('UPDATE')), false)
  assert.equal(db.calls.at(-1)[0], 'rollback')
})

test('密文更新未命中唯一渠道时回滚', async () => {
  const db = mockDb([{ id: 51 }], 0)
  await assert.rejects(
    configureClaudeCredential({ db, claudeKey: 'claude-only-key', jwtSecret: 'jwt-secret-for-test' }),
    /凭据更新未命中唯一渠道/,
  )
  assert.equal(db.calls.at(-1)[0], 'rollback')
})

test('加密输出不包含明文 Claude 密钥', () => {
  const encrypted = encrypt('claude-only-key', 'jwt-secret-for-test')
  assert.equal(encrypted.includes('claude-only-key'), false)
  assert.equal(decrypt(encrypted, 'jwt-secret-for-test'), 'claude-only-key')
  assert.throws(() => requireNonBlank('CCTQ_CLAUDE_KEY', ''), /缺少 CCTQ_CLAUDE_KEY/)
})
