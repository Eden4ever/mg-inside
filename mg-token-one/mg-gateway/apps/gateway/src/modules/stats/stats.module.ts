import {
  Module,
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { TypeOrmModule } from '@nestjs/typeorm'
import { StatsDaily } from '@/entities/stats-daily.entity'
import { RequestLog } from '@/entities/request-log.entity'
import { User } from '@/entities/user.entity'
import { Token } from '@/entities/token.entity'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { Roles } from '@/modules/auth/guards/roles.guard'
import { CurrentUser } from '@/common/decorators/current-user.decorator'
import { AuthModule } from '@/modules/auth/auth.module'
import { RelayModule } from '@/modules/relay/relay.module'
import { QuotaService } from '@/modules/relay/quota.service'

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function validDate(value?: string): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function resolveRange(from?: string, to?: string) {
  const today = todayStr()
  const start = validDate(from) ? from : today
  const end = validDate(to) ? to : today
  return start <= end ? { from: start, to: end } : { from: end, to: start }
}

const AVAILABILITY_WINDOWS = new Set([5, 15, 60])

function percentage(numerator: number, denominator: number): number | null {
  if (!denominator) return null
  return Math.round((numerator / denominator) * 10000) / 100
}

function availabilityNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

@Controller('api/admin/stats')
@UseGuards(JwtAuthGuard, Roles('admin'))
export class StatsAdminController {
  constructor(
    @InjectRepository(StatsDaily)
    private readonly statsRepo: Repository<StatsDaily>,
    @InjectRepository(RequestLog)
    private readonly logRepo: Repository<RequestLog>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {}

  @Get('overview')
  async overview(@Query('from') from?: string, @Query('to') to?: string) {
    const range = resolveRange(from, to)
    const agg = await this.statsRepo
      .createQueryBuilder('s')
      .select('SUM(s.requestCount)', 'requests')
      .addSelect('SUM(s.failCount)', 'fails')
      .addSelect('SUM(s.quotaCost)', 'quota')
      .addSelect('SUM(s.costYuan)', 'cost')
      .where('s.date BETWEEN :from AND :to', range)
      .getRawOne()
    const period = {
      requests: Number(agg?.requests || 0),
      fails: Number(agg?.fails || 0),
      quota: Number(agg?.quota || 0),
      cost: Number(agg?.cost || 0),
    }
    return {
      period,
      // 保留旧字段，避免已接入的管理端版本因接口升级中断。
      today: period,
      ...range,
    }
  }

  @Get('by-model')
  async byModel(@Query('from') from: string, @Query('to') to: string) {
    return this.groupBy('model', from, to)
  }

  @Get('by-department')
  async byDepartment(@Query('from') from: string, @Query('to') to: string) {
    return this.groupBy('department', from, to)
  }

  @Get('by-user')
  async byUser(@Query('from') from: string, @Query('to') to: string) {
    const rows = await this.groupBy('userId', from, to)
    const userIds = rows.map((r) => r.dimension).filter(Boolean)
    const users = await this.getUserMap(userIds)
    return rows.map((r) => ({
      ...r,
      dimension:
        r.dimension && users[r.dimension]
          ? users[r.dimension]
          : r.dimension || '未分配',
    }))
  }

  @Get('trend')
  async trend(
    @Query('days') days: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const d = parseInt(days || '14', 10)
    const fallbackFrom = new Date(Date.now() - (d - 1) * 86400000)
      .toISOString()
      .slice(0, 10)
    const range = from || to ? resolveRange(from, to) : { from: fallbackFrom, to: todayStr() }
    return this.statsRepo
      .createQueryBuilder('s')
      .select('s.date', 'date')
      .addSelect('SUM(s.requestCount)', 'requests')
      .addSelect('SUM(s.quotaCost)', 'quota')
      .where('s.date BETWEEN :from AND :to', range)
      .groupBy('s.date')
      .orderBy('s.date', 'ASC')
      .getRawMany()
  }

  /**
   * 原生 Responses 等协议的短窗口可用性聚合。该接口只读 request_logs，
   * 不触发渠道健康变更、重试或熔断；客户端主动断开单独计数并排除在服务成功率之外。
   */
  @Get('availability')
  async availability(@Query('window') windowValue?: string) {
    const parsedWindow = Number.parseInt(windowValue || '15', 10)
    const windowMinutes = AVAILABILITY_WINDOWS.has(parsedWindow) ? parsedWindow : 15
    const to = new Date()
    const from = new Date(to.getTime() - windowMinutes * 60_000)
    const rows = await this.logRepo
      .createQueryBuilder('l')
      .select('l.protocol', 'protocol')
      .addSelect('l.model', 'model')
      .addSelect('l.channelId', 'channelId')
      .addSelect('l.errorCode', 'errorCode')
      .addSelect('l.responseStatus', 'responseStatus')
      .addSelect('COUNT(*)', 'requests')
      .addSelect('SUM(CASE WHEN l.status = 1 THEN 1 ELSE 0 END)', 'successes')
      .addSelect('SUM(CASE WHEN l.status = 0 THEN 1 ELSE 0 END)', 'failures')
      .where('l.createdAt >= :from', { from })
      .groupBy('l.protocol')
      .addGroupBy('l.model')
      .addGroupBy('l.channelId')
      .addGroupBy('l.errorCode')
      .addGroupBy('l.responseStatus')
      .orderBy('requests', 'DESC')
      .getRawMany()

    const groups = rows.map((row: any) => ({
      protocol: row.protocol || null,
      model: row.model || null,
      channelId: row.channelId === null || row.channelId === undefined
        ? null
        : availabilityNumber(row.channelId),
      errorCode: row.errorCode || null,
      responseStatus: row.responseStatus === null || row.responseStatus === undefined
        ? null
        : availabilityNumber(row.responseStatus),
      requests: availabilityNumber(row.requests),
      successes: availabilityNumber(row.successes),
      failures: availabilityNumber(row.failures),
    }))

    const summary = groups.reduce((acc, row) => {
      acc.requests += row.requests
      acc.successes += row.successes
      acc.failures += row.failures
      if (row.errorCode === 'client_disconnected') acc.excludedClientDisconnected += row.failures
      return acc
    }, { requests: 0, successes: 0, failures: 0, excludedClientDisconnected: 0 })
    const serviceFailures = Math.max(0, summary.failures - summary.excludedClientDisconnected)
    const serviceRequests = Math.max(0, summary.requests - summary.excludedClientDisconnected)
    return {
      windowMinutes,
      from: from.toISOString(),
      to: to.toISOString(),
      summary: {
        ...summary,
        serviceRequests,
        serviceFailures,
        successRate: percentage(summary.successes, summary.requests),
        serviceSuccessRate: percentage(summary.successes, serviceRequests),
      },
      groups,
    }
  }

  private async getUserMap(ids: number[]): Promise<Record<number, string>> {
    if (!ids.length) return {}
    const found = await this.userRepo
      .createQueryBuilder('u')
      .select('u.id', 'id')
      .addSelect('u.displayName', 'name')
      .where('u.id IN (:...ids)', { ids })
      .getRawMany()
    const map: Record<number, string> = {}
    for (const f of found) map[f.id] = f.name || String(f.id)
    return map
  }

  private async groupBy(
    field: 'model' | 'department' | 'userId',
    from?: string,
    to?: string,
  ) {
    const qb = this.statsRepo
      .createQueryBuilder('s')
      .select(`s.${field}`, 'dimension')
      .addSelect('SUM(s.requestCount)', 'requests')
      .addSelect('SUM(s.failCount)', 'fails')
      .addSelect('SUM(s.quotaCost)', 'quota')
      .addSelect('SUM(s.costYuan)', 'cost')
      .groupBy(`s.${field}`)
    if (from) qb.andWhere('s.date >= :from', { from })
    if (to) qb.andWhere('s.date <= :to', { to })
    return qb.getRawMany()
  }
}

@Controller('api/admin/logs')
@UseGuards(JwtAuthGuard, Roles('admin'))
export class LogsAdminController {
  constructor(
    @InjectRepository(RequestLog)
    private readonly logRepo: Repository<RequestLog>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Token)
    private readonly tokenRepo: Repository<Token>,
    private readonly quotaService: QuotaService,
  ) {}

  @Get()
  async list(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('model') model?: string,
    @Query('protocol') protocol?: string,
    @Query('userId') userId?: string,
    @Query('status') status?: string,
  ) {
    const p = parseInt(page || '1', 10)
    const ps = parseInt(pageSize || '10', 10)
    const where: any = {}
    if (model) where.model = model
    if (protocol === 'chat' || protocol === 'responses' || protocol === 'anthropic') {
      where.protocol = protocol
    }
    if (userId) where.userId = parseInt(userId, 10)
    if (status !== undefined && status !== '') where.status = parseInt(status, 10)
    const [list, total] = await this.logRepo.findAndCount({
      where,
      skip: (p - 1) * ps,
      take: ps,
      order: { id: 'DESC' },
    })
    const userIds = [...new Set(list.map((item) => item.userId).filter(Boolean))]
    const tokenIds = [...new Set(list.map((item) => item.tokenId).filter(Boolean))]
    const [users, tokens]: [User[], Token[]] = await Promise.all([
      userIds.length
        ? this.userRepo.find({ where: userIds.map((id) => ({ id })) })
        : [],
      tokenIds.length
        ? this.tokenRepo.find({ where: tokenIds.map((id) => ({ id })) })
        : [],
    ])
    const usersById = new Map<number, User>()
    const tokensById = new Map<number, Token>()
    users.forEach((user) => usersById.set(user.id, user))
    tokens.forEach((token) => tokensById.set(token.id, token))
    return {
      list: list.map((item) => {
        const user = usersById.get(item.userId)
        const token = tokensById.get(item.tokenId)
        return {
          ...item,
          caller: user
            ? { id: user.id, username: user.username, displayName: user.displayName || null }
            : null,
          token: token
            ? { id: token.id, name: token.name, keyPrefix: token.keyPrefix }
            : null,
        }
      }),
      total,
      page: p,
      pageSize: ps,
    }
  }
}

@Controller('api/portal/stats')
@UseGuards(JwtAuthGuard)
export class StatsPortalController {
  constructor(
    @InjectRepository(RequestLog)
    private readonly logRepo: Repository<RequestLog>,
    private readonly quotaService: QuotaService,
  ) {}

  @Get('my')
  async my(@CurrentUser() user: any) {
    const today = todayStr()
    const row = await this.logRepo
      .createQueryBuilder('l')
      .select('COUNT(*)', 'requests')
      .addSelect('SUM(l.quotaCost)', 'quota')
      .addSelect('SUM(l.promptTokens)', 'prompt')
      .addSelect('SUM(l.completionTokens)', 'completion')
      .where('l.userId = :uid', { uid: user.sub })
      .andWhere('DATE(l.createdAt) = :d', { d: today })
      .getRawOne()
    const total = await this.logRepo
      .createQueryBuilder('l')
      .select('COUNT(*)', 'requests')
      .addSelect('SUM(l.quotaCost)', 'quota')
      .where('l.userId = :uid', { uid: user.sub })
      .getRawOne()
    const monthly = await this.quotaService.getMonthlySummary(user.sub)
    return {
      today: {
        requests: row?.requests || 0,
        quota: row?.quota || 0,
        prompt: row?.prompt || 0,
        completion: row?.completion || 0,
      },
      total: { requests: total?.requests || 0, quota: total?.quota || 0 },
      monthly,
    }
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([StatsDaily, RequestLog, User, Token]), AuthModule, RelayModule],
  controllers: [StatsAdminController, StatsPortalController, LogsAdminController],
})
export class StatsModule {}
