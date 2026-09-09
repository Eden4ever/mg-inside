import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
} from 'typeorm'

@Entity('user_monthly_quotas')
@Unique(['userId', 'period'])
export class UserMonthlyQuota {
  @PrimaryGeneratedColumn()
  id: number

  @Column({ type: 'int' })
  userId: number

  /** Asia/Shanghai 自然月，格式 YYYY-MM。 */
  @Column({ length: 7 })
  period: string

  /** 本月已确认或预扣的人民币消费，保留 6 位小数。 */
  @Column({ type: 'decimal', precision: 14, scale: 6, default: 0 })
  quotaUsed: number

  /** 仅在本账期叠加生效的人民币临时额度包。 */
  @Column({ type: 'decimal', precision: 14, scale: 6, default: 0 })
  temporaryMonthlyQuota: number

  @CreateDateColumn()
  createdAt: Date

  @UpdateDateColumn()
  updatedAt: Date
}
