import { Injectable } from '@nestjs/common'
import { DataSource } from 'typeorm'

export interface SupplierAccountSyncLock {
  release(): Promise<void>
}

/**
 * MySQL named locks are connection-scoped. Holding a dedicated query runner
 * makes this a cross-process and cross-instance lock without persisted lease
 * rows that could outlive a process crash.
 */
@Injectable()
export class SupplierAccountSyncLockService {
  constructor(private readonly dataSource: DataSource) {}

  async tryAcquire(accountId: number): Promise<SupplierAccountSyncLock | null> {
    const lockName = `mg-token-one:supplier-sync:${accountId}`
    const runner = this.dataSource.createQueryRunner()
    let acquired = false
    let released = false
    try {
      await runner.connect()
      const rows = await runner.query('SELECT GET_LOCK(?, 0) AS acquired', [lockName])
      acquired = Number(rows?.[0]?.acquired) === 1
      if (!acquired) {
        await runner.release()
        return null
      }
      return {
        release: async () => {
          if (released) return
          released = true
          try {
            await runner.query('SELECT RELEASE_LOCK(?) AS released', [lockName])
          } finally {
            await runner.release()
          }
        },
      }
    } catch (error) {
      if (!released) {
        released = true
        try {
          if (acquired) await runner.query('SELECT RELEASE_LOCK(?) AS released', [lockName])
        } finally {
          await runner.release()
        }
      }
      throw error
    }
  }
}
