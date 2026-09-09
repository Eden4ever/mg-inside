import { Injectable, OnModuleInit } from '@nestjs/common'
import axios from 'axios'
import {
  SupplierAccountOptionalDataSource,
  SupplierAccountOptionalDataWarning,
  SupplierAccountSnapshot,
} from '@/common/types/supplier-account.types'
import {
  SupplierAccountAdapter,
  SupplierAccountAdapterError,
} from '@/modules/supplier-account/supplier-account-adapter'
import { SupplierAccountAdapterRegistry } from '@/modules/supplier-account/supplier-account-adapter.registry'
import {
  buildCctqApiKeyModels,
  buildCctqApiKeyBalanceSnapshot,
  buildCctqApiKeyUsageSnapshot,
  buildCctqRemoteSnapshot,
  CCTQ_API_KEY_MODELS_PATH,
  CCTQ_API_KEY_USAGE_PATH,
  CCTQ_BASE_URL,
  classifyCctqApiKeyError,
  classifyCctqError,
} from './cctq-account.policy'

@Injectable()
export class CctqAccountAdapter implements SupplierAccountAdapter, OnModuleInit {
  readonly code = 'cctq'
  readonly supplierCode = 'cctq'
  readonly displayName = 'CCTQ Dashboard'
  readonly credentialLabel = 'Dashboard Token'
  readonly baseUrl = CCTQ_BASE_URL
  readonly capabilities = { configuration: true, balanceSync: true } as const
  readonly defaults = {
    syncIntervalMinutes: 10,
    quotaDisplayType: 'CNY',
    quotaPerUnit: 500000,
  } as const

  constructor(private readonly registry: SupplierAccountAdapterRegistry) {}

  onModuleInit() {
    this.registry.register(this)
  }

  async fetchSnapshot(credential: string): Promise<SupplierAccountSnapshot> {
    let account: any
    let status: any
    let stats: any
    try {
      const end = Math.floor(Date.now() / 1000)
      const start = end - 30 * 24 * 60 * 60
      const headers = { Authorization: `Bearer ${credential}`, Accept: 'application/json' }
      ;[account, status, stats] = await Promise.all([
        axios.get(`${CCTQ_BASE_URL}/api/user/self`, { headers, timeout: 10_000 }),
        axios.get(`${CCTQ_BASE_URL}/api/status`, { timeout: 10_000 }),
        axios.get(`${CCTQ_BASE_URL}/api/log/self/stat`, {
          headers,
          params: { start_timestamp: start, end_timestamp: end },
          timeout: 10_000,
        }),
      ])
    } catch (error) {
      const failure = classifyCctqError(error)
      throw new SupplierAccountAdapterError(
        failure.code,
        failure.message,
        failure.credentialInvalid,
      )
    }

    const accountData = account?.data?.data
    const statusData = status?.data?.data
    const statsData = stats?.data?.data
    if (
      !isRecord(accountData)
      || !isRecord(statusData)
      || !isRecord(statsData)
      || !isFiniteNumber(accountData.quota)
      || !isFiniteNumber(accountData.used_quota)
      || !isFiniteNumber(statsData.quota)
    ) {
      throw new SupplierAccountAdapterError('invalid_response', 'CCTQ 账户余额响应格式无效')
    }

    const headers = { Authorization: `Bearer ${credential}`, Accept: 'application/json' }
    const optionalResults = await Promise.allSettled([
      axios.get(`${CCTQ_BASE_URL}/api/user/self/groups`, { headers, timeout: 10_000 }),
      axios.get(`${CCTQ_BASE_URL}/api/user/models`, { headers, timeout: 10_000 }),
      axios.get(`${CCTQ_BASE_URL}/api/subscription/self`, { headers, timeout: 10_000 }),
    ])
    const warnings: SupplierAccountOptionalDataWarning[] = []
    const readOptional = (
      source: SupplierAccountOptionalDataSource,
      result: PromiseSettledResult<any>,
      isValid: (value: unknown) => boolean,
      fallback: unknown,
    ) => {
      if (result.status === 'fulfilled' && isValid(result.value?.data?.data)) {
        return result.value.data.data
      }
      const failure = result.status === 'rejected'
        ? classifyCctqError(result.reason)
        : { code: 'invalid_response', message: 'CCTQ 附加数据响应格式无效' }
      warnings.push({ source, code: failure.code, message: failure.message })
      return fallback
    }
    const groupsData = readOptional('groups', optionalResults[0], isRecord, {})
    const modelsData = readOptional('models', optionalResults[1], Array.isArray, [])
    const subscriptionsData = readOptional('subscriptions', optionalResults[2], isRecord, {})

    let remote
    try {
      remote = buildCctqRemoteSnapshot({
        account: accountData,
        status: statusData,
        stats: statsData,
        groups: groupsData,
        models: modelsData,
        subscriptions: subscriptionsData,
      })
    } catch {
      throw new SupplierAccountAdapterError('invalid_response', 'CCTQ 账户余额响应格式无效')
    }
    return {
      externalAccountId: remote.upstreamAccountId,
      displayName: remote.displayName,
      accountGroup: remote.accountGroup,
      quotaAvailableRaw: remote.quotaAvailableRaw,
      quotaUsedRaw: remote.quotaUsedRaw,
      requestCount: remote.requestCount,
      last30dQuotaRaw: remote.last30dQuotaRaw,
      rpm: remote.rpm,
      tpm: remote.tpm,
      quotaDisplayType: remote.quotaDisplayType,
      quotaPerUnit: remote.quotaPerUnit,
      usdExchangeRate: remote.usdExchangeRate,
      billingPreference: remote.billingPreference,
      subscriptions: remote.subscriptions,
      groups: remote.groups,
      models: remote.models,
      optionalDataWarnings: warnings,
    }
  }

