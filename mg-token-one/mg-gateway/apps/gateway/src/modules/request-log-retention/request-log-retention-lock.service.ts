import { Injectable } from '@nestjs/common'
import { DataSource } from 'typeorm'

export interface RequestLogRetentionLock {
  query(sql: string, parameters?: unknown[]): Promise<unknown>
  release(): Promise<void>
}

/**
 * MySQL named locks are scoped to one connection. Keep the QueryRunner alive
 * for the complete cleanup run so different gateway instances cannot purge
 * the same log range concurrently.
 */
@Injectable()
export class RequestLogRetentionLockService {
  private static readonly lockName = 'mg-token-one:request-log-retention'

  constructor(private readonly dataSource: DataSource) {}

  async tryAcquire(): Promise<RequestLogRetentionLock | null> {
    const runner = this.dataSource.createQueryRunner()
    let acquired = false
    let released = false
    try {
      await runner.connect()
      const rows = await runner.query('SELECT GET_LOCK(?, 0) AS acquired', [RequestLogRetentionLockService.lockName])
      acquired = Number(rows?.[0]?.acquired) === 1
      if (!acquired) {
        await runner.release()
        return null
      }
      return {
        query: (sql: string, parameters: unknown[] = []) => runner.query(sql, parameters),
        release: async () => {
          if (released) return
          released = true
          try {
            const rows = await runner.query('SELECT RELEASE_LOCK(?) AS released', [RequestLogRetentionLockService.lockName])
            if (Number(rows?.[0]?.released) !== 1) {
              throw new Error('调用记录保留锁未释放')
            }
          } finally {
            await runner.release()
          }
        },
      }
    } catch (error) {
      if (!released) {
        released = true
        try {
          if (acquired) await runner.query('SELECT RELEASE_LOCK(?) AS released', [RequestLogRetentionLockService.lockName])
        } finally {
          await runner.release()
        }
      }
      throw error
    }
  }
}
