import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CODEX_MODELS,
  addMissingProtocol,
  appendMissingBinding,
  configureCodexResponses,
} from '../scripts/configure-codex-responses.mjs'

function fixture({ channels = [{ id: 41, protocol: 'chat', protocols: ['chat'] }], accounts = [{ id: 8 }], models = CODEX_MODELS.map((name, index) => ({
  id: index + 1,
  name,
  bindings: [{ channelId: 91, upstreamModel: `${name}-third-party`, priority: 7, weight: 9, status: 0 }],
})), fail = null } = {}) {
  const calls = []
  return {
    calls,
    beginTransaction: async () => calls.push(['begin']),
    commit: async () => calls.push(['commit']),
    rollback: async () => calls.push(['rollback']),
    execute: async (query, params = []) => {
      calls.push(['execute', query, params])
      if (fail?.(query, params)) throw new Error('forced database failure')
      if (query.includes('information_schema.TABLES')) return [[{ count: 1 }]]
      if (query.startsWith('SELECT id, protocol, protocols FROM channels')) return [channels]
      if (query.startsWith('SELECT id FROM supplier_accounts')) return [accounts]
      if (query.startsWith('SELECT id, name, bindings FROM model_configs')) return [models]
      if (query.startsWith('UPDATE channels')) return [{ affectedRows: 1 }]
      if (query.startsWith('UPDATE model_configs')) return [{ affectedRows: 1 }]
      if (query.startsWith('INSERT INTO model_routes')) return [{ affectedRows: 1 }]
      throw new Error(`unexpected query: ${query}`)
    },
  }
}

test('仅追加 CCTQ Responses 配置，保留其他供应商绑定和人工渠道状态', async () => {
  const db = fixture({ channels: [{
    id: 41,
    protocol: 'chat',
    protocols: ['chat', 'anthropic'],
    status: 0,
    disabledUntil: 123,
    consecutiveErrors: 8,
  }] })
  const result = await configureCodexResponses({ db })

  assert.deepEqual(result, { channelId: 41, modelCount: 3 })
  const channelUpdate = db.calls.find((call) => call[1]?.startsWith('UPDATE channels'))
  assert.ok(channelUpdate)
  assert.match(channelUpdate[1], /supplierAccountId/)
  assert.doesNotMatch(channelUpdate[1], /status|disabledUntil|consecutiveErrors|baseUrl|keysEncrypted/)
  assert.deepEqual(JSON.parse(channelUpdate[2][1]), ['chat', 'anthropic', 'responses'])

  const modelUpdates = db.calls.filter((call) => call[1]?.startsWith('UPDATE model_configs'))
  assert.equal(modelUpdates.length, 3)
  for (const update of modelUpdates) {
    assert.match(update[1], /^UPDATE model_configs SET supportsResponses = 1, bindings = \? WHERE id = \?$/)
    const bindings = JSON.parse(update[2][0])
    assert.equal(bindings[0].channelId, 91)
    assert.equal(bindings[0].priority, 7)
    assert.equal(bindings[0].weight, 9)
    assert.equal(bindings[0].status, 0)
    assert.equal(bindings.filter((binding) => binding.channelId === 41).length, 1)
  }
  const routes = db.calls.filter((call) => call[1]?.startsWith('INSERT INTO model_routes'))
  assert.equal(routes.length, 3)
  assert.ok(routes.every((call) => call[1].includes('ON DUPLICATE KEY UPDATE id = id')))
  assert.equal(db.calls.some((call) => call[1]?.match(/^DELETE\s/)), false)
  assert.equal(db.calls.at(-1)[0], 'commit')
})

test('既有 CCTQ legacy binding 和人工路由参数保持原样，重复执行幂等', async () => {
  const models = CODEX_MODELS.map((name, index) => ({
    id: index + 1,
    name,
    bindings: [
      { channelId: 91, upstreamModel: `${name}-third-party`, priority: 5, weight: 3, status: 1 },
      { channelId: 41, upstreamModel: `${name}-manual`, priority: 11, weight: 12, status: 0 },
    ],
  }))
  const db = fixture({ models })
  await configureCodexResponses({ db })
  const modelUpdates = db.calls.filter((call) => call[1]?.startsWith('UPDATE model_configs'))
  assert.equal(modelUpdates.length, 3)
  assert.ok(modelUpdates.every((call) => call[1] === 'UPDATE model_configs SET supportsResponses = 1 WHERE id = ?'))
  assert.ok(db.calls.filter((call) => call[1]?.startsWith('INSERT INTO model_routes')).every((call) => call[1].includes('id = id')))
})

test('缺失或重复受控对象在事务内回滚且不写入', async () => {
  for (const options of [
    { channels: [] },
    { channels: [{ id: 1 }, { id: 2 }] },
    { accounts: [] },
    { accounts: [{ id: 1 }, { id: 2 }] },
    { models: CODEX_MODELS.slice(0, 2).map((name, index) => ({ id: index + 1, name, bindings: [] })) },
  ]) {
    const db = fixture(options)
    await assert.rejects(configureCodexResponses({ db }))
    assert.equal(db.calls.some((call) => call[1]?.startsWith('UPDATE')), false)
    assert.equal(db.calls.some((call) => call[1]?.startsWith('INSERT')), false)
    assert.equal(db.calls.at(-1)[0], 'rollback')
  }
})

test('写入异常回滚，协议和绑定合并函数不丢失已有信息', async () => {
  const db = fixture({ fail: (query) => query.startsWith('INSERT INTO model_routes') })
  await assert.rejects(configureCodexResponses({ db }), /forced database failure/)
  assert.equal(db.calls.at(-1)[0], 'rollback')
  assert.deepEqual(addMissingProtocol(['chat', 'responses'], 'responses'), ['chat', 'responses'])
  assert.deepEqual(addMissingProtocol(['chat'], 'responses'), ['chat', 'responses'])
  const original = [{ channelId: 7, upstreamModel: 'other', priority: 4, weight: 6, status: 0 }]
  assert.deepEqual(appendMissingBinding(original, 7, 'ignored'), { bindings: original, changed: false })
  assert.deepEqual(appendMissingBinding(original, 8, 'new').bindings, [...original, { channelId: 8, upstreamModel: 'new', priority: 0, weight: 1, status: 1 }])
})

test('损坏的历史协议或 binding JSON 失败回滚，不猜测覆盖', async () => {
  for (const options of [
    { channels: [{ id: 41, protocol: 'chat', protocols: '{not-json' }] },
    { models: CODEX_MODELS.map((name, index) => ({ id: index + 1, name, bindings: '{not-json' })) },
  ]) {
    const db = fixture(options)
    await assert.rejects(configureCodexResponses({ db }), /不是合法 JSON/)
    assert.equal(db.calls.at(-1)[0], 'rollback')
  }
})
