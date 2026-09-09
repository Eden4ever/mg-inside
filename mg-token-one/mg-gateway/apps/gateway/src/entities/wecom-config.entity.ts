import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm'

/**
 * 企业微信配置（单行表，id=1）。
 * 也可走环境变量，但入库便于管理端可视化修改。
 */
@Entity('wecom_config')
export class WecomConfig {
  @PrimaryGeneratedColumn()
  id: number

  @Column({ length: 64 })
  corpid: string

  @Column({ length: 32 })
  agentid: string

  @Column({ length: 255 })
  secret: string

  @Column({ length: 64, nullable: true })
  token: string

  @Column({ length: 64, nullable: true })
  encodingAESKey: string

  @Column({ length: 255, default: '/api/auth/wecom/callback' })
  callbackPath: string

  @Column({ type: 'text', nullable: true })
  adminUserIds: string

  @Column({ type: 'text', nullable: true })
  adminDeptIds: string

  @Column({ type: 'bigint', default: 0 })
  defaultQuota: number

  @Column({ type: 'tinyint', default: 0 })
  enabled: number

  @CreateDateColumn()
  createdAt: Date

  @UpdateDateColumn()
  updatedAt: Date
}
