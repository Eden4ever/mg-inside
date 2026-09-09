import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { RequestLog } from '@/entities/request-log.entity'
import { StatsDaily } from '@/entities/stats-daily.entity'

@Injectable()
export class LogService {
  private readonly logger = new Logger(LogService.name)

  constructor(
    @InjectRepository(RequestLog)
    private readonly logRepo: Repository<RequestLog>,
    @InjectRepository(StatsDaily)
    private readonly statsRepo: Repository<StatsDaily>,
  ) {}

  /** 异步落库，不阻塞响应 */
  record(input: Partial<RequestLog>) {
    setImmediate(() => {
      this.logRepo
        .save(this.logRepo.create(input as any))
        .then(() => this.accumulateDaily(input))
        .catch((error) => this.logger.error(`请求日志写入失败: ${error?.message || error}`))
    })
  }

  private async accumulateDaily(input: Partial<RequestLog>) {
    const date = (input as any).createdAt
      ? new Date((input as any).createdAt).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10)
    const userId = input.userId ?? null
    const model = input.model || 'unknown'
    const department = input.department ?? null
    const inc = {
      requestCount: 1,
      failCount: input.status === 0 ? 1 : 0,
      promptTokens: input.promptTokens || 0,
      completionTokens: input.completionTokens || 0,
      quotaCost: input.quotaCost || 0,
      costYuan: input.costYuan || 0,
      totalLatencyMs: input.latencyMs || 0,
    }
    await this.statsRepo
      .createQueryBuilder()
      .insert()
      .into(StatsDaily)
      .values({
        date,
        userId,
        department,
        model,
        ...inc,
      } as any)
      .orUpdate(
        [
          'requestCount',
          'failCount',
          'promptTokens',
          'completionTokens',
          'quotaCost',
          'costYuan',
          'totalLatencyMs',
        ],
        ['date', 'userId', 'model', 'department'],
      )
      .execute()
      .catch((error) => this.logger.error(`每日统计累加失败: ${error?.message || error}`))
  }
}
