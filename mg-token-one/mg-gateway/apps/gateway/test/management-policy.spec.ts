import test from 'node:test'
import assert from 'node:assert/strict'
import { ChannelController } from '../src/modules/channel/channel.module'
import {
  normalizeChannelBaseUrl,
  normalizeChannelHeaders,
  normalizeChannelPriority,
  normalizeChannelProxy,
  normalizeChannelStatus,
  normalizeChannelWeight,
  parseChannelHeaders,
  parseChannelProxy,
} from '../src/modules/channel/channel-policy'
import { ModelConfigController } from '../src/modules/model-config/model-config.module'
import { CryptoUtil } from '../src/common/utils/crypto.util'
import {
  assertBindingChannelsExist,
  normalizeBinaryFlag,
  normalizeModelBindings,
  normalizeModelName,
} from '../src/modules/model-config/model-policy'

test('渠道策略规范化 Base URL、请求头和数值字段', () => {
  assert.equal(normalizeChannelBaseUrl(' https://api.example.com/v1/// '), 'https://api.example.com/v1')
  assert.equal(
    normalizeChannelHeaders('{"User-Agent":"codex_cli/test","X-App":42}'),
    '{"user-agent":"codex_cli/test","x-app":"42"}',
  )
  assert.deepEqual(parseChannelHeaders(null), {})
  assert.equal(parseChannelProxy(null), false)
  assert.equal(normalizeChannelPriority('3', 0), 3)
  assert.equal(normalizeChannelWeight(2, 1), 2)
  assert.equal(normalizeChannelStatus(0, 1), 0)
  assert.equal(normalizeChannelProxy(' http://proxy.example.com:8080/ '), 'http://proxy.example.com:8080')
  assert.deepEqual(parseChannelProxy('https://user:pass@proxy.example.com'), {
    protocol: 'https',
    host: 'proxy.example.com',
    port: 443,
    auth: { username: 'user', password: 'pass' },
  })
})

test('渠道策略拒绝危险请求头、注入字符和非法数值', () => {
  assert.throws(() => normalizeChannelHeaders('{"Authorization":"secret"}'), /禁止配置敏感请求头/)
  assert.throws(() => normalizeChannelHeaders('{"x-forwarded-for":"127.0.0.1"}'), /禁止配置敏感请求头/)
  assert.throws(() => normalizeChannelHeaders('{"x-app":"ok\\r\\nbad"}'), /值无效/)
  assert.throws(() => normalizeChannelHeaders('{"Content-Type":"text/plain"}'), /禁止配置敏感请求头/)
  assert.throws(() => normalizeChannelBaseUrl('https://user:pass@example.com'), /用户名或密码/)
  assert.throws(() => normalizeChannelBaseUrl('https://example.com?token=secret'), /查询参数或片段/)
  assert.throws(() => normalizeChannelProxy('socks5://proxy.example.com'), /只支持 http 或 https/)
  assert.throws(() => normalizeChannelProxy('http://proxy.example.com/path'), /只能包含/)
  assert.throws(() => normalizeChannelPriority(-1, 0), /非负整数/)
  assert.throws(() => normalizeChannelWeight(0, 1), /1-1000/)
  assert.throws(() => normalizeChannelWeight(1001, 1), /1-1000/)
  assert.throws(() => normalizeChannelStatus(2, 1), /0 或 1/)
})

test('模型策略拒绝空模型名、重复渠道和不存在的绑定', () => {
  assert.throws(() => normalizeModelName('  '), /模型名必填/)
  assert.throws(
    () => normalizeModelBindings([
      { channelId: 1, upstreamModel: 'first' },
      { channelId: 1, upstreamModel: 'second' },
    ]),
    /不能重复绑定/,
  )
  const bindings = normalizeModelBindings([{
    channelId: 2,
    upstreamModel: ' upstream ',
    priority: 3,
    weight: 4,
    status: 0,
  }])
  assert.deepEqual(bindings, [{
    channelId: 2,
    upstreamModel: 'upstream',
    priority: 3,
    weight: 4,
    status: 0,
  }])
  assert.throws(
    () => normalizeModelBindings([{ channelId: 3, upstreamModel: 'test', weight: 0 }]),
    /weight 必须是 1-1000/,
  )
  assert.throws(
    () => normalizeModelBindings([{ channelId: 3, upstreamModel: 'test', status: 2 }]),
    /status 必须是 0 或 1/,
  )
  assert.throws(() => assertBindingChannelsExist(bindings, [1]), /绑定渠道不存在：2/)
  assert.equal(normalizeBinaryFlag('1'), 1)
  assert.throws(() => normalizeBinaryFlag(true), /能力开关必须是 0 或 1/)
})

