import { Injectable } from '@nestjs/common'
import { SupplierAccountAdapter } from './supplier-account-adapter'

@Injectable()
export class SupplierAccountAdapterRegistry {
  private readonly adapters = new Map<string, SupplierAccountAdapter>()

  register(adapter: SupplierAccountAdapter) {
    const code = this.normalizeCode(adapter.code)
    const existing = this.adapters.get(code)
    if (existing && existing !== adapter) {
      throw new Error(`供应商账户适配器重复注册：${code}`)
    }
    this.adapters.set(code, adapter)
  }

  get(code: string): SupplierAccountAdapter | null {
    return this.adapters.get(this.normalizeCode(code)) || null
  }

  require(code: string): SupplierAccountAdapter {
    const adapter = this.get(code)
    if (!adapter) throw new Error(`供应商账户适配器未注册：${code}`)
    return adapter
  }

  supportsConfiguration(code: string): boolean {
    return this.get(code)?.capabilities.configuration === true
  }

  catalog() {
    return [...this.adapters.values()]
      .map((adapter) => ({
        code: adapter.code,
        supplierCode: adapter.supplierCode,
        displayName: adapter.displayName,
        credentialLabel: adapter.credentialLabel,
        baseUrl: adapter.baseUrl,
        capabilities: { ...adapter.capabilities },
        defaults: { ...adapter.defaults },
      }))
      .sort((a, b) => a.code.localeCompare(b.code))
  }

  private normalizeCode(value: unknown): string {
    const code = String(value || '').trim().toLowerCase()
    if (!code) throw new Error('供应商账户适配器编码不能为空')
    return code
  }
}
