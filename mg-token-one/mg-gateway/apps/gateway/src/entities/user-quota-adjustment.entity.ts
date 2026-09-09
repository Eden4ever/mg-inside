import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  Index,
  CreateDateColumn,
} from 'typeorm'

@Entity('user_quota_adjustments')
export class UserQuotaAdjustment {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number

  @Index()
  @Column({ type: 'int' })
  userId: number

  @Column({ length: 64 })
  username: string

  @Column({ type: 'int', nullable: true })
  operatorUserId: number | null

  @Column({ length: 64 })
  operatorUsername: string

  @Column({ length: 7 })
  period: string

  @Column({ type: 'decimal', precision: 14, scale: 6, default: 0 })
  fixedQuotaBefore: number

  @Column({ type: 'decimal', precision: 14, scale: 6, default: 0 })
  fixedQuotaAfter: number

  @Column({ type: 'decimal', precision: 14, scale: 6, default: 0 })
  temporaryQuotaBefore: number

  @Column({ type: 'decimal', precision: 14, scale: 6, default: 0 })
  temporaryQuotaAfter: number

  @Column({ length: 255 })
  reason: string

  @Index()
  @CreateDateColumn()
  createdAt: Date
}
