import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { DataSource, In, Repository } from 'typeorm'
import { User } from '@/entities/user.entity'
import { Token } from '@/entities/token.entity'
import { Group } from '@/entities/group.entity'
import { UserMonthlyQuota } from '@/entities/user-monthly-quota.entity'
import { GatewayTokenInfo } from '@/common/middleware/token-auth.middleware'
import {
  allowsReservation,
  composeMonthlyQuota,
  periodFor,
  resolveMonthlyQuota,
  roundMoney,
  settledUsage,
} from './monthly-quota-policy'

export interface MonthlyQuotaSummary {
  period: string
  quota: number | null
  used: number
  remaining: number | null
  groupQuota: number
  fixedQuota: number
  temporaryQuota: number
  appliedGroups: string[]
  isUnlimited: boolean
}

interface MonthlyQuotaPolicy {
  period: string
  quota: number | null
  groupQuota: number
  fixedQuota: number
  temporaryQuota: number
  appliedGroups: string[]
  isUnlimited: boolean
}

@Injectable()
export class QuotaService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Token) private readonly tokenRepo: Repository<Token>,
    @InjectRepository(Group) private readonly groupRepo: Repository<Group>,
    @InjectRepository(UserMonthlyQuota)
    private readonly monthlyRepo: Repository<UserMonthlyQuota>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * 预扣估算额度（条件更新，原子）。返回 true=允许。
   * est = promptTokens + maxTokens * outputRatio（maxTokens 来自请求）
   */
  async preCheck(info: GatewayTokenInfo, est: number): Promise<boolean> {
    if (est <= 0) return true
    return this.withLockedQuota(info.userId, async (policy, ledger) => {
      if (policy.isUnlimited || !ledger) return true
      const next = roundMoney(Number(ledger.quotaUsed) + est)
      if (!allowsReservation(policy.quota || 0, Number(ledger.quotaUsed), est)) return false
      ledger.quotaUsed = next
      return true
    })
  }

  /** 结算：实际 - 估算 的差额，条件调整（多退少补，绝不扣成负数）*/
  async settle(info: GatewayTokenInfo, actual: number, est: number) {
    const delta = actual - est
    if (delta === 0) return
    await this.withLockedQuota(info.userId, async (policy, ledger) => {
      if (policy.isUnlimited || !ledger) return
      ledger.quotaUsed = settledUsage(policy.quota || 0, Number(ledger.quotaUsed), delta)
      return true
    })
  }

  async touchToken(tokenId: number) {
    await this.tokenRepo.update(tokenId, {
      lastUsedAt: Date.now(),
    } as any)
  }

  async getMonthlySummary(userId: number): Promise<MonthlyQuotaSummary> {
    const policy = await this.policyFor(userId)
    if (policy.isUnlimited) {
      return {
        period: policy.period,
        quota: null,
        used: 0,
        remaining: null,
        groupQuota: 0,
        fixedQuota: 0,
        temporaryQuota: 0,
        appliedGroups: policy.appliedGroups,
        isUnlimited: true,
      }
    }
    const ledger = await this.monthlyRepo.findOne({
      where: { userId, period: policy.period },
    })
    const used = roundMoney(Number(ledger?.quotaUsed || 0))
    const quota = policy.quota || 0
    return {
      period: policy.period,
      quota,
      used,
      remaining: roundMoney(Math.max(0, quota - used)),
      groupQuota: policy.groupQuota,
      fixedQuota: policy.fixedQuota,
      temporaryQuota: policy.temporaryQuota,
      appliedGroups: policy.appliedGroups,
      isUnlimited: false,
    }
  }

  private async policyFor(userId: number): Promise<MonthlyQuotaPolicy> {
    const user = await this.userRepo.findOne({ where: { id: userId } })
    const period = periodFor(new Date())
    if (!user) {
      return {
        period,
        quota: null,
        groupQuota: 0,
        fixedQuota: 0,
        temporaryQuota: 0,
        appliedGroups: [],
        isUnlimited: true,
      }
    }
    const names = Array.isArray(user.groupNames) && user.groupNames.length
      ? [...new Set(user.groupNames)]
      : ['default']
    const groups = await this.groupRepo.find({
      where: { name: In(names), status: 1 },
    })
    const applicable = groups.length
      ? groups
      : (await this.groupRepo.find({ where: { name: 'default', status: 1 } }))
    const groupPolicy = resolveMonthlyQuota(user.role, applicable)
    if (groupPolicy.isUnlimited) {
      return {
        period,
        quota: null,
        groupQuota: 0,
        fixedQuota: 0,
        temporaryQuota: 0,
        appliedGroups: groupPolicy.appliedGroups,
        isUnlimited: true,
      }
    }
    const ledger = await this.monthlyRepo.findOne({ where: { userId, period } })
    const groupQuota = roundMoney(Number(groupPolicy.quota || 0))
    const fixedQuota = roundMoney(Math.max(0, Number(user.fixedMonthlyQuota || 0)))
    const temporaryQuota = roundMoney(Math.max(0, Number(ledger?.temporaryMonthlyQuota || 0)))
    return {
      period,
      quota: composeMonthlyQuota(groupQuota, fixedQuota, temporaryQuota),
      groupQuota,
      fixedQuota,
      temporaryQuota,
      appliedGroups: groupPolicy.appliedGroups,
      isUnlimited: false,
    }
  }

  /**
   * 写路径的锁顺序固定为 users -> groups（按 id 升序，共享读锁）-> user_monthly_quotas。
   * 用户后台额度调整也先锁 users 再锁当月账本，因此同一用户的策略变更与预扣
   * 会串行；群组共享读锁允许不同用户并发预扣，同时确保额度策略在事务提交前
   * 不会被并发 UPDATE 改写。
   */
  private async withLockedQuota<T>(
    userId: number,
    action: (policy: MonthlyQuotaPolicy, ledger?: UserMonthlyQuota) => Promise<T>,
  ): Promise<T> {
    return this.dataSource.transaction(async (manager) => {
      const period = periodFor(new Date())
      const user = await manager.findOne(User, {
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      })
      if (!user) return action(this.unlimitedPolicy(period), undefined)

      if (user.role === 'admin') return action(this.unlimitedPolicy(period), undefined)

      const names = Array.isArray(user.groupNames) && user.groupNames.length
        ? [...new Set(user.groupNames)]
        : ['default']
      let groups = await manager.find(Group, {
        where: { name: In(names), status: 1 },
        order: { id: 'ASC' },
        lock: { mode: 'pessimistic_read' },
      })
      if (!groups.length) {
        groups = await manager.find(Group, {
          where: { name: 'default', status: 1 },
          order: { id: 'ASC' },
          lock: { mode: 'pessimistic_read' },
        })
      }

      await manager.query(
        'INSERT IGNORE INTO user_monthly_quotas (`userId`, `period`, `quotaUsed`) VALUES (?, ?, 0)',
        [userId, period],
      )
      const ledger = await manager.findOne(UserMonthlyQuota, {
        where: { userId, period },
        lock: { mode: 'pessimistic_write' },
      })
      if (!ledger) throw new Error('无法创建月度额度账本')
      const groupPolicy = resolveMonthlyQuota(user.role, groups)
      const policy: MonthlyQuotaPolicy = groupPolicy.isUnlimited
        ? this.unlimitedPolicy(period, groupPolicy.appliedGroups)
        : {
          period,
          quota: composeMonthlyQuota(
            roundMoney(Number(groupPolicy.quota || 0)),
            roundMoney(Math.max(0, Number(user.fixedMonthlyQuota || 0))),
            roundMoney(Math.max(0, Number(ledger.temporaryMonthlyQuota || 0))),
          ),
          groupQuota: roundMoney(Number(groupPolicy.quota || 0)),
          fixedQuota: roundMoney(Math.max(0, Number(user.fixedMonthlyQuota || 0))),
          temporaryQuota: roundMoney(Math.max(0, Number(ledger.temporaryMonthlyQuota || 0))),
          appliedGroups: groupPolicy.appliedGroups,
          isUnlimited: false,
        }
      const result = await action(policy, ledger)
      await manager.save(ledger)
      return result
    })
  }

  private unlimitedPolicy(period: string, appliedGroups: string[] = []): MonthlyQuotaPolicy {
    return {
      period,
      quota: null,
      groupQuota: 0,
      fixedQuota: 0,
      temporaryQuota: 0,
      appliedGroups,
      isUnlimited: true,
    }
  }

}
