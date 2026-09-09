import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'
import { RelayProtocol } from '@/common/utils/upstream-protocol.util'

/**
 * A health record belongs to a stable request path, not to a mutable route row.
 * modelIdentity is normally `id:<model-config-id>` and survives route replacement.
 */
@Entity('channel_route_health')
@Index(['channelId', 'modelIdentity', 'protocol'], { unique: true })
@Index(['channelId'])
export class ChannelRouteHealth {
  @PrimaryGeneratedColumn()
  id: number

  @Column({ type: 'int' })
  channelId: number

  @Column({ type: 'varchar', length: 191 })
  modelIdentity: string

  @Column({ type: 'varchar', length: 100 })
  modelName: string

  @Column({ type: 'varchar', length: 20 })
  protocol: RelayProtocol

  @Column({ type: 'int', default: 0 })
  consecutiveErrors: number

  @Column({ type: 'bigint', nullable: true })
  disabledUntil: number | null

  @Column({ type: 'int', default: 0 })
  totalRequests: number

  @Column({ type: 'int', default: 0 })
  failedRequests: number

  @Column({ type: 'datetime', precision: 6, nullable: true })
  lastSuccessAt: Date | null

  @Column({ type: 'datetime', precision: 6, nullable: true })
  lastFailureAt: Date | null

  /** Used to reject a late persistence of an older outcome. */
  @Column({ type: 'datetime', precision: 6, nullable: true })
  lastOutcomeAt: Date | null

  @CreateDateColumn({ precision: 6 })
  createdAt: Date

  @UpdateDateColumn({ precision: 6 })
  updatedAt: Date
}
