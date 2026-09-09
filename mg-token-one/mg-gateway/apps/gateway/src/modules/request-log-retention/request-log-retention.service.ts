import { Inject, Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { AppConfig } from '@/config/configuration'
import { RequestLogRetentionLockService } from './request-log-retention-lock.service'

export interface RequestLogRetentionResult {
  skipped: boolean
  cutoffUtc: Date
  deleted: number
  batches: number
}

/**
 * Retention is intentionally limited to request_logs. Daily statistics,
 * quotas, suppliers, health records and alerts have independent lifecycles.
 */
@Injectable()
export class RequestLogRetentionService {
  private readonly logger = new Logger(RequestLogRetentionService.name)
  private static readonly businessTimeZone = 'Asia/Shanghai'

  constructor(
    private readonly lock: RequestLogRetentionLockService,
    @Inject('APP_CONFIG') private readonly config: AppConfig,
  ) {}

  /**
   * Calendar arithmetic is performed in the business timezone. The returned
   * Date is the same instant expressed for mysql2's +08:00 connection.
   */
  cutoffUtc(now = new Date()): Date {
    const months = this.config.requestLogRetention.retentionMonths
    const local = this.localShanghaiParts(now)
    const targetMonthOffset = local.year * 12 + (local.month - 1) - months
    const targetYear = Math.floor(targetMonthOffset / 12)
    const targetMonth = ((targetMonthOffset % 12) + 12) % 12
    const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate()
    // Asia/Shanghai is UTC+08:00. Date stores the instant, while the DB
    // driver serializes it using the connection timezone.
    return new Date(Date.UTC(
      targetYear,
      targetMonth,
      Math.min(local.day, lastDay),
      local.hour,
      local.minute,
      local.second,
      local.millisecond,
    ) - 8 * 60 * 60 * 1000)
  }

  private localShanghaiParts(now: Date) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: RequestLogRetentionService.businessTimeZone,
      calendar: 'gregory',
      numberingSystem: 'latn',
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(now)
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
    return {
      year: Number(values.year),
      month: Number(values.month),
      day: Number(values.day),
      hour: Number(values.hour),
      minute: Number(values.minute),
      second: Number(values.second),
      millisecond: now.getUTCMilliseconds(),
    }
  }

  // 03:17 Asia/Shanghai is a fixed low-traffic window, not a per-process polling loop.
  @Cron('0 17 3 * * *', { timeZone: 'Asia/Shanghai' })
  async scheduledCleanup() {
    if (!this.config.requestLogRetention.schedulerEnabled) return
    const now = new Date()
    try {
      const result = await this.cleanup(now)
      if (!result.skipped && result.deleted > 0) {
        this.logger.log(`调用记录保留清理完成：删除 ${result.deleted} 条，${result.batches} 批，UTC 截止 ${result.cutoffUtc.toISOString()}`)
      }
    } catch {
      // A retention failure must never terminate the gateway or affect relaying.
      this.logger.error('调用记录保留清理失败')
    }
  }

  async cleanup(now = new Date()): Promise<RequestLogRetentionResult> {
    const cutoffUtc = this.cutoffUtc(now)
    const lock = await this.lock.tryAcquire()
    if (!lock) return { skipped: true, cutoffUtc, deleted: 0, batches: 0 }

    let deleted = 0
    let batches = 0
    try {
      while (batches < this.config.requestLogRetention.maxBatchesPerRun) {
        // No transaction is opened: every bounded DELETE is a MySQL autocommit boundary.
        const result = await lock.query(
          'DELETE FROM request_logs WHERE createdAt < ? ORDER BY createdAt ASC, id ASC LIMIT ?',
          [cutoffUtc, this.config.requestLogRetention.batchSize],
        )
        const affected = this.affectedRows(result)
        batches += 1
        deleted += affected
        if (affected < this.config.requestLogRetention.batchSize) break
      }
      return { skipped: false, cutoffUtc, deleted, batches }
    } finally {
      try {
        await lock.release()
      } catch {
        // The delete result/error must not be hidden by a RELEASE_LOCK failure.
        this.logger.warn('调用记录保留锁释放失败')
      }
    }
  }

  private affectedRows(result: unknown): number {
    const affected = Number((result as any)?.affectedRows)
    return Number.isSafeInteger(affected) && affected > 0 ? affected : 0
  }
}
