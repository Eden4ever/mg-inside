import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Inject,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { QueryRunner, Repository } from 'typeorm'
import { createHash } from 'node:crypto'
import { Channel } from '@/entities/channel.entity'
import { ChannelRouteHealth } from '@/entities/channel-route-health.entity'
import { ModelConfig } from '@/entities/model-config.entity'
import { SupplierAccount } from '@/entities/supplier-account.entity'
import { ModelRouteStore, StoredModelBinding } from '@/modules/model-route/model-route.store'
import { CryptoUtil } from '@/common/utils/crypto.util'
import { AppConfig } from '@/config/configuration'
import {
  ChannelProtocol,
  normalizeChannelProtocols,
  RelayProtocol,
} from '@/common/utils/upstream-protocol.util'

interface BindingRuntime {
  channelId: number
  modelIdentity: string
  upstreamModel: string
  priority: number
  weight: number
  baseUrl: string
  proxy?: string
  headersJson?: string
  protocols: ChannelProtocol[]
  keys: string[]
}

export type ChannelHealthStatus =
  | 'healthy'
  | 'degraded'
  | 'circuit_open'
  | 'disabled'
  | 'credential_unreadable'

export interface ChannelHealthSnapshot {
  status: ChannelHealthStatus
  reason: string | null
  consecutiveErrors: number
  disabledUntil: number | null
  totalRequests: number
  failedRequests: number
  lastSuccessAt: Date | null
  lastFailureAt: Date | null
  canRecover: boolean
}

interface ChannelHealthBase {
  status: 'ready' | 'disabled' | 'credential_unreadable'
  reason: string | null
  totalRequests: number
  failedRequests: number
  lastSuccessAt: Date | null
  lastFailureAt: Date | null
}

export type RoutingBindingStatus =
  | 'available'
  | 'temporarily_disabled'
  | 'model_disabled'
  | 'route_disabled'
  | 'channel_missing'
  | 'channel_disabled'
  | 'account_missing'
  | 'account_disabled'
  | 'credential_unreadable'
  | 'credential_empty'

interface RoutingBindingStaticDiagnostic {
  channelId: number
  modelIdentity: string
  channelName: string | null
  supplierAccountId: number | null
  supplierAccountName: string | null
  upstreamModel: string
  priority: number
  weight: number
  protocols: ChannelProtocol[]
  status: Exclude<RoutingBindingStatus, 'available' | 'temporarily_disabled'> | 'ready'
}

export interface ModelRoutingDiagnostic {
  model: string
  strategy: 'none' | 'single' | 'load_balance' | 'failover'
  configuredBindingCount: number
  routableBindingCount: number
  availableBindingCount: number
  protocolAvailability: Record<RelayProtocol, number>
  bindings: Array<Omit<RoutingBindingStaticDiagnostic, 'status'> & {
    status: RoutingBindingStatus
    disabledUntil: number | null
    consecutiveErrors: number
  }>
}

export interface PickedChannel {
  channelId: number
  /** 路由池内部诊断元数据；传输适配器不依赖这些字段。 */
  modelIdentity?: string
  modelName?: string
  upstreamModel: string
  baseUrl: string
  proxy?: string
  headersJson?: string
  protocol: RelayProtocol
  key: string
}

interface RouteHealthState {
  channelId: number
  modelIdentity: string
  modelName: string
  protocol: RelayProtocol
  consecutiveErrors: number
  disabledUntil: number | null
  totalRequests: number
  failedRequests: number
  lastSuccessAt: Date | null
  lastFailureAt: Date | null
  lastOutcomeAt: Date | null
}

