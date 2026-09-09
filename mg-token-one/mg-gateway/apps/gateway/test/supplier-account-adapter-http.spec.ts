import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import axios from 'axios'
import { CctqAccountAdapter } from '../src/modules/cctq-account/cctq-account.adapter'
import { DeepSeekAccountAdapter } from '../src/modules/deepseek-account/deepseek-account.adapter'
import { SupplierAccountAdapterError } from '../src/modules/supplier-account/supplier-account-adapter'

type ResponsePlan = {
  status?: number
  body: unknown
  delayMs?: number
}

type RequestRecord = {
  path: string
  authorization?: string
}

type LocalServer = {
  baseUrl: string
  requests: RequestRecord[]
  close: () => Promise<void>
}

const originalAxiosGet = axios.get.bind(axios)
const openServers: LocalServer[] = []

async function createLocalServer(
  plan: ResponsePlan | ((path: string) => ResponsePlan),
): Promise<LocalServer> {
  const requests: RequestRecord[] = []
  const server = http.createServer((request, response) => {
    const parsed = new URL(request.url || '/', 'http://127.0.0.1')
    requests.push({
      path: parsed.pathname,
      authorization: typeof request.headers.authorization === 'string'
        ? request.headers.authorization
        : undefined,
    })
    const selected = typeof plan === 'function' ? plan(parsed.pathname) : plan
    const send = () => {
      response.statusCode = selected.status ?? 200
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify(selected.body))
    }
    if (selected.delayMs) setTimeout(send, selected.delayMs)
    else send()
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('本地测试服务未分配端口')
  const local: LocalServer = {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    }),
  }
  openServers.push(local)
  return local
}

async function withLocalAxios<T>(
  local: LocalServer,
  callback: () => Promise<T>,
  timeoutOverride?: number,
): Promise<T> {
  ;(axios as any).get = (url: string, config: Record<string, any> = {}) => {
    const parsed = new URL(url)
    const mappedUrl = `${local.baseUrl}${parsed.pathname}${parsed.search}`
    return originalAxiosGet(mappedUrl, {
      ...config,
      ...(timeoutOverride === undefined ? {} : { timeout: timeoutOverride }),
    })
  }
  try {
    return await callback()
  } finally {
    ;(axios as any).get = originalAxiosGet
  }
}

function adapterRegistry() {
  return { register: () => {} } as any
}

function cctqPlan(path: string): ResponsePlan {
  const bodies: Record<string, unknown> = {
    '/api/user/self': {
      data: {
        id: 16457,
        display_name: 'CCTQ Contract Test',
        group: 'default',
        quota: 103834469,
        used_quota: 26165531,
        request_count: 2689,
      },
    },
    '/api/status': {
      data: { quota_display_type: 'CNY', quota_per_unit: 500000, usd_exchange_rate: 1 },
    },
    '/api/log/self/stat': { data: { quota: 26165531, rpm: 5, tpm: 621567 } },
    '/api/user/self/groups': { data: { default: { ratio: 1, desc: '默认分组' } } },
    '/api/user/models': { data: ['gpt-contract-test'] },
    '/api/subscription/self': {
      data: { billing_preference: 'subscription_first', subscriptions: [] },
    },
  }
  return { body: bodies[path] ?? { error: 'unexpected path' }, status: bodies[path] ? 200 : 404 }
}

async function assertAdapterError(
  operation: () => Promise<unknown>,
  code: string,
  secret = 'must-not-leak',
) {
  await assert.rejects(operation, (error: unknown) => {
    assert.ok(error instanceof SupplierAccountAdapterError)
    assert.equal(error.code, code)
    assert.doesNotMatch(error.message, new RegExp(secret))
    assert.doesNotMatch(JSON.stringify(error), new RegExp(secret))
    return true
  })
}

before(() => {
  ;(axios as any).get = originalAxiosGet
})

after(async () => {
  ;(axios as any).get = originalAxiosGet
  await Promise.all(openServers.splice(0).map((server) => server.close()))
})

