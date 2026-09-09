import {
  SupplierGroupSnapshot,
  SupplierSubscriptionSnapshot,
  SupplierAccountSnapshot,
} from '@/common/types/supplier-account.types'

export const CCTQ_BASE_URL = 'https://www.cctq.ai'
export const CCTQ_DEFAULT_SYNC_INTERVAL_MINUTES = 10
export const CCTQ_API_KEY_USAGE_PATH = '/api/usage/token/'
export const CCTQ_API_KEY_MODELS_PATH = '/v1/models'

export interface CctqRemoteSnapshot {
  upstreamAccountId: number | null
  displayName: string | null
  accountGroup: string | null
  quotaAvailableRaw: number
  quotaUsedRaw: number
  requestCount: number
  last30dQuotaRaw: number
  rpm: number
  tpm: number
  quotaDisplayType: string
  quotaPerUnit: number
  usdExchangeRate: number
  billingPreference: string | null
  subscriptions: SupplierSubscriptionSnapshot[]
  groups: SupplierGroupSnapshot[]
  models: string[]
}

/**
 * CCTQ New API 的 API Key 级额度响应。该契约与 Dashboard 账户响应分开，
 * 避免把账户级接口的字段猜测套用到令牌级余额。
 */
export interface CctqApiKeyUsageSnapshot {
  name: string | null
  totalGrantedRaw: number
  totalUsedRaw: number
  totalAvailableRaw: number
  unlimitedQuota: boolean
  modelLimits: Record<string, unknown>
  modelLimitsEnabled: boolean
  expiresAt: number
}

function finiteNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function nullableText(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  return text || null
}

export function normalizeSyncInterval(value: unknown): number {
  const parsed = Math.trunc(finiteNumber(value, CCTQ_DEFAULT_SYNC_INTERVAL_MINUTES))
  if (parsed < 5 || parsed > 1440) {
    throw new Error('同步间隔必须在 5-1440 分钟之间')
  }
  return parsed
}

export function buildCctqRemoteSnapshot(input: {
  account: any
  status: any
  stats: any
  groups: any
  models: any
  subscriptions: any
}): CctqRemoteSnapshot {
  const groupEntries = input.groups && typeof input.groups === 'object'
    ? Object.entries(input.groups)
    : []
  const groups = groupEntries.map(([name, value]: [string, any]) => ({
    name,
    ratio: typeof value?.ratio === 'number' || typeof value?.ratio === 'string'
      ? value.ratio
      : '',
    description: nullableText(value?.desc) || '',
  }))

  const modelNames = Array.isArray(input.models)
    ? [...new Set(input.models.map((item) => String(item).trim()).filter(Boolean))]
    : []
  const rawSubscriptions = Array.isArray(input.subscriptions?.subscriptions)
    ? input.subscriptions.subscriptions
    : []
  const subscriptions = rawSubscriptions.map((item: any) => ({
    id: item?.id ?? item?.subscription_id ?? null,
    name: nullableText(item?.plan_name ?? item?.plan?.name ?? item?.name) || '未命名套餐',
    status: nullableText(item?.status) || 'unknown',
    quotaRaw: nullableNumber(item?.quota ?? item?.total_quota),
    usedQuotaRaw: nullableNumber(item?.used_quota),
    startsAt: item?.starts_at ?? item?.start_time ?? null,
    endsAt: item?.ends_at ?? item?.end_time ?? item?.expires_at ?? null,
  }))

  return {
    upstreamAccountId: nullableNumber(input.account?.id),
    displayName: nullableText(input.account?.display_name ?? input.account?.username),
    accountGroup: nullableText(input.account?.group),
    quotaAvailableRaw: finiteNumber(input.account?.quota),
    quotaUsedRaw: finiteNumber(input.account?.used_quota),
    requestCount: finiteNumber(input.account?.request_count),
    last30dQuotaRaw: finiteNumber(input.stats?.quota),
    rpm: finiteNumber(input.stats?.rpm),
    tpm: finiteNumber(input.stats?.tpm),
    quotaDisplayType: nullableText(input.status?.quota_display_type) || 'CNY',
    quotaPerUnit: Math.max(1, finiteNumber(input.status?.quota_per_unit, 500000)),
    usdExchangeRate: Math.max(0.000001, finiteNumber(input.status?.usd_exchange_rate, 1)),
    billingPreference: nullableText(input.subscriptions?.billing_preference),
    subscriptions,
    groups,
    models: modelNames,
  }
}

