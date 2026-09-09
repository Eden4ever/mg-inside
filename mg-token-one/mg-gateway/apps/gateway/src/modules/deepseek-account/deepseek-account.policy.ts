import { SupplierAccountSnapshot } from '@/common/types/supplier-account.types'

export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com'

function moneyToMinor(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error('DeepSeek 余额响应格式无效')
  }
  return Math.round(parsed * 100)
}

export function buildDeepSeekBalanceSnapshot(input: any): SupplierAccountSnapshot {
  const balances = Array.isArray(input?.balance_infos) ? input.balance_infos : []
  const selected = balances.find((item: any) => item?.currency === 'CNY') || balances[0]
  if (!selected || typeof selected !== 'object') {
    throw new Error('DeepSeek 余额响应格式无效')
  }
  const currency = String(selected.currency || '').trim().toUpperCase()
  if (!currency) throw new Error('DeepSeek 余额响应格式无效')
  return {
    externalAccountId: null,
    displayName: 'DeepSeek API',
    accountGroup: null,
    quotaAvailableRaw: moneyToMinor(selected?.total_balance),
    quotaUsedRaw: 0,
    requestCount: 0,
    last30dQuotaRaw: 0,
    rpm: 0,
    tpm: 0,
    quotaDisplayType: currency,
    quotaPerUnit: 100,
    usdExchangeRate: 1,
    billingPreference: input?.is_available === false ? 'unavailable' : 'available',
    subscriptions: [],
    groups: [],
    models: [],
  }
}

export function classifyDeepSeekBalanceError(error: any) {
  const status = Number(error?.response?.status || 0)
  if (status === 401 || status === 403) {
    return { code: 'credential_invalid', message: 'DeepSeek API Key 无效或无余额查询权限', credentialInvalid: true }
  }
  if (status === 429) {
    return { code: 'rate_limited', message: 'DeepSeek 余额查询请求过于频繁', credentialInvalid: false }
  }
  if (status >= 500) {
    return { code: 'upstream_unavailable', message: `DeepSeek 暂不可用（HTTP ${status}）`, credentialInvalid: false }
  }
  if (error?.code === 'ECONNABORTED') {
    return { code: 'timeout', message: 'DeepSeek 余额查询超时', credentialInvalid: false }
  }
  if (!status) {
    return { code: 'network_error', message: '无法连接 DeepSeek', credentialInvalid: false }
  }
  return { code: 'sync_failed', message: `DeepSeek 余额同步失败（HTTP ${status}）`, credentialInvalid: false }
}