test('CCTQ 适配器通过本地 HTTP 验证全部路径、响应包装和鉴权头', async () => {
  const local = await createLocalServer(cctqPlan)
  const adapter = new CctqAccountAdapter(adapterRegistry())
  const snapshot: any = await withLocalAxios(local, () => adapter.fetchSnapshot('cctq-dashboard-token'))

  assert.equal(snapshot.externalAccountId, 16457)
  assert.equal(snapshot.quotaAvailableRaw, 103834469)
  assert.equal(snapshot.last30dQuotaRaw, 26165531)
  assert.deepEqual(snapshot.models, ['gpt-contract-test'])
  assert.deepEqual(
    new Set(local.requests.map((request) => request.path)),
    new Set([
      '/api/user/self',
      '/api/status',
      '/api/log/self/stat',
      '/api/user/self/groups',
      '/api/user/models',
      '/api/subscription/self',
    ]),
  )
  assert.equal(local.requests.length, 6)
  for (const request of local.requests) {
    if (request.path === '/api/status') assert.equal(request.authorization, undefined)
    else assert.equal(request.authorization, 'Bearer cctq-dashboard-token')
  }
})

test('CCTQ Dashboard 附加接口失败不阻断核心余额快照且告警脱敏', async () => {
  const local = await createLocalServer((path) => {
    if (path === '/api/user/models') return { status: 503, body: { token: 'must-not-leak' } }
    if (path === '/api/user/self/groups') return { body: { data: { default: { ratio: 1, desc: '默认分组' } } } }
    if (path === '/api/subscription/self') return { status: 429, body: { credential: 'must-not-leak' } }
    return cctqPlan(path)
  })
  const adapter = new CctqAccountAdapter(adapterRegistry())
  const snapshot: any = await withLocalAxios(local, () => adapter.fetchSnapshot('cctq-dashboard-token'))

  assert.equal(snapshot.quotaAvailableRaw, 103834469)
  assert.deepEqual(snapshot.groups, [{ name: 'default', ratio: 1, description: '默认分组' }])
  assert.deepEqual(snapshot.models, [])
  assert.deepEqual(snapshot.subscriptions, [])
  assert.deepEqual(
    snapshot.optionalDataWarnings.map((warning: any) => [warning.source, warning.code]),
    [['models', 'upstream_unavailable'], ['subscriptions', 'rate_limited']],
  )
  assert.doesNotMatch(JSON.stringify(snapshot.optionalDataWarnings), /must-not-leak/)
})

for (const status of [401, 429, 503]) {
  test(`CCTQ 适配器将 HTTP ${status} 分类且不泄露响应正文`, async () => {
    const local = await createLocalServer({ status, body: { secret: 'must-not-leak' } })
    const adapter = new CctqAccountAdapter(adapterRegistry())
    const code = status === 401
      ? 'credential_invalid'
      : status === 429
        ? 'rate_limited'
        : 'upstream_unavailable'
    await withLocalAxios(local, () => assertAdapterError(() => adapter.fetchSnapshot('token'), code))
  })
}

test('CCTQ 适配器将本地 HTTP 超时分类且不泄露响应正文', async () => {
  const local = await createLocalServer({ delayMs: 100, body: { secret: 'must-not-leak' } })
  const adapter = new CctqAccountAdapter(adapterRegistry())
  await withLocalAxios(
    local,
    () => assertAdapterError(() => adapter.fetchSnapshot('token'), 'timeout'),
    20,
  )
})

test('CCTQ 适配器拒绝缺少核心响应包装的非法余额响应', async () => {
  const local = await createLocalServer((path) => {
    if (path === '/api/user/self') return { body: { data: { secret: 'must-not-leak' } } }
    return cctqPlan(path)
  })
  const adapter = new CctqAccountAdapter(adapterRegistry())
  await withLocalAxios(
    local,
    () => assertAdapterError(() => adapter.fetchSnapshot('token'), 'invalid_response'),
  )
})

