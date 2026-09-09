import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm'

@Entity('tokens')
export class Token {
  @PrimaryGeneratedColumn()
  id: number

  /** sha256(sk- 之后的明文)，唯一 */
  @Index({ unique: true })
  @Column({ type: 'char', length: 64 })
  keyHash: string

  /** 明文前 8 位，用于展示 */
  @Column({ length: 16 })
  keyPrefix: string

  @Column({ length: 100 })
  name: string

  @Column({ type: 'int' })
  userId: number

  /** 分组限制（NULL=全部）*/
  @Column({ length: 50, nullable: true })
  groupTag: string | null

  /** 额度总量 0=跟随用户 */
  @Column({ type: 'bigint', default: 0 })
  quotaTotal: number

  @Column({ type: 'bigint', default: 0 })
  quotaUsed: number

  @Column({ type: 'bigint', nullable: true })
  expiresAt: number | null

  @Column({ type: 'tinyint', default: 1 })
  status: number

  @Column({ type: 'bigint', nullable: true })
  lastUsedAt: number | null

  @CreateDateColumn()
  createdAt: Date

  @UpdateDateColumn()
  updatedAt: Date
}
