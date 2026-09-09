import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm'
import { ChannelProtocol } from '@/common/utils/upstream-protocol.util'

export type ChannelType = 'openai' | 'anthropic'

@Entity('channels')
export class Channel {
  @PrimaryGeneratedColumn()
  id: number

  @Column({ length: 100 })
  name: string

  /** 供应商账户关联；NULL 表示尚未完成元数据归属。 */
  @Column({ type: 'bigint', nullable: true })
  supplierAccountId: number | null

  @Column({ type: 'varchar', length: 20, default: 'openai' })
  type: ChannelType

  /** 上游协议格式：chat=Chat Completions, responses=Responses API, anthropic=Anthropic Messages */
  @Column({ type: 'varchar', length: 20, default: 'chat' })
  protocol: ChannelProtocol

  /** 上游原生支持的协议集合；protocol 保留用于兼容旧数据。 */
  @Column({ type: 'json', nullable: true })
  protocols: ChannelProtocol[] | null

  @Column({ length: 255, default: 'https://api.openai.com' })
  baseUrl: string

  /** 多 key，一行一个，AES 加密后存储 */
  @Column({ type: 'text' })
  keysEncrypted: string

  @Column({ length: 255, nullable: true })
  proxy: string

  /** 自定义上游请求头（JSON，如 {"User-Agent":"claude-cli/1.0"}），用于需要客户端身份校验的渠道 */
  @Column({ type: 'text', nullable: true })
  headersJson: string | null

  /** 优先级，越大越优先 */
  @Column({ type: 'int', default: 0 })
  priority: number

  /** 同级权重（轮询）*/
  @Column({ type: 'int', default: 1 })
  weight: number

  @Column({ type: 'tinyint', default: 1 })
  status: number // 1=启用 0=禁用

  /** 自动禁用到该时间戳（NULL=正常）*/
  @Column({ type: 'bigint', nullable: true })
  disabledUntil: number | null

  @Column({ type: 'int', default: 0 })
  consecutiveErrors: number

  @Column({ type: 'int', default: 0 })
  totalRequests: number

  @Column({ type: 'int', default: 0 })
  failedRequests: number

  @Column({ type: 'datetime', precision: 6, nullable: true })
  lastSuccessAt: Date | null

  @Column({ type: 'datetime', precision: 6, nullable: true })
  lastFailureAt: Date | null

  @Column({ type: 'text', nullable: true })
  remark: string

  @CreateDateColumn()
  createdAt: Date

  @UpdateDateColumn()
  updatedAt: Date
}
