import test from 'node:test'
import assert from 'node:assert/strict'
import { RelayService } from '../src/modules/relay/relay.service'

function relayService(models: any[], available: Record<string, boolean>) {
  const pool = {
    hasModel: (model: string, protocol: string) =>
      model === 'e2e-model' && available[protocol] === true,
  }
  const modelGroups = {
    groupNamesByModel: async () => new Map([['e2e-model', ['default']]]),
  }
  return new RelayService(
    pool as any,
    {} as any,
    { find: async () => models } as any,
    modelGroups as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  )
}

function model(overrides: Record<string, unknown> = {}) {
  return {
    name: 'e2e-model',
    status: 1,
    supportsResponses: 1,
    supportsAnthropic: 1,
    ...overrides,
  }
}

test('模型能力与实时 Responses 可用性保持独立', async () => {
  const service = relayService(
    [model()],
    { chat: true, responses: false, anthropic: true },
  )

  const result: any = await service.listModels({ userRole: 'admin' } as any)
  const item = result.data[0]

  assert.equal(item.supports_responses, true)
  assert.equal(item.supports_anthropic, true)
  assert.deepEqual(item.available_protocols, {
    chat: true,
    responses: false,
    anthropic: true,
  })
  assert.equal(item.available_responses, false)
  assert.equal(item.available_anthropic, true)
  assert.equal(item.capabilities.responses_api, true)
  assert.equal(item.capabilities.anthropic_messages_api, true)
  assert.deepEqual(item.capabilities.available_protocols, item.available_protocols)
  assert.equal(item.capabilities.available_responses, false)
  assert.equal(item.capabilities.available_anthropic, true)
})

test('可路由协议可用性逐协议反映 ChannelPoolService.hasModel', async () => {
  const service = relayService(
    [model()],
    { chat: false, responses: true, anthropic: false },
  )

  const result: any = await service.listModels({ userRole: 'admin' } as any)
  const item = result.data[0]

  assert.deepEqual(item.available_protocols, {
    chat: false,
    responses: true,
    anthropic: false,
  })
  assert.equal(item.available_responses, true)
  assert.equal(item.available_anthropic, false)
  assert.deepEqual(item.capabilities.available_protocols, item.available_protocols)
})
