import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm'

export type UserRole = 'admin' | 'user'
export type SyncSource = 'local' | 'wecom' | 'zentao' | 'sso'

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number

  @Column({ type: 'varchar', length: 255, nullable: true })
  identityIssuer: string | null

  @Column({ type: 'varchar', length: 128, nullable: true, unique: true })
  identitySubject: string | null

  @Column({ type: 'boolean', default: true })
  identityEnabled: boolean

  @Column({ length: 64, unique: true })
  username: string

  @Column({ length: 100, nullable: true })
  displayName: string

  @Column({ length: 100, nullable: true })
  passwordHash: string | null

  @Column({ length: 100, nullable: true })
  department: string

  /** 所属分组名列表（一对多，引用 Group.name）。空/NULL=仅默认 default 分组 */
  @Column({ type: 'json', nullable: true })
  groupNames: string[] | null

  @Column({ type: 'varchar', length: 16, default: 'user' })
  role: UserRole

  @Column({ type: 'tinyint', default: 1 })
  status: number // 1=正常 0=禁用

  /** 额度总量（统一 token 当量），0=无限 */
  @Column({ type: 'bigint', default: 0 })
  quotaTotal: number

  /** 已用额度 */
  @Column({ type: 'bigint', default: 0 })
  quotaUsed: number

  /** 每个自然月自动叠加到群组额度上的固定人民币额度包。 */
  @Column({ type: 'decimal', precision: 14, scale: 6, default: 0 })
  fixedMonthlyQuota: number

  // ===== 企业微信字段 =====
  @Column({ type: 'varchar', length: 64, nullable: true, unique: true })
  wecomUserId: string | null

  @Column({ type: 'varchar', length: 16, default: 'local' })
  syncSource: SyncSource

  @Column({ type: 'json', nullable: true })
  wecomDeptIds: number[] | null

  @Column({ type: 'varchar', length: 64, nullable: true })
  openUserid: string | null

  @Column({ type: 'varchar', length: 255, nullable: true })
  avatarUrl: string | null

  @CreateDateColumn()
  createdAt: Date

  @UpdateDateColumn()
  updatedAt: Date
}
