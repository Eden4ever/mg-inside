import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { SupplierAccountSummary } from '@/common/types/supplier-account.types'
import { Supplier } from '@/entities/supplier.entity'
import { SupplierAccount } from '@/entities/supplier-account.entity'
import { ChannelPoolService } from '@/modules/relay/channel-pool.service'
import { SupplierAccountAdapterRegistry } from './supplier-account-adapter.registry'

export interface CreateSupplierAccountInput {
  code?: string
  supplierId?: number
  name?: string
  adapterCode?: string
  routingEnabled?: boolean
}

export interface UpdateSupplierAccountInput {
  name?: string
  routingEnabled?: boolean
}

@Injectable()
export class SupplierAccountDirectoryService {
  constructor(
    @InjectRepository(SupplierAccount)
    private readonly accountRepo: Repository<SupplierAccount>,
    @InjectRepository(Supplier)
    private readonly supplierRepo: Repository<Supplier>,
    private readonly channelPool: ChannelPoolService,
    private readonly adapterRegistry: SupplierAccountAdapterRegistry,
  ) {}

  async list(): Promise<SupplierAccountSummary[]> {
    const [accounts, suppliers] = await Promise.all([
      this.accountRepo.find({ order: { name: 'ASC' } }),
      this.supplierRepo.find({ order: { name: 'ASC' } }),
    ])
    const supplierMap = new Map(suppliers.map((supplier) => [supplier.id, supplier]))

    return accounts.map((account) => {
      const supplier = supplierMap.get(account.supplierId)
      const manual = account.adapterCode === 'manual'
      const routingEnabled = account.routingEnabled !== 0
      return {
        id: Number(account.id),
        code: account.code,
        supplierId: account.supplierId,
        supplierCode: supplier?.code || 'unknown',
        supplierName: supplier?.name || '未知供应商',
        supplierKind: supplier?.kind || 'third_party',
        adapterCode: account.adapterCode,
        supportsDetail: this.adapterRegistry.supportsConfiguration(account.adapterCode),
        name: account.name,
        accountName: account.displayName || account.name || null,
        configured: manual || Boolean(account.credentialEncrypted),
        enabled: account.enabled === 1,
        routingEnabled,
        status: !routingEnabled
          ? 'disabled' as const
          : manual
          ? 'manual' as const
          : this.normalizeStatus(account.lastSyncStatus),
        quotaAvailableRaw: this.nullableNumber(account.quotaAvailableRaw),
        quotaDisplayType: String(account.quotaDisplayType || 'CNY'),
        quotaPerUnit: this.positiveNumber(account.quotaPerUnit, 500000),
        modelCount: Array.isArray(account.models) ? account.models.length : 0,
        lastSyncAt: account.lastSyncAt || null,
      }
    })
  }

  async create(input: CreateSupplierAccountInput): Promise<SupplierAccountSummary> {
    const code = this.normalizeCode(input.code)
    const name = this.normalizeName(input.name)
    const supplierId = this.positiveId(input.supplierId, '供应商')
    const adapterCode = String(input.adapterCode || 'manual').trim().toLowerCase()
    const supplier = await this.supplierRepo.findOne({ where: { id: supplierId } })
    if (!supplier || supplier.status !== 1) {
      throw new BadRequestException(`供应商不存在或已停用：${supplierId}`)
    }
    if (supplier.code === 'cctq') {
      throw new ConflictException('CCTQ 使用唯一全局账户，请在 CCTQ 详情页维护')
    }
    const adapter = adapterCode === 'manual' ? null : this.adapterRegistry.get(adapterCode)
    if (
      adapterCode !== 'manual' &&
      (!adapter?.capabilities.configuration || !adapter.capabilities.balanceSync)
    ) {
      throw new BadRequestException(`供应商账户适配器不可用：${adapterCode}`)
    }
    if (adapter && adapter.supplierCode !== supplier.code) {
      throw new BadRequestException(
        `适配器 ${adapterCode} 不适用于供应商 ${supplier.code}`,
      )
    }
    if (await this.accountRepo.findOne({ where: { code } })) {
      throw new ConflictException(`账户编码已存在：${code}`)
    }
    const account = this.accountRepo.create({
      code,
      supplierId,
      adapterCode,
      name,
      credentialEncrypted: null,
      enabled: 0,
      routingEnabled: input.routingEnabled === false ? 0 : 1,
      syncIntervalMinutes: adapter?.defaults.syncIntervalMinutes || 10,
      quotaDisplayType: adapter?.defaults.quotaDisplayType || 'CNY',
      quotaPerUnit: adapter?.defaults.quotaPerUnit || 500000,
      lastSyncStatus: 'unconfigured',
    })
    try {
      const saved = await this.accountRepo.save(account)
      return this.getSummary(Number(saved.id))
    } catch (error: any) {
      if (error?.code === 'ER_DUP_ENTRY') {
        throw new ConflictException(`账户编码已存在：${code}`)
      }
      throw error
    }
  }

  async update(idValue: unknown, input: UpdateSupplierAccountInput): Promise<SupplierAccountSummary> {
    const id = this.positiveId(idValue, '供应商账户')
    const account = await this.accountRepo.findOne({ where: { id } })
    if (!account) throw new NotFoundException('供应商账户不存在')

    let changed = false
    if (input.name !== undefined) {
      if (account.adapterCode === 'cctq' || account.adapterCode === 'cctq-api-key') {
        throw new BadRequestException('CCTQ 全局账户名称不可修改')
      }
      const name = this.normalizeName(input.name)
      if (name !== account.name) {
        account.name = name
        changed = true
      }
    }
    let routingChanged = false
    if (input.routingEnabled !== undefined) {
      if (typeof input.routingEnabled !== 'boolean') {
        throw new BadRequestException('routingEnabled 必须是布尔值')
      }
      const next = input.routingEnabled ? 1 : 0
      if (next !== account.routingEnabled) {
        account.routingEnabled = next
        changed = true
        routingChanged = true
      }
    }
    if (!changed) return this.getSummary(id)

    await this.accountRepo.save(account)
    if (routingChanged) await this.channelPool.refresh()
    return this.getSummary(id)
  }

  private async getSummary(id: number): Promise<SupplierAccountSummary> {
    const summary = (await this.list()).find((item) => item.id === id)
    if (!summary) throw new NotFoundException('供应商账户不存在')
    return summary
  }

  private positiveId(value: unknown, label: string): number {
    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new BadRequestException(`${label} ID 必须是正整数`)
    }
    return parsed
  }

  private normalizeCode(value: unknown): string {
    const code = String(value || '').trim().toLowerCase()
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(code) || code.length > 64) {
      throw new BadRequestException('账户编码须为 1-64 位小写字母、数字或单连字符组合')
    }
    return code
  }

  private normalizeName(value: unknown): string {
    const name = String(value || '').trim()
    if (!name || name.length > 100) {
      throw new BadRequestException('账户名称须为 1-100 个字符')
    }
    return name
  }

  private normalizeStatus(value: unknown): SupplierAccountSummary['status'] {
    if (value === 'healthy' || value === 'credential_invalid' || value === 'stale') return value
    return 'unconfigured'
  }

  private nullableNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  private positiveNumber(value: unknown, fallback: number): number {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
  }
}