test('渠道管理接口拒绝危险自定义头', async () => {
  const controller = new ChannelController(
    {} as any,
    {} as any,
    { jwt: { secret: 'test-secret' } } as any,
    { refresh: async () => {} } as any,
    { requireSupplierAccount: async (value: unknown) => value ?? null, catalog: async () => ({ supplierAccounts: [] }) } as any,
    {} as any,
  )
  await assert.rejects(
    () => controller.create({
      name: 'unsafe',
      baseUrl: 'https://api.example.com',
      keysText: 'key',
      headersJson: '{"x-api-key":"override"}',
    }),
    /禁止配置敏感请求头/,
  )
})

test('渠道列表遇到无法解密的历史密钥时仍返回其余管理信息', async () => {
  const controller = new ChannelController(
    {
      findAndCount: async () => [[{
        id: 7,
        name: '历史渠道',
        supplierAccountId: 3,
        keysEncrypted: CryptoUtil.encrypt('legacy-key', 'old-secret'),
      }], 1],
    } as any,
    {} as any,
    { jwt: { secret: 'current-secret' } } as any,
    { health: () => ({ status: 'credential_unreadable', canRecover: false }) } as any,
    {
      requireSupplierAccount: async () => null,
      catalog: async () => ({
        supplierAccounts: [{ id: 3, supplierName: 'CCTQ', name: '全局账户' }],
      }),
    } as any,
    {} as any,
  )

  const result = await controller.list({ page: 1, pageSize: 10 })

  assert.equal(result.total, 1)
  assert.equal(result.list[0].keysEncrypted, undefined)
  assert.equal(result.list[0].keyCount, null)
  assert.equal(result.list[0].keyStatus, 'unreadable')
  assert.equal(result.list[0].health.status, 'credential_unreadable')
  assert.equal(result.list[0].supplierAccountName, 'CCTQ / 全局账户')
})

test('渠道列表按供应商账户过滤', async () => {
  let findOptions: any
  const controller = new ChannelController(
    {
      findAndCount: async (options: any) => {
        findOptions = options
        return [[], 0]
      },
    } as any,
    {} as any,
    { jwt: { secret: 'current-secret' } } as any,
    {} as any,
    {
      requireSupplierAccount: async (value: unknown) => Number(value),
      catalog: async () => ({ supplierAccounts: [] }),
    } as any,
    {} as any,
  )

  await controller.list({ page: 2, pageSize: 20, supplierAccountId: 4 } as any)

  assert.deepEqual(findOptions.where, { supplierAccountId: 4 })
  assert.equal(findOptions.skip, 20)
  assert.equal(findOptions.take, 20)
})

test('删除仍被模型引用的渠道返回冲突', async () => {
  let deleted = false
  const controller = new ChannelController(
    { delete: async () => { deleted = true } } as any,
    {
      find: async () => [{
        name: 'gpt-test',
        bindings: [{ channelId: 7, upstreamModel: 'gpt-upstream', priority: 0 }],
      }],
    } as any,
    { jwt: { secret: 'test-secret' } } as any,
    { refresh: async () => {} } as any,
    { requireSupplierAccount: async (value: unknown) => value ?? null, catalog: async () => ({ supplierAccounts: [] }) } as any,
    { modelNamesReferencingChannel: async () => ['gpt-test'] } as any,
  )
  await assert.rejects(() => controller.remove('7'), /渠道仍被模型引用：gpt-test/)
  assert.equal(deleted, false)
})

test('手动恢复渠道仅清除熔断状态并返回新健康快照', async () => {
  let recoveredId: number | null = null
  const health = {
    status: 'healthy',
    consecutiveErrors: 0,
    disabledUntil: null,
    canRecover: false,
  }
  const controller = new ChannelController(
    { findOne: async ({ where }: any) => where.id === 7 ? { id: 7 } : null } as any,
    {} as any,
    { jwt: { secret: 'test-secret' } } as any,
    {
      recover: async (id: number) => {
        recoveredId = id
        return health
      },
    } as any,
    {} as any,
    {} as any,
  )

  const result = await controller.recover('7')

  assert.equal(recoveredId, 7)
  assert.deepEqual(result, { ok: true, health })
  await assert.rejects(() => controller.recover('99'), /渠道不存在/)
})

test('模型管理接口拒绝指向不存在渠道的 binding', async () => {
  const controller = new ModelConfigController(
    {} as any,
    { find: async () => [] } as any,
    { refresh: async () => {} } as any,
    {
      validateGroupNames: async (names: string[]) => names,
      syncModelGroups: async (model: any) => model,
    } as any,
    { requireModelOwner: async (value: unknown) => value ?? null, catalog: async () => ({ modelOwners: [] }) } as any,
    {} as any,
  )
  await assert.rejects(
    () => controller.create({
      name: 'gpt-test',
      bindings: [{ channelId: 99, upstreamModel: 'gpt-upstream' }],
    }),
    /绑定渠道不存在：99/,
  )
})
