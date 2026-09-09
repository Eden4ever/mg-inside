import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'
import { SupplierKind } from '@/common/types/supplier-account.types'

@Entity('suppliers')
export class Supplier {
  @PrimaryGeneratedColumn()
  id: number

  @Column({ type: 'varchar', length: 32, unique: true })
  code: string

  @Column({ type: 'varchar', length: 100 })
  name: string

  @Column({ type: 'varchar', length: 20, default: 'third_party' })
  kind: SupplierKind

  @Column({ type: 'varchar', length: 255, nullable: true })
  website: string | null

  @Column({ type: 'tinyint', default: 1 })
  status: number

  @CreateDateColumn()
  createdAt: Date

  @UpdateDateColumn()
  updatedAt: Date
}