@Injectable()
export class ChannelPoolService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChannelPoolService.name)
  private modelMap = new Map<string, BindingRuntime[]>() // modelName -> bindings
  private routingDiagnostics = new Map<string, RoutingBindingStaticDiagnostic[]>()
  // Legacy channel fields remain only for aggregate management display. Circuit
  // decisions are based exclusively on routeHealth below.
  private channelStatus = new Map<number, number>()
  private channelErrors = new Map<number, number>() // channelId -> consecutiveErrors
  private channelHealthBase = new Map<number, ChannelHealthBase>()
  private routeHealth = new Map<string, RouteHealthState>()
  private healthWriteLocks = new Map<string, Promise<void>>()
  private bindingWeights = new Map<string, Map<number, number>>()
  private keyCursors = new Map<number, number>()
  private refreshTimer: NodeJS.Timeout | null = null

  private get autoCircuitBreakerEnabled(): boolean {
    return this.config.relay?.autoCircuitBreakerEnabled !== false
  }

  constructor(
    @InjectRepository(Channel) private readonly channelRepo: Repository<Channel>,
    @InjectRepository(ModelConfig)
    private readonly modelRepo: Repository<ModelConfig>,
    @InjectRepository(SupplierAccount)
    private readonly supplierAccountRepo: Repository<SupplierAccount>,
    @Inject('APP_CONFIG') private readonly config: AppConfig,
    private readonly modelRoutes: ModelRouteStore,
    @InjectRepository(ChannelRouteHealth)
    private readonly routeHealthRepo?: Repository<ChannelRouteHealth>,
  ) {}

  async onModuleInit() {
    await this.refresh()
    this.refreshTimer = setInterval(
      () => this.refresh().catch((e) => this.logger.error(e?.message)),
      60_000,
    )
  }

  onModuleDestroy() {
    if (this.refreshTimer) clearInterval(this.refreshTimer)
    this.refreshTimer = null
  }

  async refresh() {
    const [allChannels, models, allAccounts, persistedRouteHealth] = await Promise.all([
      this.channelRepo.find(),
      this.modelRepo.find(),
      this.supplierAccountRepo.find(),
      this.routeHealthRepo ? this.routeHealthRepo.find() : Promise.resolve([]),
    ])
    // channel.disabledUntil was the former circuit key. It must never affect a
    // path decision after this migration, so clear it opportunistically.
    const staleCircuitChannels = allChannels.filter(
      (channel) => Number(channel.disabledUntil || 0) > 0,
    )
    if (staleCircuitChannels.length && this.channelRepo.update) {
      await this.channelRepo.update(
        staleCircuitChannels.map((channel) => channel.id),
        { disabledUntil: null },
      )
      for (const channel of staleCircuitChannels) channel.disabledUntil = null
      this.logger.log(`清除 ${staleCircuitChannels.length} 个历史渠道级临时禁用状态`)
    }
    const routeHealth = new Map<string, RouteHealthState>()
    for (const health of persistedRouteHealth) {
      const state = this.toRouteHealthState(health)
      routeHealth.set(this.routeKey(state.channelId, state.modelIdentity, state.protocol), state)
    }
    if (!this.autoCircuitBreakerEnabled) {
      const staleRouteCircuits = [...routeHealth.values()].filter(
        (health) => Number(health.disabledUntil || 0) > 0,
      )
      for (const health of staleRouteCircuits) {
        health.disabledUntil = null
        await this.persistRouteCircuitClear(health)
      }
      if (staleRouteCircuits.length) {
        this.logger.log(`自动熔断已关闭，清除 ${staleRouteCircuits.length} 个路径级临时禁用状态`)
      }
    }
    const accountMap = new Map(allAccounts.map((account) => [Number(account.id), account]))
    const bindingsByModel = await this.modelRoutes.bindingsByModel(models)
    const channelMap = new Map(allChannels.map((channel) => [Number(channel.id), channel]))
    const now = Date.now()
    const channelStatus = new Map<number, number>()
    const channelErrors = new Map<number, number>()
    const channelHealthBase = new Map<number, ChannelHealthBase>()
    const map = new Map<string, BindingRuntime[]>()
    const diagnostics = new Map<string, RoutingBindingStaticDiagnostic[]>()
    for (const channel of allChannels) {
      const accountId = channel.supplierAccountId === null || channel.supplierAccountId === undefined
        ? null
        : Number(channel.supplierAccountId)
      const account = accountId === null ? null : accountMap.get(accountId) || null
      let status: ChannelHealthBase['status'] = 'ready'
      let reason: string | null = null
      if (channel.status !== 1) {
        status = 'disabled'
        reason = '渠道已停用'
      } else if (accountId !== null && !account) {
        status = 'disabled'
        reason = '供应商账户不存在'
      } else if (account && account.routingEnabled !== 1) {
        status = 'disabled'
        reason = '供应商账户未参与路由'
      } else {
        try {
          const keys = CryptoUtil.splitKeys(
            CryptoUtil.decrypt(channel.keysEncrypted, this.config.jwt.secret),
          )
          if (keys.length === 0) {
            status = 'credential_unreadable'
            reason = '渠道没有可用密钥'
          }
        } catch {
          status = 'credential_unreadable'
          reason = '渠道密钥无法解密'
        }
      }
      channelHealthBase.set(channel.id, {
        status,
        reason,
        totalRequests: Number(channel.totalRequests || 0),
        failedRequests: Number(channel.failedRequests || 0),
        lastSuccessAt: channel.lastSuccessAt || null,
        lastFailureAt: channel.lastFailureAt || null,
      })
    }
    for (const m of models) {
      const bindings: BindingRuntime[] = []
      const modelDiagnostics: RoutingBindingStaticDiagnostic[] = []
      for (const b of bindingsByModel.get(m.id) || []) {
        const channelId = Number(b.channelId)
        const ch = channelMap.get(channelId)
        const accountId = ch?.supplierAccountId === null || ch?.supplierAccountId === undefined
          ? null
          : Number(ch.supplierAccountId)
        const account = accountId === null ? null : accountMap.get(accountId) || null
        const diagnostic: RoutingBindingStaticDiagnostic = {
          channelId,
          modelIdentity: this.modelIdentity(m),
          channelName: ch?.name || null,
          supplierAccountId: accountId,
          supplierAccountName: account?.name || null,
          upstreamModel: b.upstreamModel,
          priority: b.priority || 0,
          weight: Number.isInteger(Number(b.weight)) && Number(b.weight) > 0
            ? Number(b.weight)
            : ch && Number.isInteger(Number(ch.weight)) && Number(ch.weight) > 0
              ? Number(ch.weight)
              : 1,
          protocols: ch ? normalizeChannelProtocols(ch) : [],
          status: 'ready',
        }
        if (m.status !== 1) diagnostic.status = 'model_disabled'
        else if (b.status !== 1) diagnostic.status = 'route_disabled'
        else if (!ch) diagnostic.status = 'channel_missing'
        else if (ch.status !== 1) diagnostic.status = 'channel_disabled'
        else if (accountId !== null && !account) diagnostic.status = 'account_missing'
        else if (account && account.routingEnabled !== 1) diagnostic.status = 'account_disabled'

        let keys: string[] = []
        if (diagnostic.status === 'ready' && ch) {
          try {
            keys = CryptoUtil.splitKeys(
              CryptoUtil.decrypt(ch.keysEncrypted, this.config.jwt.secret),
            )
          } catch {
            diagnostic.status = 'credential_unreadable'
            this.logger.warn(`渠道 ${ch.id} 密钥解密失败，跳过`)
          }
        }
        if (diagnostic.status === 'ready' && keys.length === 0) {
          diagnostic.status = 'credential_empty'
        }
        modelDiagnostics.push(diagnostic)
        if (diagnostic.status !== 'ready' || !ch) continue

        bindings.push({
          channelId: ch.id,
          modelIdentity: diagnostic.modelIdentity,
          upstreamModel: b.upstreamModel,
          priority: b.priority || 0,
          weight: diagnostic.weight,
          baseUrl: ch.baseUrl,
          proxy: ch.proxy || undefined,
          headersJson: ch.headersJson || undefined,
          protocols: diagnostic.protocols,
          keys,
        })
      }
      bindings.sort((a, b) => b.priority - a.priority)
      modelDiagnostics.sort((a, b) => b.priority - a.priority)
      // 按模型名索引该模型自身的 bindings（保证 pick 取到正确的 upstreamModel/渠道）
      if (bindings.length) map.set(m.name, bindings)
      diagnostics.set(m.name, modelDiagnostics)
    }
    for (const health of routeHealth.values()) {
      if (Number(health.disabledUntil || 0) <= now) continue
      if (this.autoCircuitBreakerEnabled && this.hasHealthyFallbackForPathInMap(health, map, routeHealth, now)) {
        continue
      }
      health.disabledUntil = null
      await this.persistRouteCircuitClear(health)
      this.logger.warn(`路径 ${health.channelId}/${health.modelIdentity}/${health.protocol} 无已验证健康备用，清除临时禁用状态`)
    }
    this.rebuildChannelHealthSummary(routeHealth, channelHealthBase, channelErrors, channelStatus, now)
    this.modelMap = map
    this.routingDiagnostics = diagnostics
    this.channelStatus = channelStatus
    this.channelErrors = channelErrors
    this.channelHealthBase = channelHealthBase
    this.routeHealth = routeHealth
    this.logger.log(`渠道池刷新完成，可用模型 ${map.size} 个`)
  }

  health(channelId: number): ChannelHealthSnapshot | null {
    const base = this.channelHealthBase.get(channelId)
    if (!base) return null
    const now = Date.now()
    const disabledUntil = this.channelStatus.get(channelId) || null
    const consecutiveErrors = this.channelErrors.get(channelId) || 0
    let status: ChannelHealthStatus = base.status === 'ready' ? 'healthy' : base.status
    let reason = base.reason
    if (base.status === 'ready' && disabledUntil && disabledUntil > now) {
      status = 'circuit_open'
      reason = `连续失败 ${consecutiveErrors} 次，渠道已临时熔断`
    } else if (base.status === 'ready' && consecutiveErrors > 0) {
      status = 'degraded'
      reason = `连续失败 ${consecutiveErrors} 次`
    }
    return {
      status,
      reason,
      consecutiveErrors,
      disabledUntil,
      totalRequests: base.totalRequests,
      failedRequests: base.failedRequests,
      lastSuccessAt: base.lastSuccessAt,
      lastFailureAt: base.lastFailureAt,
      canRecover: status === 'degraded' || status === 'circuit_open',
    }
  }

  /** 返回脱敏后的有效路由计划，不推进轮询游标。 */
  describe(model: string): ModelRoutingDiagnostic {
    const now = Date.now()
    const bindings = (this.routingDiagnostics.get(model) || []).map((binding) => {
      const pathHealth = binding.protocols.map((protocol) =>
        this.routeHealth.get(this.routeKey(binding.channelId, binding.modelIdentity, protocol)),
      )
      const disabledPaths = pathHealth.filter((health) =>
        Number(health?.disabledUntil || 0) > now,
      )
      const disabledUntil = disabledPaths.length === binding.protocols.length && disabledPaths.length > 0
        ? Math.max(...disabledPaths.map((health) => Number(health?.disabledUntil)))
        : null
      const consecutiveErrors = Math.max(
        0,
        ...pathHealth.map((health) => Number(health?.consecutiveErrors || 0)),
      )
      return {
        ...binding,
        status: binding.status === 'ready'
          ? disabledUntil && disabledUntil > now
            ? 'temporarily_disabled' as const
            : 'available' as const
          : binding.status,
        disabledUntil,
        consecutiveErrors,
      }
    })
    const priorities = new Set(bindings.map((binding) => binding.priority))
    const strategy = bindings.length === 0
      ? 'none' as const
      : bindings.length === 1
      ? 'single' as const
      : priorities.size === 1
      ? 'load_balance' as const
      : 'failover' as const
    const available = bindings.filter((binding) => binding.status === 'available')
    const protocolAvailability: Record<RelayProtocol, number> = {
      chat: 0,
      responses: 0,
      anthropic: 0,
    }
    for (const binding of available) {
      for (const protocol of binding.protocols) protocolAvailability[protocol]++
    }
    return {
      model,
      strategy,
      configuredBindingCount: bindings.length,
      routableBindingCount: bindings.filter((binding) =>
        binding.status === 'available' || binding.status === 'temporarily_disabled',
      ).length,
      availableBindingCount: available.length,
      protocolAvailability,
      bindings,
    }
  }

  hasModel(model: string, protocol: RelayProtocol): boolean {
    return (this.modelMap.get(model) || []).some((binding) =>
      binding.protocols.includes(protocol),
    )
  }

  /** 选一个渠道（按优先级 + 同级加权轮询 + 跳过禁用）*/
  pick(
    model: string,
    protocol: RelayProtocol,
    excludedChannelIds: ReadonlySet<number> = new Set(),
  ): PickedChannel | null {
    const now = Date.now()
    const available = (this.modelMap.get(model) || []).filter((binding) =>
      binding.protocols.includes(protocol) &&
      !this.isPathTemporarilyDisabled(binding.channelId, binding.modelIdentity, protocol, now),
    )
    if (available.length === 0) return null

    const untried = available.filter((binding) => !excludedChannelIds.has(binding.channelId))
    const source = untried.length ? untried : available
    const highestPriority = Math.max(...source.map((binding) => binding.priority))
    const list = source.filter((binding) => binding.priority === highestPriority)
    const cursorKey = `${protocol}:${model}:${highestPriority}`
    const totalWeight = list.reduce((sum, binding) => sum + binding.weight, 0)
    const currentWeights = this.bindingWeights.get(cursorKey) || new Map<number, number>()
    const activeIds = new Set(list.map((binding) => binding.channelId))
    for (const channelId of currentWeights.keys()) {
      if (!activeIds.has(channelId)) currentWeights.delete(channelId)
    }
    let selected = list[0]
    for (const binding of list) {
      const current = (currentWeights.get(binding.channelId) || 0) + binding.weight
      currentWeights.set(binding.channelId, current)
      if (current > (currentWeights.get(selected.channelId) || 0)) {
        selected = binding
      }
    }
    currentWeights.set(
      selected.channelId,
      (currentWeights.get(selected.channelId) || 0) - totalWeight,
    )
    this.bindingWeights.set(cursorKey, currentWeights)
    const kc = this.keyCursors.get(selected.channelId) || 0
    const key = selected.keys[kc % selected.keys.length]
    this.keyCursors.set(selected.channelId, kc + 1)
    return {
      channelId: selected.channelId,
      modelIdentity: selected.modelIdentity,
      modelName: model,
      upstreamModel: selected.upstreamModel,
      baseUrl: selected.baseUrl,
      proxy: selected.proxy,
      headersJson: selected.headersJson,
      protocol,
      key,
    }
  }

  /** RelayExecutor always supplies model and protocol. Older callers may omit
   * them, in which case only the channel-level compatibility summary changes. */
  async recordSuccess(
    channelId: number,
    modelName?: string,
    protocol?: RelayProtocol,
    outcomeAt = new Date(),
  ) {
    const paths = this.pathsForOutcome(channelId, modelName, protocol)
    await Promise.all(paths.map((path) => this.withHealthWriteLock(path, async () => {
      const previous = this.routeHealth.get(this.healthKey(path))
      const olderOutcome = !!previous?.lastOutcomeAt && previous.lastOutcomeAt > outcomeAt
      const event: RouteHealthState = {
        ...path,
        consecutiveErrors: 0,
        disabledUntil: null,
        totalRequests: (previous?.totalRequests || 0) + 1,
        failedRequests: previous?.failedRequests || 0,
        lastSuccessAt: outcomeAt,
        lastFailureAt: previous?.lastFailureAt || null,
        lastOutcomeAt: outcomeAt,
      }
      const state = olderOutcome
        ? { ...previous!, totalRequests: event.totalRequests }
        : event
      this.routeHealth.set(this.healthKey(state), state)
      await this.persistRouteOutcome(event, 'success')
    })))
    // Old callers may know only a channel. Keep their aggregate counters for
    // management compatibility, but never infer a model/protocol path from it.
    await this.recordChannelSummary(channelId, 'success', paths.length === 0)
  }

  async recordFailure(
    channelId: number,
    modelName?: string,
    protocol?: RelayProtocol,
    outcomeAt = new Date(),
  ) {
    const paths = this.pathsForOutcome(channelId, modelName, protocol)
    await Promise.all(paths.map((path) => this.withHealthWriteLock(path, async () => {
      const state = await this.recordRouteFailure(path, outcomeAt)
      this.routeHealth.set(this.healthKey(state), state)
    })))
    await this.recordChannelSummary(channelId, 'failure', paths.length === 0)
  }

  /**
   * The circuit decision must not rely on this instance's cache. Multiple
   * gateways can observe different failing paths at the same time; without a
   * model/protocol scoped lock each one can mistake the other stale path for a
   * healthy fallback and open every circuit. Named locks are connection scoped,
   * therefore all reads, writes, and RELEASE_LOCK use one QueryRunner.
   */
  private async recordRouteFailure(
    path: Pick<RouteHealthState, 'channelId' | 'modelIdentity' | 'modelName' | 'protocol'>,
    outcomeAt: Date,
  ): Promise<RouteHealthState> {
    const source = this.routeHealthRepo?.manager?.connection
    if (!source || typeof source.createQueryRunner !== 'function') {
      // Repository-less unit callers have no shared state to reconcile. Keep
      // their legacy in-memory behavior, while production always supplies a
      // TypeORM data source through the injected repository below.
      return this.recordRouteFailureInMemory(path, outcomeAt, true)
    }

    let runner: QueryRunner | null = null
    let acquired = false
    const lockName = this.circuitLockName(path.modelIdentity, path.protocol)
    try {
      runner = source.createQueryRunner()
      await runner.connect()
      // A short wait serializes concurrent failure reports for this scope.
      // Timeout still follows the conservative no-circuit path below.
      const lockRows = await runner.query('SELECT GET_LOCK(?, 2) AS acquired', [lockName])
      acquired = Number(lockRows?.[0]?.acquired) === 1
      if (!acquired) {
        this.logger.warn(`路径 ${path.channelId}/${path.modelName}/${path.protocol} 熔断锁繁忙，保留当前路由`)
        return await this.recordRouteFailureConservatively(path, outcomeAt)
      }

      const rows = await runner.query(
        `SELECT channelId, modelIdentity, modelName, protocol, consecutiveErrors, disabledUntil,
                totalRequests, failedRequests, lastSuccessAt, lastFailureAt, lastOutcomeAt
           FROM channel_route_health
          WHERE modelIdentity = ? AND protocol = ?
        `,
        [path.modelIdentity, path.protocol],
      )
      const persisted = new Map<string, RouteHealthState>()
      for (const row of rows || []) {
        const state = this.toRouteHealthState(row as ChannelRouteHealth)
        persisted.set(this.healthKey(state), state)
      }
      const previous = persisted.get(this.healthKey(path))
      const olderOutcome = !!previous?.lastOutcomeAt && previous.lastOutcomeAt > outcomeAt
      const event: RouteHealthState = {
        ...path,
        consecutiveErrors: (previous?.consecutiveErrors || 0) + 1,
        disabledUntil: previous?.disabledUntil || null,
        totalRequests: (previous?.totalRequests || 0) + 1,
        failedRequests: (previous?.failedRequests || 0) + 1,
        lastSuccessAt: previous?.lastSuccessAt || null,
        lastFailureAt: outcomeAt,
        lastOutcomeAt: outcomeAt,
      }
      if (!olderOutcome && Number(event.disabledUntil || 0) <= Date.now()) {
        event.disabledUntil = null
        if (this.autoCircuitBreakerEnabled && event.consecutiveErrors >= 3) {
          if (this.hasHealthyFallbackForPathInMap(event, this.modelMap, persisted, Date.now())) {
            event.disabledUntil = Date.now() + this.config.relay.channelDisableSeconds * 1000
            this.logger.warn(`路径 ${path.channelId}/${path.modelName}/${path.protocol} 连续失败 ${event.consecutiveErrors} 次，临时禁用 ${this.config.relay.channelDisableSeconds}s`)
          } else {
            this.logger.warn(`路径 ${path.channelId}/${path.modelName}/${path.protocol} 无已验证健康备用，保留最后路由`)
          }
        }
      }
      const state = olderOutcome
        ? {
            ...previous!,
            totalRequests: event.totalRequests,
            failedRequests: event.failedRequests,
          }
        : event
      await this.persistRouteOutcomeWithRunner(runner, event, 'failure')
      return state
    } catch (error: any) {
      this.logger.warn(`路径 ${path.channelId}/${path.modelName}/${path.protocol} 无法确认共享健康状态，保留当前路由：${error?.message || '数据库错误'}`)
      return await this.recordRouteFailureConservatively(path, outcomeAt)
    } finally {
      if (runner) {
        try {
          if (acquired) {
            const releaseRows = await runner.query('SELECT RELEASE_LOCK(?) AS released', [lockName])
            if (Number(releaseRows?.[0]?.released) !== 1) {
              this.logger.warn(`释放熔断锁异常：${lockName}`)
            }
          }
        } catch (error: any) {
          this.logger.warn(`释放熔断锁失败：${error?.message || '未知错误'}`)
        } finally {
          try {
            await runner.release()
          } catch (error: any) {
            // Releasing a broken connection must never override the completed
            // conservative routing decision or make the request fail.
            this.logger.warn(`释放熔断锁连接失败：${error?.message || '未知错误'}`)
          }
        }
      }
    }
  }

  /**
   * A named-lock timeout or a failed shared-state read is never allowed to
   * open a circuit. Persist a conditional failure marker when possible so a
   * different instance cannot keep treating this path's old success as
   * fallback evidence. The marker only clears this path's circuit; it never
   * disables any path and therefore remains safe without the named lock.
   */
  private async recordRouteFailureConservatively(
    path: Pick<RouteHealthState, 'channelId' | 'modelIdentity' | 'modelName' | 'protocol'>,
    outcomeAt: Date,
  ): Promise<RouteHealthState> {
    const state = this.recordRouteFailureInMemory(path, outcomeAt, false)
    try {
      await this.persistConservativeRouteFailure(state)
    } catch (error: any) {
      // If even this write fails, no instance that needs a fresh database read
      // can safely open a circuit for this report. Keeping this local path
      // enabled still guarantees this gateway retains a usable route.
      this.logger.warn(`路径 ${path.channelId}/${path.modelName}/${path.protocol} 无法持久化保守失败状态，继续保留当前路由：${error?.message || '数据库错误'}`)
    }
    return state
  }

  private recordRouteFailureInMemory(
    path: Pick<RouteHealthState, 'channelId' | 'modelIdentity' | 'modelName' | 'protocol'>,
    outcomeAt: Date,
    permitCircuitDecision: boolean,
  ): RouteHealthState {
    const previous = this.routeHealth.get(this.healthKey(path))
    const olderOutcome = !!previous?.lastOutcomeAt && previous.lastOutcomeAt > outcomeAt
    const event: RouteHealthState = {
      ...path,
      consecutiveErrors: (previous?.consecutiveErrors || 0) + 1,
      // A failed lock/query must never preserve a stale local circuit that
      // would remove the last usable route from this instance.
      disabledUntil: permitCircuitDecision ? previous?.disabledUntil || null : null,
      totalRequests: (previous?.totalRequests || 0) + 1,
      failedRequests: (previous?.failedRequests || 0) + 1,
      lastSuccessAt: previous?.lastSuccessAt || null,
      lastFailureAt: outcomeAt,
      lastOutcomeAt: outcomeAt,
    }
    if (permitCircuitDecision && this.autoCircuitBreakerEnabled && !olderOutcome
      && event.consecutiveErrors >= 3 && this.hasHealthyFallbackForPath(event)) {
      event.disabledUntil = Date.now() + this.config.relay.channelDisableSeconds * 1000
    }
    return olderOutcome
      ? {
          ...previous!,
          totalRequests: event.totalRequests,
          failedRequests: event.failedRequests,
          ...(permitCircuitDecision ? {} : { disabledUntil: null }),
        }
      : event
  }

  private circuitLockName(modelIdentity: string, protocol: RelayProtocol): string {
    // MySQL names must stay below 64 characters. The truncated SHA-256 digest
    // retains far more entropy than this application's path cardinality needs.
    const digest = createHash('sha256').update(`${modelIdentity}\u0000${protocol}`).digest('hex')
    return `mgto:cb:${digest.slice(0, 48)}`
  }

  /** A cold route is selectable for normal traffic, but cannot justify opening
   * another route's circuit until that exact model/protocol path has succeeded. */
  private hasHealthyFallbackForPath(path: RouteHealthState): boolean {
    return this.hasHealthyFallbackForPathInMap(path, this.modelMap, this.routeHealth, Date.now())
  }

  private hasHealthyFallbackForPathInMap(
    path: RouteHealthState,
    modelMap: Map<string, BindingRuntime[]>,
    routeHealth: Map<string, RouteHealthState>,
    now: number,
  ): boolean {
    const bindings = modelMap.get(path.modelName) || []
    return bindings.some((binding) => {
      if (binding.channelId === path.channelId || binding.modelIdentity !== path.modelIdentity) return false
      if (!binding.protocols.includes(path.protocol)) return false
      const candidate = routeHealth.get(this.routeKey(
        binding.channelId,
        binding.modelIdentity,
        path.protocol,
      ))
      return !!candidate
        && candidate.lastSuccessAt !== null
        && (!candidate.lastFailureAt || candidate.lastSuccessAt >= candidate.lastFailureAt)
        && candidate.consecutiveErrors === 0
        && Number(candidate.disabledUntil || 0) <= now
    })
  }

  private modelIdentity(model: ModelConfig): string {
    return Number.isInteger(Number(model.id)) ? `id:${Number(model.id)}` : `name:${model.name}`
  }

  private routeKey(channelId: number, modelIdentity: string, protocol: RelayProtocol): string {
    return `${channelId}:${modelIdentity}:${protocol}`
  }

  private healthKey(path: Pick<RouteHealthState, 'channelId' | 'modelIdentity' | 'protocol'>): string {
    return this.routeKey(path.channelId, path.modelIdentity, path.protocol)
  }

  private toRouteHealthState(health: ChannelRouteHealth): RouteHealthState {
    return {
      channelId: Number(health.channelId),
      modelIdentity: health.modelIdentity,
      modelName: health.modelName,
      protocol: health.protocol,
      consecutiveErrors: Number(health.consecutiveErrors || 0),
      disabledUntil: health.disabledUntil === null ? null : Number(health.disabledUntil),
      totalRequests: Number(health.totalRequests || 0),
      failedRequests: Number(health.failedRequests || 0),
      lastSuccessAt: health.lastSuccessAt || null,
      lastFailureAt: health.lastFailureAt || null,
      lastOutcomeAt: health.lastOutcomeAt || null,
    }
  }

  private pathsForOutcome(
    channelId: number,
    modelName?: string,
    protocol?: RelayProtocol,
  ): Array<Pick<RouteHealthState, 'channelId' | 'modelIdentity' | 'modelName' | 'protocol'>> {
    if (modelName && protocol) {
      const binding = (this.modelMap.get(modelName) || []).find((candidate) =>
        candidate.channelId === channelId && candidate.protocols.includes(protocol),
      )
      // A strict health outcome is valid only when it maps back to the exact
      // selected binding. Never manufacture a name-based path for a stale or
      // malformed caller, because it could become false fallback evidence.
      if (!binding) return []
      return [{
        channelId,
        modelIdentity: binding.modelIdentity,
        modelName,
        protocol,
      }]
    }
    // Compatibility callers without both dimensions are deliberately kept out
    // of route health. One channel-level success must not clear every route it
    // happens to serve, and one failure must not poison unrelated routes.
    return []
  }

  private isPathTemporarilyDisabled(
    channelId: number,
    modelIdentity: string,
    protocol: RelayProtocol,
    now: number,
  ): boolean {
    return Number(this.routeHealth.get(this.routeKey(channelId, modelIdentity, protocol))?.disabledUntil || 0) > now
  }

  private async withHealthWriteLock(path: Pick<RouteHealthState, 'channelId' | 'modelIdentity' | 'protocol'>, task: () => Promise<void>) {
    const key = this.healthKey(path)
    const previous = this.healthWriteLocks.get(key) || Promise.resolve()
    let release: () => void
    const current = new Promise<void>((resolve) => { release = resolve })
    const queued = previous.then(() => current)
    this.healthWriteLocks.set(key, queued)
    await previous
    try {
      await task()
    } finally {
      release!()
      if (this.healthWriteLocks.get(key) === queued) this.healthWriteLocks.delete(key)
    }
  }

  private async persistRouteOutcome(state: RouteHealthState, outcome: 'success' | 'failure') {
    if (!this.routeHealthRepo?.query) return
    await this.persistRouteOutcomeQuery(
      (sql, parameters) => this.routeHealthRepo!.query(sql, parameters),
      state,
      outcome,
    )
  }

  private async persistRouteOutcomeWithRunner(
    runner: QueryRunner,
    state: RouteHealthState,
    outcome: 'success' | 'failure',
  ) {
    await this.persistRouteOutcomeQuery(
      (sql, parameters) => runner.query(sql, parameters),
      state,
      outcome,
    )
  }

  private async persistConservativeRouteFailure(state: RouteHealthState) {
    if (!this.routeHealthRepo?.query) {
      throw new Error('路径健康仓储不可用')
    }
    // This write deliberately does not use this instance's cached error count.
    // If it wins the outcome timestamp race, it increments the persisted count
    // and clears only its own disabled marker. A concurrent successful outcome
    // with a newer timestamp remains authoritative.
    await this.routeHealthRepo.query(`
      INSERT INTO channel_route_health
        (channelId, modelIdentity, modelName, protocol, consecutiveErrors, disabledUntil,
         totalRequests, failedRequests, lastSuccessAt, lastFailureAt, lastOutcomeAt)
      VALUES (?, ?, ?, ?, 1, NULL, 1, 1, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        modelName = IF(lastOutcomeAt IS NULL OR lastOutcomeAt <= VALUES(lastOutcomeAt), VALUES(modelName), modelName),
        consecutiveErrors = IF(lastOutcomeAt IS NULL OR lastOutcomeAt <= VALUES(lastOutcomeAt), consecutiveErrors + 1, consecutiveErrors),
        disabledUntil = IF(lastOutcomeAt IS NULL OR lastOutcomeAt <= VALUES(lastOutcomeAt), NULL, disabledUntil),
        lastSuccessAt = IF(VALUES(lastSuccessAt) IS NOT NULL AND (lastSuccessAt IS NULL OR lastSuccessAt <= VALUES(lastSuccessAt)), VALUES(lastSuccessAt), lastSuccessAt),
        lastFailureAt = IF(VALUES(lastFailureAt) IS NOT NULL AND (lastFailureAt IS NULL OR lastFailureAt <= VALUES(lastFailureAt)), VALUES(lastFailureAt), lastFailureAt),
        lastOutcomeAt = IF(lastOutcomeAt IS NULL OR lastOutcomeAt <= VALUES(lastOutcomeAt), VALUES(lastOutcomeAt), lastOutcomeAt),
        totalRequests = totalRequests + 1,
        failedRequests = failedRequests + 1
    `, [
      state.channelId,
      state.modelIdentity,
      state.modelName,
      state.protocol,
      null,
      state.lastFailureAt,
      state.lastOutcomeAt,
    ])
  }

  private async persistRouteOutcomeQuery(
    query: (sql: string, parameters: unknown[]) => Promise<unknown>,
    state: RouteHealthState,
    outcome: 'success' | 'failure',
  ) {
    const failureDelta = outcome === 'failure' ? 1 : 0
    // lastOutcomeAt guards against a delayed persistence of an older success
    // resetting a newer failure from another process.
    await query(`
      INSERT INTO channel_route_health
        (channelId, modelIdentity, modelName, protocol, consecutiveErrors, disabledUntil,
         totalRequests, failedRequests, lastSuccessAt, lastFailureAt, lastOutcomeAt)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        modelName = IF(lastOutcomeAt IS NULL OR lastOutcomeAt <= VALUES(lastOutcomeAt), VALUES(modelName), modelName),
        consecutiveErrors = IF(lastOutcomeAt IS NULL OR lastOutcomeAt <= VALUES(lastOutcomeAt), VALUES(consecutiveErrors), consecutiveErrors),
        disabledUntil = IF(lastOutcomeAt IS NULL OR lastOutcomeAt <= VALUES(lastOutcomeAt), VALUES(disabledUntil), disabledUntil),
        lastSuccessAt = IF(VALUES(lastSuccessAt) IS NOT NULL AND (lastSuccessAt IS NULL OR lastSuccessAt <= VALUES(lastSuccessAt)), VALUES(lastSuccessAt), lastSuccessAt),
        lastFailureAt = IF(VALUES(lastFailureAt) IS NOT NULL AND (lastFailureAt IS NULL OR lastFailureAt <= VALUES(lastFailureAt)), VALUES(lastFailureAt), lastFailureAt),
        lastOutcomeAt = IF(lastOutcomeAt IS NULL OR lastOutcomeAt <= VALUES(lastOutcomeAt), VALUES(lastOutcomeAt), lastOutcomeAt),
        totalRequests = totalRequests + 1,
        failedRequests = failedRequests + VALUES(failedRequests)
    `, [
      state.channelId,
      state.modelIdentity,
      state.modelName,
      state.protocol,
      state.consecutiveErrors,
      state.disabledUntil,
      failureDelta,
      outcome === 'success' ? state.lastSuccessAt : null,
      outcome === 'failure' ? state.lastFailureAt : null,
      state.lastOutcomeAt,
    ])
  }

  private async persistRouteCircuitClear(state: RouteHealthState) {
    if (!this.routeHealthRepo?.update) return
    await this.routeHealthRepo.update({
      channelId: state.channelId,
      modelIdentity: state.modelIdentity,
      protocol: state.protocol,
    } as any, { disabledUntil: null } as any)
  }

  private async persistRouteRecovery(state: RouteHealthState) {
    if (!this.routeHealthRepo?.update) return
    await this.routeHealthRepo.update({
      channelId: state.channelId,
      modelIdentity: state.modelIdentity,
      protocol: state.protocol,
    } as any, {
      consecutiveErrors: 0,
      disabledUntil: null,
    } as any)
  }

  private rebuildChannelHealthSummary(
    routeHealth: Map<string, RouteHealthState>,
    base: Map<number, ChannelHealthBase>,
    errors: Map<number, number>,
    disabled: Map<number, number>,
    now: number,
  ) {
    for (const state of routeHealth.values()) {
      const existingErrors = errors.get(state.channelId) || 0
      errors.set(state.channelId, Math.max(existingErrors, state.consecutiveErrors))
      if (Number(state.disabledUntil || 0) > now) {
        disabled.set(state.channelId, Math.max(disabled.get(state.channelId) || 0, Number(state.disabledUntil)))
      }
      const channel = base.get(state.channelId)
      if (!channel) continue
      if (!channel.lastSuccessAt || (state.lastSuccessAt && channel.lastSuccessAt < state.lastSuccessAt)) {
        channel.lastSuccessAt = state.lastSuccessAt
      }
      if (!channel.lastFailureAt || (state.lastFailureAt && channel.lastFailureAt < state.lastFailureAt)) {
        channel.lastFailureAt = state.lastFailureAt
      }
    }
  }

  private async recordChannelSummary(
    channelId: number,
    outcome: 'success' | 'failure',
    unscopedCompatibilityOutcome = false,
  ) {
    const now = new Date()
    const base = this.channelHealthBase.get(channelId)
    if (base) {
      base.totalRequests++
      if (outcome === 'success') base.lastSuccessAt = now
      else {
        base.failedRequests++
        base.lastFailureAt = now
      }
    }
    const states = [...this.routeHealth.values()].filter((state) => state.channelId === channelId)
    // Legacy channel-only calls remain visible to the management screen, but
    // are intentionally excluded from route selection and fallback checks.
    const errors = unscopedCompatibilityOutcome
      ? outcome === 'success'
        ? 0
        : (this.channelErrors.get(channelId) || 0) + 1
      : Math.max(0, ...states.map((state) => state.consecutiveErrors))
    const until = Math.max(0, ...states.map((state) => Number(state.disabledUntil || 0))) || null
    if (errors) this.channelErrors.set(channelId, errors)
    else this.channelErrors.delete(channelId)
    if (until && until > Date.now()) this.channelStatus.set(channelId, until)
    else this.channelStatus.delete(channelId)
    if (!this.channelRepo.update) return
    await this.channelRepo.update(channelId, {
      totalRequests: () => 'totalRequests + 1',
      ...(outcome === 'failure' ? { failedRequests: () => 'failedRequests + 1', lastFailureAt: now } : { lastSuccessAt: now }),
      consecutiveErrors: errors,
      disabledUntil: until,
    } as any)
  }

  async recover(channelId: number): Promise<ChannelHealthSnapshot | null> {
    for (const state of this.routeHealth.values()) {
      if (state.channelId !== channelId) continue
      state.consecutiveErrors = 0
      state.disabledUntil = null
      await this.persistRouteRecovery(state)
    }
    this.channelErrors.delete(channelId)
    this.channelStatus.delete(channelId)
    await this.channelRepo.update(channelId, {
      consecutiveErrors: 0,
      disabledUntil: null,
    } as any)
    return this.health(channelId)
  }
}