test('CCTQ API Key 适配器独立读取额度与模型目录，并使用 Bearer 鉴权', async () => {
  const local = await createLocalServer((path) => {
    if (path === '/api/usage/token/') {
      return {
        body: {
          code: true,
          message: 'ok',
          data: {
            name: 'api-key-contract',
            total_granted: 1000,
            total_used: 200,
            total_available: 800,
            unlimited_quota: false,
            model_limits: {},
            model_limits_enabled: false,
            expires_at: 0,
          },
        },
      }
    }
    if (path === '/v1/models') {
      return { body: { object: 'list', data: [{ id: 'gpt-5.6-terra' }, { id: 'claude-sonnet-5' }] } }
    }
    return { status: 404, body: { secret: 'must-not-leak' } }
  })
  const adapter = new CctqAccountAdapter(adapterRegistry())
  const usage: any = await withLocalAxios(local, () => adapter.fetchApiKeyUsage('cctq-api-key'))
  const models = await withLocalAxios(local, () => adapter.fetchApiKeyModels('cctq-api-key'))

  assert.equal(usage.totalAvailableRaw, 800)
  assert.deepEqual(models, ['gpt-5.6-terra', 'claude-sonnet-5'])
  assert.deepEqual(
    local.requests.map((request) => [request.path, request.authorization]),
    [
      ['/api/usage/token/', 'Bearer cctq-api-key'],
      ['/v1/models', 'Bearer cctq-api-key'],
    ],
  )
})

test('CCTQ API Key 模型目录失败时独立报错，不改写额度契约', async () => {
  const local = await createLocalServer((path) => path === '/api/usage/token/'
    ? {
        body: {
          code: true,
          data: {
            total_granted: 1000,
            total_used: 200,
            total_available: 800,
            unlimited_quota: false,
            model_limits: {},
            model_limits_enabled: false,
            expires_at: 0,
          },
        },
      }
    : { status: 503, body: { secret: 'must-not-leak' } })
  const adapter = new CctqAccountAdapter(adapterRegistry())
  const usage: any = await withLocalAxios(local, () => adapter.fetchApiKeyUsage('cctq-api-key'))
  assert.equal(usage.totalAvailableRaw, 800)
  await withLocalAxios(
    local,
    () => assertAdapterError(() => adapter.fetchApiKeyModels('cctq-api-key'), 'upstream_unavailable'),
  )
})

test('CCTQ 适配器拒绝非数值余额，避免把上游格式变化当作零余额', async () => {
  const local = await createLocalServer((path) => {
    const response = cctqPlan(path)
    if (path === '/api/user/self') {
      return { body: { data: { ...((response.body as any).data), quota: 'not-a-number' } } }
    }
    return response
  })
  const adapter = new CctqAccountAdapter(adapterRegistry())
  await withLocalAxios(
    local,
    () => assertAdapterError(() => adapter.fetchSnapshot('token'), 'invalid_response'),
  )
})

test('CCTQ 适配器接受核心余额字段中的有限数值字符串', async () => {
  const local = await createLocalServer((path) => {
    const response = cctqPlan(path)
    if (path === '/api/user/self') {
      return {
        body: {
          data: {
            ...((response.body as any).data),
            quota: '103834469.25',
            used_quota: '-26165531.5',
          },
        },
      }
    }
    if (path === '/api/log/self/stat') {
      return { body: { data: { quota: '2.5e+7', rpm: 5, tpm: 621567 } } }
    }
    return response
  })
  const adapter = new CctqAccountAdapter(adapterRegistry())
  const snapshot: any = await withLocalAxios(local, () => adapter.fetchSnapshot('token'))

  assert.equal(snapshot.quotaAvailableRaw, 103834469.25)
  assert.equal(snapshot.quotaUsedRaw, -26165531.5)
  assert.equal(snapshot.last30dQuotaRaw, 25000000)
})

