import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm'

/** 企业微信部门（用于按部门统计与展示）*/
@Entity('wecom_departments')
export class WecomDepartment {
  @Index({ unique: true })
  @Column({ type: 'int', primary: true })
  id: number

  @Column({ length: 100 })
  name: string

  @Column({ type: 'int', default: 0 })
  parentid: number

  @Column({ type: 'int', default: 0 })
  order: number

  @CreateDateColumn()
  createdAt: Date

  @UpdateDateColumn()
  updatedAt: Date
}
