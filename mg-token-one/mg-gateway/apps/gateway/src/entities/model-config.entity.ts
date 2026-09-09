import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm'

export class ModelBinding {
  channelId: number
  upstreamModel: string
  priority: number
  weight?: number
  status?: number
}

@Entity('model_configs')
export class ModelConfig {
  @PrimaryGeneratedColumn()
  id: number

  /** 对外统一模型名（客户端用这个）*/
  @Column({ length: 100, unique: true })
  name: string

  /** 主模型所有者；供应商关系由渠道/模型路由表达。 */
  @Column({ type: 'int', nullable: true })
  modelOwnerId: number | null

  /** 旧版单分组标签，仅用于兼容历史数据；实际授权由 Group.models 的多对多关系决定。 */
  @Column({ length: 50, default: 'default' })
  groupTag: string

  /** 旧镜像回滚副本；权威模型路由关系保存在 model_routes。 */
  @Column({ type: 'json', nullable: true })
  bindings: ModelBinding[] | null

  /** 输入单价 元/1M，0=免费 */
  @Column({ type: 'double', default: 0 })
  inputPrice: number

  /** 缓存命中输入单价 元/1M，0=按普通输入价 */
  @Column({ type: 'double', default: 0 })
  cachePrice: number

  /** 输出单价 元/1M，0=免费 */
  @Column({ type: 'double', default: 0 })
  outputPrice: number

  /** fixed=固定价；deepseek_peak_valley=按北京时间峰谷时段计价。 */
  @Column({ type: 'varchar', length: 32, default: 'fixed' })
  pricingMode: 'fixed' | 'deepseek_peak_valley'

  /** 高峰时段输入、缓存命中与输出单价；单位均为元/1M token。 */
  @Column({ type: 'double', default: 0 })
  peakInputPrice: number

  @Column({ type: 'double', default: 0 })
  peakCachePrice: number

  @Column({ type: 'double', default: 0 })
  peakOutputPrice: number

  @Column({ type: 'tinyint', default: 1 })
  status: number

  @Column({ length: 255, nullable: true })
  remark: string

  // ===== 模型能力元数据（供客户端发现能力 / 文档中心展示 / 多模态校验）=====

  /** 上下文窗口长度（token） */
  @Column({ type: 'int', default: 0 })
  contextLength: number

  /** 单次最大输出 token 数 */
  @Column({ type: 'int', default: 0 })
  maxOutputTokens: number

  /** 是否支持图片/视频等多模态输入（1=支持） */
  @Column({ type: 'tinyint', default: 0 })
  supportsVision: number

  /** 是否支持函数/工具调用（1=支持） */
  @Column({ type: 'tinyint', default: 0 })
  supportsTools: number

  /** 是否支持思考/推理（1=支持） */
  @Column({ type: 'tinyint', default: 0 })
  supportsReasoning: number

  /** 是否支持 Responses API（1=支持） */
  @Column({ type: 'tinyint', default: 0 })
  supportsResponses: number

  /** 是否支持 Anthropic Messages API（1=支持） */
  @Column({ type: 'tinyint', default: 0 })
  supportsAnthropic: number

  /** 思考强度选项（如 low,medium,high / enabled / on-off），空=无 */
  @Column({ length: 120, nullable: true })
  reasoningEfforts: string

  /** 输入模态（如 ["text","image","video"]） */
  @Column({ type: 'json', nullable: true })
  inputModalities: string[] | null

  /** 输出模态（如 ["text"]） */
  @Column({ type: 'json', nullable: true })
  outputModalities: string[] | null

  /** 视觉输入限制/说明 */
  @Column({ length: 255, nullable: true })
  visionNotes: string

  @CreateDateColumn()
  createdAt: Date

  @UpdateDateColumn()
  updatedAt: Date
}
