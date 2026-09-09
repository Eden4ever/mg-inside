import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm'

export type AvailabilityAlertEventType = 'triggered' | 'recovered'

/** 不可变告警事件流，用于管理端观察和外部通知接入前的审计。 */
@Entity('availability_alert_events')
@Index(['fingerprint', 'eventType', 'windowEndAt'], { unique: true })
export class AvailabilityAlertEvent {
  @PrimaryGeneratedColumn()
  id: number

  @Index()
  @Column({ type: 'int' })
  stateId: number

  @Index()
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

  @Column({ length: 16 })
  eventType: AvailabilityAlertEventType

  @Column({ type: 'smallint' })
  windowMinutes: number

  @Column({ type: 'int', default: 0 })
  requests: number

  @Column({ type: 'int', default: 0 })
  successes: number

  @Column({ type: 'int', default: 0 })
  serviceFailures: number

  @Column({ type: 'int', default: 0 })
  matchingFailures: number

  @Column({ type: 'double', nullable: true })
  serviceSuccessRate: number | null

  @Column({ type: 'datetime', precision: 6 })
  windowEndAt: Date

  @CreateDateColumn({ precision: 6 })
  occurredAt: Date
}