const invalidCctqCoreValues: Array<[string, unknown]> = [
  ['null', null],
  ['undefined', undefined],
  ['空字符串', ''],
  ['空白字符串', '   '],
  ['true', true],
  ['false', false],
  ['NaN 字符串', 'NaN'],
  ['Infinity 字符串', 'Infinity'],
  ['-Infinity 字符串', '-Infinity'],
]

for (const [label, value] of invalidCctqCoreValues) {
  test(`CCTQ 适配器拒绝 quota 为${label}`, async () => {
    const local = await createLocalServer((path) => {
      const response = cctqPlan(path)
      if (path === '/api/user/self') {
        return { body: { data: { ...((response.body as any).data), quota: value } } }
      }
      return response
    })
    const adapter = new CctqAccountAdapter(adapterRegistry())
    await withLocalAxios(
      local,
      () => assertAdapterError(() => adapter.fetchSnapshot('token'), 'invalid_response'),
    )
  })

  test(`CCTQ 适配器拒绝 used_quota 为${label}`, async () => {
    const local = await createLocalServer((path) => {
      const response = cctqPlan(path)
      if (path === '/api/user/self') {
        return { body: { data: { ...((response.body as any).data), used_quota: value } } }
      }
      return response
    })
    const adapter = new CctqAccountAdapter(adapterRegistry())
    await withLocalAxios(
      local,
      () => assertAdapterError(() => adapter.fetchSnapshot('token'), 'invalid_response'),
    )
  })

  test(`CCTQ 适配器拒绝 stats.quota 为${label}`, async () => {
    const local = await createLocalServer((path) => {
      const response = cctqPlan(path)
      if (path === '/api/log/self/stat') {
        return { body: { data: { ...((response.body as any).data), quota: value } } }
      }
      return response
    })
    const adapter = new CctqAccountAdapter(adapterRegistry())
    await withLocalAxios(
      local,
      () => assertAdapterError(() => adapter.fetchSnapshot('token'), 'invalid_response'),
    )
  })
}

test('DeepSeek 适配器通过本地 HTTP 验证准确路径、响应和 Bearer 鉴权', async () => {
  const local = await createLocalServer({
    body: {
      is_available: true,
      balance_infos: [{ currency: 'CNY', total_balance: '56.789' }],
    },
  })
  const adapter = new DeepSeekAccountAdapter(adapterRegistry())
  const snapshot: any = await withLocalAxios(local, () => adapter.fetchSnapshot('deepseek-api-key'))

  assert.equal(snapshot.quotaAvailableRaw, 5679)
  assert.deepEqual(local.requests, [{ path: '/user/balance', authorization: 'Bearer deepseek-api-key' }])
})

for (const status of [401, 429, 503]) {
  test(`DeepSeek 适配器将 HTTP ${status} 分类且不泄露响应正文`, async () => {
    const local = await createLocalServer({ status, body: { secret: 'must-not-leak' } })
    const adapter = new DeepSeekAccountAdapter(adapterRegistry())
    const code = status === 401
      ? 'credential_invalid'
      : status === 429
        ? 'rate_limited'
        : 'upstream_unavailable'
    await withLocalAxios(local, () => assertAdapterError(() => adapter.fetchSnapshot('key'), code))
  })
}

test('DeepSeek 适配器将本地 HTTP 超时分类且不泄露响应正文', async () => {
  const local = await createLocalServer({ delayMs: 100, body: { secret: 'must-not-leak' } })
  const adapter = new DeepSeekAccountAdapter(adapterRegistry())
  await withLocalAxios(
    local,
    () => assertAdapterError(() => adapter.fetchSnapshot('key'), 'timeout'),
    20,
  )
})

test('DeepSeek 适配器拒绝非法余额响应', async () => {
  const local = await createLocalServer({ body: { data: { secret: 'must-not-leak' } } })
  const adapter = new DeepSeekAccountAdapter(adapterRegistry())
  await withLocalAxios(
    local,
    () => assertAdapterError(() => adapter.fetchSnapshot('key'), 'invalid_response'),
  )
})
