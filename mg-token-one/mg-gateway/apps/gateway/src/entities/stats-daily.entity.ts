import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  Index,
  CreateDateColumn,
} from 'typeorm'

@Entity('stats_daily')
export class StatsDaily {
  @PrimaryGeneratedColumn()
  id: number

  @Index()
  @Column({ type: 'date' })
  date: string // YYYY-MM-DD

  @Index()
  @Column({ type: 'int', nullable: true })
  userId: number

  /** 冗余部门名，便于按部门聚合 */
  @Column({ length: 100, nullable: true })
  department: string

  @Index()
  @Column({ length: 100 })
  model: string

  @Column({ type: 'int', default: 0 })
  requestCount: number

  @Column({ type: 'int', default: 0 })
  failCount: number

  @Column({ type: 'int', default: 0 })
  promptTokens: number

  @Column({ type: 'int', default: 0 })
  completionTokens: number

  /** 消费额度合计（人民币元） */
  @Column({ type: 'double', default: 0 })
  quotaCost: number

  @Column({ type: 'double', default: 0 })
  costYuan: number

  @Column({ type: 'bigint', default: 0 })
  totalLatencyMs: number

  @CreateDateColumn()
  createdAt: Date
}
