export interface SupplierGroupSnapshot {
  name: string
  ratio: number | string
  description: string
}

export interface SupplierSubscriptionSnapshot {
  id: string | number | null
  name: string
  status: string
  quotaRaw: number | null
  usedQuotaRaw: number | null
  startsAt: number | string | null
  endsAt: number | string | null
}

export interface SupplierAccountSnapshot {
  externalAccountId: number | null
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
  /** 仅 CCTQ API Key 账户使用；true 时额度数值不代表可用额度上限。 */
  unlimitedQuota?: boolean
  /** Unix 秒；0 表示永不过期。 */
  expiresAt?: number
  modelLimits?: Record<string, unknown>
  modelLimitsEnabled?: boolean
  /** 附加信息拉取失败时，由 CCTQ 服务保留已有字段并记录脱敏告警。 */
  optionalDataWarnings?: SupplierAccountOptionalDataWarning[]
}

export type SupplierAccountOptionalDataSource = 'groups' | 'models' | 'subscriptions'

export interface SupplierAccountOptionalDataWarning {
  source: SupplierAccountOptionalDataSource
  code: string
  message: string
}

export type SupplierKind = 'official' | 'third_party'
export type SupplierAccountStatus = 'unconfigured' | 'healthy' | 'credential_invalid' | 'stale'
export type SupplierAccountDirectoryStatus = SupplierAccountStatus | 'manual' | 'disabled'

export interface SupplierAccountSummary {
  id: number
  code: string
  supplierId: number
  supplierCode: string
  supplierName: string
  supplierKind: SupplierKind
  adapterCode: string
  supportsDetail: boolean
  name: string
  accountName: string | null
  configured: boolean
  enabled: boolean
  routingEnabled: boolean
  status: SupplierAccountDirectoryStatus
  quotaAvailableRaw: number | null
  quotaDisplayType: string
  quotaPerUnit: number
  modelCount: number
  lastSyncAt: Date | string | null
}
