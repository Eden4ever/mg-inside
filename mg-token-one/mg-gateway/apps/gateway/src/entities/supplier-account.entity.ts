import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'
import {
  SupplierAccountStatus,
  SupplierGroupSnapshot,
  SupplierSubscriptionSnapshot,
} from '@/common/types/supplier-account.types'

@Entity('supplier_accounts')
@Index(['supplierId', 'adapterCode'])
export class SupplierAccount {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  code: string

  @Index()
  @Column({ type: 'int' })
  supplierId: number

  @Column({ type: 'varchar', length: 32 })
  adapterCode: string

  @Column({ type: 'varchar', length: 100 })
  name: string

  @Column({ type: 'text', nullable: true })
  credentialEncrypted: string | null

  @Column({ type: 'tinyint', default: 0 })
  enabled: number

  /** 是否允许关联渠道进入路由池；与适配器自动同步开关 enabled 分离。 */
  @Column({ type: 'tinyint', default: 1 })
  routingEnabled: number

  @Column({ type: 'int', default: 10 })
  syncIntervalMinutes: number

  @Column({ type: 'bigint', nullable: true })
  externalAccountId: number | null

  @Column({ type: 'varchar', length: 100, nullable: true })
  displayName: string | null

  @Column({ type: 'varchar', length: 100, nullable: true })
  accountGroup: string | null

  @Column({ type: 'bigint', nullable: true })
  quotaAvailableRaw: number | null

  @Column({ type: 'bigint', nullable: true })
  quotaUsedRaw: number | null

  @Column({ type: 'bigint', nullable: true })
  requestCount: number | null

  @Column({ type: 'bigint', nullable: true })
  last30dQuotaRaw: number | null

  @Column({ type: 'int', nullable: true })
  rpm: number | null

  @Column({ type: 'bigint', nullable: true })
  tpm: number | null

  @Column({ type: 'varchar', length: 16, default: 'CNY' })
  quotaDisplayType: string

  @Column({ type: 'bigint', default: 500000 })
  quotaPerUnit: number

  @Column({ type: 'double', default: 1 })
  usdExchangeRate: number

  @Column({ type: 'varchar', length: 64, nullable: true })
  billingPreference: string | null

  @Column({ type: 'json', nullable: true })
  subscriptions: SupplierSubscriptionSnapshot[] | null

  @Column({ type: 'json', nullable: true })
  groups: SupplierGroupSnapshot[] | null

  @Column({ type: 'json', nullable: true })
  models: string[] | null

  /** CCTQ API Key 额度是否无限；为 1 时 quotaAvailableRaw 不作为余额上限展示。 */
  @Column({ type: 'tinyint', default: 0 })
  unlimitedQuota: number

  /** CCTQ API Key 到期 Unix 秒，0 表示永不过期。 */
  @Column({ type: 'bigint', default: 0 })
  expiresAt: number

  @Column({ type: 'json', nullable: true })
  modelLimits: Record<string, unknown> | null

  @Column({ type: 'tinyint', default: 0 })
  modelLimitsEnabled: number

  @Column({ type: 'varchar', length: 32, default: 'unconfigured' })
  lastSyncStatus: SupplierAccountStatus

  @Column({ type: 'datetime', nullable: true })
  lastAttemptAt: Date | null

  @Column({ type: 'datetime', nullable: true })
  lastSyncAt: Date | null

  @Column({ type: 'varchar', length: 64, nullable: true })
  lastErrorCode: string | null

  @Column({ type: 'varchar', length: 255, nullable: true })
  lastErrorMessage: string | null

  @CreateDateColumn()
  createdAt: Date

  @UpdateDateColumn()
  updatedAt: Date
}
