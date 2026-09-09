import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

@Entity('supplier_account_snapshots')
export class SupplierAccountSnapshotEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number

  @Index()
  @Column({ type: 'bigint' })
  supplierAccountId: number

  @Column({ type: 'bigint' })
  quotaAvailableRaw: number

  @Column({ type: 'bigint' })
  quotaUsedRaw: number

  @Column({ type: 'bigint' })
  requestCount: number

  @Column({ type: 'bigint' })
  last30dQuotaRaw: number

  @Index()
  @CreateDateColumn()
  capturedAt: Date
}
