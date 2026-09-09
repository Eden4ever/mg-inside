import { BadRequestException, Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { ModelOwner } from '@/entities/model-owner.entity'
import { Supplier } from '@/entities/supplier.entity'
import { SupplierAccount } from '@/entities/supplier-account.entity'
import { SupplierAccountAdapterRegistry } from '@/modules/supplier-account/supplier-account-adapter.registry'

@Injectable()
export class RoutingMetadataService {
  constructor(
    @InjectRepository(ModelOwner) private readonly ownerRepo: Repository<ModelOwner>,
    @InjectRepository(Supplier) private readonly supplierRepo: Repository<Supplier>,
    @InjectRepository(SupplierAccount) private readonly accountRepo: Repository<SupplierAccount>,
    private readonly adapterRegistry: SupplierAccountAdapterRegistry,
  ) {}

  async catalog() {
    const [modelOwners, suppliers, accounts] = await Promise.all([
      this.ownerRepo.find({ order: { name: 'ASC' } }),
      this.supplierRepo.find({ order: { name: 'ASC' } }),
      this.accountRepo.find({ order: { name: 'ASC' } }),
    ])
    const supplierNames = new Map(suppliers.map((supplier) => [supplier.id, supplier.name]))
    return {
      modelOwners,
      suppliers,
      supplierAccountAdapters: this.adapterRegistry.catalog(),
      supplierAccounts: accounts.map((account) => ({
        id: account.id,
        code: account.code,
        name: account.name,
        supplierId: account.supplierId,
        supplierName: supplierNames.get(account.supplierId) || '未知供应商',
        adapterCode: account.adapterCode,
        enabled: account.enabled,
        status: account.lastSyncStatus,
        displayName: account.displayName,
      })),
    }
  }

  async requireModelOwner(value: unknown): Promise<number | null> {
    const id = this.optionalId(value, '模型所有者')
    if (id === null) return null
    if (!await this.ownerRepo.findOne({ where: { id } })) {
      throw new BadRequestException(`模型所有者不存在：${id}`)
    }
    return id
  }

  async requireSupplierAccount(value: unknown): Promise<number | null> {
    const id = this.optionalId(value, '供应商账户')
    if (id === null) return null
    if (!await this.accountRepo.findOne({ where: { id } })) {
      throw new BadRequestException(`供应商账户不存在：${id}`)
    }
    return id
  }

  private optionalId(value: unknown, label: string): number | null {
    if (value === null || value === undefined || value === '') return null
    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new BadRequestException(`${label} ID 必须是正整数或空值`)
    }
    return parsed
  }
}
