import { SupplierAccountSnapshot } from '@/common/types/supplier-account.types'

export interface SupplierAccountAdapterCapabilities {
  configuration: boolean
  balanceSync: boolean
}

export interface SupplierAccountAdapterDefaults {
  syncIntervalMinutes: number
  quotaDisplayType: string
  quotaPerUnit: number
}

/** 供应商账户适配器隔离上游鉴权、接口路径和快照映射。 */
export interface SupplierAccountAdapter {
  readonly code: string
  readonly supplierCode: string
  readonly displayName: string
  readonly credentialLabel: string
  readonly baseUrl: string
  readonly capabilities: SupplierAccountAdapterCapabilities
  readonly defaults: SupplierAccountAdapterDefaults
  fetchSnapshot(credential: string): Promise<SupplierAccountSnapshot>
  /** 可选的独立模型目录同步；失败不应覆盖额度快照。 */
  fetchModels?(credential: string): Promise<string[]>
}

export class SupplierAccountAdapterError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly credentialInvalid = false,
  ) {
    super(message)
    this.name = 'SupplierAccountAdapterError'
  }
}
