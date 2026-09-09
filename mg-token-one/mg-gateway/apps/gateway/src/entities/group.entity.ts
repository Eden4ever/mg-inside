import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm'

@Entity('groups')
export class Group {
  @PrimaryGeneratedColumn()
  id: number

  /** 分组名（唯一）。 */
  @Column({ length: 50, unique: true })
  name: string

  /** 描述 */
  @Column({ length: 255, nullable: true })
  description: string | null

  /** 该分组可见/可访问的模型名列表（多对多关系；空数组=不包含模型） */
  @Column({ type: 'json', nullable: true })
  models: string[] | null

  /** 每位普通员工的自然月消费额度（人民币元）。NULL 用于一次性升级初始化。 */
  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  monthlyQuota: number | null

  @Column({ type: 'tinyint', default: 1 })
  status: number // 1=启用 0=禁用

  @CreateDateColumn()
  createdAt: Date

  @UpdateDateColumn()
  updatedAt: Date
}
