import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'

@Entity('model_routes')
@Index(['modelId', 'channelId'], { unique: true })
export class ModelRoute {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number

  @Index()
  @Column({ type: 'int' })
  modelId: number

  @Index()
  @Column({ type: 'int' })
  channelId: number

  @Column({ type: 'varchar', length: 100 })
  upstreamModel: string

  @Column({ type: 'int', default: 0 })
  priority: number

  @Column({ type: 'int', default: 1 })
  weight: number

  @Column({ type: 'tinyint', default: 1 })
  status: number

  @CreateDateColumn()
  createdAt: Date

  @UpdateDateColumn()
  updatedAt: Date
}
