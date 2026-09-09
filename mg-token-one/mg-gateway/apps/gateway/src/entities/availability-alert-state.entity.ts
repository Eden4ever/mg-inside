import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'

/**
 * 一个告警指纹当前的生命周期状态。该表仅属于可用性监控，不能用于改变渠道路由。
 */
@Entity('availability_alert_states')
@Index(['protocol', 'model', 'channelId', 'errorClass'])
export class AvailabilityAlertState {
  @PrimaryGeneratedColumn()
  id: number

  @Index({ unique: true })
  @Column({ length: 191 })
  fingerprint: string

  @Column({ length: 20 })
  protocol: string

  @Column({ length: 100 })
  model: string

  @Column({ type: 'int', nullable: true })
  channelId: number | null

  @Column({ length: 64 })
  errorClass: string

  @Index()
  @Column({ type: 'tinyint', default: 0 })
  active: number

  @Column({ type: 'int', default: 0 })
  consecutiveHealthyWindows: number

  /** 同一 UTC 分钟桶内只允许该指纹推进一次状态。 */
  @Column({ length: 32, nullable: true })
  lastEvaluationKey: string | null

  @Column({ type: 'datetime', precision: 6, nullable: true })
  lastEvaluatedAt: Date | null

  @Column({ type: 'datetime', precision: 6, nullable: true })
  lastTriggeredAt: Date | null

  @Column({ type: 'datetime', precision: 6, nullable: true })
  lastRecoveredAt: Date | null

  @CreateDateColumn({ precision: 6 })
  createdAt: Date

  @UpdateDateColumn({ precision: 6 })
  updatedAt: Date
}