  /**
   * 读取 CCTQ API Key 级额度。Dashboard Token 仍由 fetchSnapshot 处理；
   * 两种凭据不能在没有显式配置字段的情况下自动猜测或互相替换。
   */
  async fetchApiKeyUsage(credential: string) {
    try {
      const response = await axios.get(`${CCTQ_BASE_URL}${CCTQ_API_KEY_USAGE_PATH}`, {
        headers: { Authorization: `Bearer ${credential}`, Accept: 'application/json' },
        timeout: 10_000,
      })
      return buildCctqApiKeyUsageSnapshot(response.data)
    } catch (error) {
      if (error instanceof Error && error.message === 'CCTQ API Key 额度响应格式无效') {
        throw new SupplierAccountAdapterError('invalid_response', error.message)
      }
      const failure = classifyCctqApiKeyError(error)
      throw new SupplierAccountAdapterError(failure.code, failure.message, failure.credentialInvalid)
    }
  }

  /** 独立读取 API Key 当前可见模型；失败不会被误当成余额不足。 */
  async fetchApiKeyModels(credential: string): Promise<string[]> {
    try {
      const response = await axios.get(`${CCTQ_BASE_URL}${CCTQ_API_KEY_MODELS_PATH}`, {
        headers: { Authorization: `Bearer ${credential}`, Accept: 'application/json' },
        timeout: 10_000,
      })
      return buildCctqApiKeyModels(response.data)
    } catch (error) {
      if (error instanceof Error && error.message === 'CCTQ API Key 模型响应格式无效') {
        throw new SupplierAccountAdapterError('invalid_response', error.message)
      }
      const failure = classifyCctqApiKeyError(error)
      throw new SupplierAccountAdapterError(failure.code, failure.message, failure.credentialInvalid)
    }
  }

}

/** CCTQ 令牌级 API Key 适配器，供全局账户显式选择。 */
@Injectable()
export class CctqApiKeyAccountAdapter implements SupplierAccountAdapter, OnModuleInit {
  readonly code = 'cctq-api-key'
  readonly supplierCode = 'cctq'
  readonly displayName = 'CCTQ API Key'
  readonly credentialLabel = 'API Key'
  readonly baseUrl = CCTQ_BASE_URL
  readonly capabilities = { configuration: true, balanceSync: true } as const
  readonly defaults = {
    syncIntervalMinutes: 10,
    quotaDisplayType: 'CNY',
    quotaPerUnit: 500000,
  } as const

  constructor(
    private readonly registry: SupplierAccountAdapterRegistry,
    private readonly apiAdapter: CctqAccountAdapter,
  ) {}

  onModuleInit() {
    this.registry.register(this)
  }

  fetchSnapshot(credential: string): Promise<SupplierAccountSnapshot> {
    return this.apiAdapter.fetchApiKeyUsage(credential)
      .then((usage) => buildCctqApiKeyBalanceSnapshot({
        code: true,
        data: {
          name: usage.name,
          total_granted: usage.totalGrantedRaw,
          total_used: usage.totalUsedRaw,
          total_available: usage.totalAvailableRaw,
          unlimited_quota: usage.unlimitedQuota,
          model_limits: usage.modelLimits,
          model_limits_enabled: usage.modelLimitsEnabled,
          expires_at: usage.expiresAt,
        },
      }))
      .catch((error) => {
        if (error instanceof SupplierAccountAdapterError) throw error
        throw new SupplierAccountAdapterError('invalid_response', 'CCTQ API Key 额度响应格式无效')
      })
  }

  fetchModels(credential: string): Promise<string[]> {
    return this.apiAdapter.fetchApiKeyModels(credential)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'string') return false

  const normalized = value.trim()
  if (!normalized || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(normalized)) {
    return false
  }
  return Number.isFinite(Number(normalized))
}
