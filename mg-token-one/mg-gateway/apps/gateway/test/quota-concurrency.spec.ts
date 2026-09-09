import assert from 'node:assert/strict'
import test from 'node:test'
import { QuotaService } from '../src/modules/relay/quota.service'
import { periodFor } from '../src/modules/relay/monthly-quota-policy'
import { User } from '../src/entities/user.entity'
import { Group } from '../src/entities/group.entity'
import { UserMonthlyQuota } from '../src/entities/user-monthly-quota.entity'

type Ledger = { userId: number, period: string, quotaUsed: number, temporaryMonthlyQuota: number }

class SerialQuotaDataSource {
  readonly locks: string[] = []
  readonly user = { id: 7, role: 'user', groupNames: ['default'], fixedMonthlyQuota: 0 }
  readonly groups = [{ id: 3, name: 'default', status: 1, monthlyQuota: 100 }]
  readonly ledgers = new Map<string, Ledger>()
  private tail = Promise.resolve()
  private pauseUserLock: Promise<void> | null = null
  private releaseUserLock: (() => void) | null = null

  holdAfterUserLock() {
    this.pauseUserLock = new Promise<void>((resolve) => { this.releaseUserLock = resolve })
  }

  resumeAfterUserLock() {
    this.releaseUserLock?.()
    this.pauseUserLock = null
    this.releaseUserLock = null
  }

  async transaction<T>(work: (manager: any) => Promise<T>): Promise<T> {
    let release: () => void = () => {}
    const turn = new Promise<void>((resolve) => { release = resolve })
    const previous = this.tail
    this.tail = previous.then(() => turn)
    await previous
    try {
      return await work(this.manager())
    } finally {
      release()
    }
  }

  async adminAdjustFixedQuota(value: number) {
    await this.transaction(async () => {
      this.locks.push('admin:user')
      this.user.fixedMonthlyQuota = value
      this.locks.push('admin:ledger')
    })
  }

  private manager() {
    return {
      query: async (_sql: string, [userId, period]: [number, string]) => {
        const key = `${userId}:${period}`
        if (!this.ledgers.has(key)) this.ledgers.set(key, { userId, period, quotaUsed: 0, temporaryMonthlyQuota: 0 })
      },
      findOne: async (entity: unknown, options: any) => {
        if (entity === User) {
          this.locks.push('quota:user')
          if (this.pauseUserLock) await this.pauseUserLock
          return this.user
        }
        if (entity === UserMonthlyQuota) {
          this.locks.push('quota:ledger')
          return this.ledgers.get(`${options.where.userId}:${options.where.period}`) || null
        }
        return null
      },
      find: async (entity: unknown, options: any) => {
        assert.equal(entity, Group)
        assert.equal(options.lock.mode, 'pessimistic_read')
        this.locks.push('quota:groups')
        return this.groups
      },
      save: async (ledger: Ledger) => {
        this.ledgers.set(`${ledger.userId}:${ledger.period}`, ledger)
        return ledger
      },
    }
  }
}

function createService(source = new SerialQuotaDataSource()) {
  const service = new QuotaService({} as any, {} as any, {} as any, {} as any, source as any)
  return { service, source }
}

test('并发预扣会在同一月度账本锁内串行，累计不突破额度', async () => {
  const { service, source } = createService()
  const results = await Promise.all([
    service.preCheck({ userId: 7 } as any, 60),
    service.preCheck({ userId: 7 } as any, 60),
  ])

  assert.deepEqual(results.sort(), [false, true])
  const ledger = source.ledgers.get(`7:${periodFor(new Date())}`)
  assert.equal(ledger?.quotaUsed, 60)
})

test('管理员调整与预扣遵循 users、groups、ledger 的锁顺序并串行', async () => {
  const { service, source } = createService()
  source.holdAfterUserLock()
  const reserve = service.preCheck({ userId: 7 } as any, 80)
  await new Promise((resolve) => setImmediate(resolve))
  const adjustment = source.adminAdjustFixedQuota(20)
  source.resumeAfterUserLock()

  assert.equal(await reserve, true)
  await adjustment
  assert.deepEqual(source.locks, [
    'quota:user', 'quota:groups', 'quota:ledger', 'admin:user', 'admin:ledger',
  ])
})

test('结算退款不会将已用额度扣为负数', async () => {
  const { service, source } = createService()
  const period = periodFor(new Date())
  source.ledgers.set(`7:${period}`, { userId: 7, period, quotaUsed: 10, temporaryMonthlyQuota: 0 })

  await service.settle({ userId: 7 } as any, 0, 100)

  assert.equal(source.ledgers.get(`7:${period}`)?.quotaUsed, 0)
})

test('新自然月只读取当月临时额度，不沿用上月账本', async () => {
  const period = periodFor(new Date())
  const { service, source } = createService()
  source.ledgers.set('7:1999-12', {
    userId: 7,
    period: '1999-12',
    quotaUsed: 0,
    temporaryMonthlyQuota: 50,
  })

  assert.equal(await service.preCheck({ userId: 7 } as any, 120), false)
  assert.equal(source.ledgers.get(`7:${period}`)?.quotaUsed, 0)
})
