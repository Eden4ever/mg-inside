import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildUpstreamUrl,
  normalizeChannelProtocols,
} from '../src/common/utils/upstream-protocol.util'

test('上游 URL 对带或不带 /v1 的 Base URL 只拼接一次版本前缀', () => {
  assert.equal(
    buildUpstreamUrl('https://www.cctq.ai/v1', '/responses'),
    'https://www.cctq.ai/v1/responses',
  )
  assert.equal(
    buildUpstreamUrl('https://api.deepseek.com/', 'chat/completions'),
    'https://api.deepseek.com/v1/chat/completions',
  )
})

test('渠道协议兼容旧单值字段并支持三种原生协议', () => {
  assert.deepEqual(normalizeChannelProtocols({ protocol: 'chat' }), ['chat'])
  assert.deepEqual(
    normalizeChannelProtocols({
      protocol: 'chat',
      protocols: ['chat', 'responses', 'chat'],
    }),
    ['chat', 'responses'],
  )
  assert.deepEqual(
    normalizeChannelProtocols({
      protocol: 'anthropic',
      protocols: ['anthropic', 'chat', 'anthropic'],
    }),
    ['anthropic', 'chat'],
  )
})

test('渠道协议拒绝未知值', () => {
  assert.throws(
    () => normalizeChannelProtocols({ protocols: ['unknown' as any] }),
    /不支持的渠道协议/,
  )
})
