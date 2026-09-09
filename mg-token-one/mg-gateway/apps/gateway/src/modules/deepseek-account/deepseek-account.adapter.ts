import { Injectable, OnModuleInit } from '@nestjs/common'
import axios from 'axios'
import {
  SupplierAccountAdapter,
  SupplierAccountAdapterError,
} from '@/modules/supplier-account/supplier-account-adapter'
import { SupplierAccountAdapterRegistry } from '@/modules/supplier-account/supplier-account-adapter.registry'
import {
  buildDeepSeekBalanceSnapshot,
  classifyDeepSeekBalanceError,
  DEEPSEEK_BASE_URL,
} from './deepseek-account.policy'

@Injectable()
export class DeepSeekAccountAdapter implements SupplierAccountAdapter, OnModuleInit {
  readonly code = 'deepseek'
  readonly supplierCode = 'deepseek'
  readonly displayName = 'DeepSeek 官方 API'
  readonly credentialLabel = 'API Key'
  readonly baseUrl = DEEPSEEK_BASE_URL
  readonly capabilities = { configuration: true, balanceSync: true } as const
  readonly defaults = {
    syncIntervalMinutes: 10,
    quotaDisplayType: 'CNY',
    quotaPerUnit: 100,
  } as const

  constructor(private readonly registry: SupplierAccountAdapterRegistry) {}

  onModuleInit() {
    this.registry.register(this)
  }

  async fetchSnapshot(credential: string) {
    let data: any
    try {
      const response = await axios.get(`${DEEPSEEK_BASE_URL}/user/balance`, {
        headers: { Authorization: `Bearer ${credential}`, Accept: 'application/json' },
        timeout: 10_000,
      })
      data = response.data
    } catch (error) {
      const failure = classifyDeepSeekBalanceError(error)
      throw new SupplierAccountAdapterError(
        failure.code,
        failure.message,
        failure.credentialInvalid,
      )
    }
    try {
      return buildDeepSeekBalanceSnapshot(data)
    } catch {
      throw new SupplierAccountAdapterError(
        'invalid_response',
        'DeepSeek 余额响应格式无效',
      )
    }
  }
}
