import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  Index,
  CreateDateColumn,
} from 'typeorm'
import { RelayProtocol } from '@/common/utils/upstream-protocol.util'

@Entity('request_logs')
export class RequestLog {
  @PrimaryGeneratedColumn()
  id: number

  @Index()
  @Column({ length: 40 })
  requestId: string

  @Index()
  @Column({ type: 'int', nullable: true })
  userId: number

  @Column({ type: 'int', nullable: true })
  tokenId: number

  @Index()
  @Column({ length: 100, nullable: true })
  department: string

  @Index()
  @Column({ length: 100 })
  model: string

  @Index()
  @Column({ length: 20, default: 'chat' })
  protocol: RelayProtocol

  @Column({ length: 100, nullable: true })
  upstreamModel: string

  @Column({ type: 'int', nullable: true })
  channelId: number

  @Column({ type: 'smallint', default: 0 })
  status: number // 1=成功 0=失败

  @Column({ type: 'int', default: 0 })
  promptTokens: number

  @Column({ type: 'int', default: 0 })
  cachedTokens: number

  @Column({ type: 'int', default: 0 })
  completionTokens: number

  @Column({ type: 'int', default: 0 })
  totalTokens: number

  /** 本次消费额度（人民币元，= costYuan） */
  @Column({ type: 'double', default: 0 })
  quotaCost: number

  /** 人民币成本（元），免费=0 */
  @Column({ type: 'double', default: 0 })
  costYuan: number

  /** 请求开始时冻结的价格档与实际单价快照。 */
  @Column({ length: 16, default: 'fixed' })
  pricingTier: 'fixed' | 'off_peak' | 'peak'

  @Column({ type: 'double', default: 0 })
  appliedInputPrice: number

  @Column({ type: 'double', default: 0 })
  appliedCachePrice: number

  @Column({ type: 'double', default: 0 })
  appliedOutputPrice: number

  @Column({ type: 'tinyint', default: 0 })
  isStream: number

  @Column({ type: 'tinyint', default: 0 })
  usageEstimated: number

  @Column({ type: 'int', default: 0 })
  latencyMs: number

  @Column({ type: 'int', default: 0 })
  firstTokenMs: number

  @Column({ type: 'smallint', default: 0 })
  retryCount: number

  @Column({ type: 'tinyint', default: 0 })
  partial: number

  @Column({ type: 'text', nullable: true })
  errorMessage: string

  /** 稳定的网关错误码，供可用性监控聚合；错误详情仍保留在 errorMessage。 */
  @Index()
  @Column({ length: 64, nullable: true })
  errorCode: string

  /** 返回给调用方的 HTTP 状态码；成功请求为空。 */
  @Column({ type: 'smallint', nullable: true })
  responseStatus: number | null

  @Column({ length: 64, nullable: true })
  clientIp: string

  @Index()
  @CreateDateColumn()
  createdAt: Date
}