export function buildCctqApiKeyUsageSnapshot(input: any): CctqApiKeyUsageSnapshot {
  const data = unwrapCctqData(input)
  const totalGrantedRaw = nonNegativeNumber(data.total_granted)
  const totalUsedRaw = nonNegativeNumber(data.total_used)
  const totalAvailableRaw = nonNegativeNumber(data.total_available)
  if (
    totalGrantedRaw === null
    || totalUsedRaw === null
    || totalAvailableRaw === null
    || typeof data.unlimited_quota !== 'boolean'
    || typeof data.model_limits_enabled !== 'boolean'
  ) {
    throw new Error('CCTQ API Key 额度响应格式无效')
  }

  const modelLimits = data.model_limits === undefined || data.model_limits === null
    ? {}
    : data.model_limits
  if (!isRecord(modelLimits)) throw new Error('CCTQ API Key 额度响应格式无效')

  const expiresAt = data.expires_at === undefined || data.expires_at === null
    ? 0
    : finiteNumber(data.expires_at, Number.NaN)
  if (!Number.isFinite(expiresAt) || expiresAt < 0) {
    throw new Error('CCTQ API Key 额度响应格式无效')
  }

  return {
    name: nullableText(data.name),
    totalGrantedRaw,
    totalUsedRaw,
    totalAvailableRaw,
    unlimitedQuota: data.unlimited_quota,
    modelLimits,
    modelLimitsEnabled: data.model_limits_enabled,
    expiresAt,
  }
}

/** 解析 OpenAI 兼容的 /v1/models 响应，不静默吞掉非法条目。 */
export function buildCctqApiKeyModels(input: any): string[] {
  if (!isRecord(input) || !Array.isArray(input.data)) {
    throw new Error('CCTQ API Key 模型响应格式无效')
  }
  const names = input.data.map((item: any) => {
    if (!isRecord(item)) throw new Error('CCTQ API Key 模型响应格式无效')
    const id = nullableText(item.id)
    if (!id) throw new Error('CCTQ API Key 模型响应格式无效')
    return id
  })
  return [...new Set(names)]
}

/** 将令牌级额度与独立模型目录合并成账户快照契约。 */
export function buildCctqApiKeyBalanceSnapshot(input: any): SupplierAccountSnapshot {
  const usage = buildCctqApiKeyUsageSnapshot(input)
  return {
    externalAccountId: null,
    displayName: usage.name || 'CCTQ API Key',
    accountGroup: null,
    quotaAvailableRaw: usage.totalAvailableRaw,
    quotaUsedRaw: usage.totalUsedRaw,
    requestCount: 0,
    last30dQuotaRaw: 0,
    rpm: 0,
    tpm: 0,
    quotaDisplayType: 'CNY',
    quotaPerUnit: 500000,
    usdExchangeRate: 1,
    billingPreference: null,
    subscriptions: [],
    groups: [],
    models: [],
    unlimitedQuota: usage.unlimitedQuota,
    expiresAt: usage.expiresAt,
    modelLimits: usage.modelLimits,
    modelLimitsEnabled: usage.modelLimitsEnabled,
  }
}

function unwrapCctqData(input: any): Record<string, any> {
  if (!isRecord(input) || input.code !== true || !isRecord(input.data)) {
    throw new Error('CCTQ API Key 额度响应格式无效')
  }
  return input.data
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function nonNegativeNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

export function classifyCctqError(error: any): {
  code: string
  message: string
  credentialInvalid: boolean
} {
  const status = Number(error?.response?.status || 0)
  if (status === 401 || status === 403) {
    return {
      code: 'credential_invalid',
      message: 'CCTQ Dashboard Access Token 无效或已过期',
      credentialInvalid: true,
    }
  }
  if (status === 429) {
    return { code: 'rate_limited', message: 'CCTQ 请求过于频繁', credentialInvalid: false }
  }
  if (status >= 500) {
    return { code: 'upstream_unavailable', message: `CCTQ 暂不可用（HTTP ${status}）`, credentialInvalid: false }
  }
  if (error?.code === 'ECONNABORTED') {
    return { code: 'timeout', message: 'CCTQ 请求超时', credentialInvalid: false }
  }
  if (!status) {
    return { code: 'network_error', message: '无法连接 CCTQ', credentialInvalid: false }
  }
  return { code: 'sync_failed', message: `CCTQ 同步失败（HTTP ${status}）`, credentialInvalid: false }
}

export function classifyCctqApiKeyError(error: any) {
  const failure = classifyCctqError(error)
  if (failure.code === 'credential_invalid') {
    return {
      ...failure,
      message: 'CCTQ API Key 无效或无余额查询权限',
    }
  }
  return failure
}
