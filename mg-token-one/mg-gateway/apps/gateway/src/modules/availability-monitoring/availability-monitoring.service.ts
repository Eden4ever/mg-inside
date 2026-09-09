import { Inject, Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { InjectRepository } from '@nestjs/typeorm'
import { DataSource, EntityManager, Repository } from 'typeorm'
import { RequestLog } from '@/entities/request-log.entity'
import { AvailabilityAlertEvent } from '@/entities/availability-alert-event.entity'
import { AvailabilityAlertState } from '@/entities/availability-alert-state.entity'
import { AppConfig } from '@/config/configuration'
import {
  AvailabilityAlertFinding,
  AvailabilityAlertRecoveryEvidence,
  AvailabilityAlertMetricRow,
  AVAILABILITY_ALERT_RECOVERY_WINDOWS,
  AVAILABILITY_ALERT_SUPPRESSION_MS,
  AVAILABILITY_ALERT_WINDOW_MINUTES,
  availabilityAlertFingerprint,
  buildAvailabilityAlertSnapshot,
} from './availability-alert.policy'

export interface AvailabilityAlertEvaluation {
  skipped: boolean
  windowMinutes: number
  windowEndAt: Date
  findings: number
  triggered: number
  suppressed: number
  recovered: number
  active: number
}

interface AlertIdentity {
  fingerprint: string
  protocol: string
  model: string
  channelId: number | null
  errorClass: string
}

@Injectable()
export class AvailabilityMonitoringService {
  private readonly logger = new Logger(AvailabilityMonitoringService.name)
  private evaluating = false

  constructor(
    @InjectRepository(RequestLog)
    private readonly logRepo: Repository<RequestLog>,
    @InjectRepository(AvailabilityAlertState)
    private readonly stateRepo: Repository<AvailabilityAlertState>,
    @InjectRepository(AvailabilityAlertEvent)
    private readonly eventRepo: Repository<AvailabilityAlertEvent>,
    private readonly dataSource: DataSource,
    @Inject('APP_CONFIG') private readonly config: AppConfig,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async scheduledEvaluate() {
    if (!this.config.availabilityMonitoring.schedulerEnabled) return
    try {
      await this.evaluate()
    } catch (error: any) {
      this.logger.error(`可用性告警评估失败：${error?.message || error}`)
    }
  }

  /**
   * 只读请求日志，并只写自身的状态/事件表。这里绝不注入或调用渠道、路由、额度服务。
   */
  async evaluate(now = new Date()): Promise<AvailabilityAlertEvaluation> {
    if (this.evaluating) {
      return this.emptyEvaluation(now, true)
    }
    this.evaluating = true
    try {
      const from = new Date(now.getTime() - AVAILABILITY_ALERT_WINDOW_MINUTES * 60_000)
      const snapshot = buildAvailabilityAlertSnapshot(await this.loadMetrics(from, now))
      const { findings, recoveryEvidenceByFingerprint } = snapshot
      const activeStates = await this.stateRepo.find({ where: { active: 1 } })
      const findingByFingerprint = new Map(findings.map((finding) => [finding.fingerprint, finding]))
      const result = this.emptyEvaluation(now, false)
      result.findings = findings.length

      for (const finding of findings) {
        const transition = await this.transitionFailure(finding, now)
        result.triggered += transition.triggered
        result.suppressed += transition.suppressed
      }
      for (const state of activeStates) {
        if (findingByFingerprint.has(state.fingerprint)) continue
        // 空窗口或其他渠道的成功都不能证明这个告警指纹已经健康。
        const recoveryEvidence = recoveryEvidenceByFingerprint.get(state.fingerprint)
        if (!recoveryEvidence) continue
        const transition = await this.transitionHealthy(
          this.identityFromState(state),
          recoveryEvidence,
          now,
        )
        result.recovered += transition.recovered
      }
      result.active = await this.stateRepo.count({ where: { active: 1 } })
      return result
    } finally {
      this.evaluating = false
    }
  }

  async listStates(page = 1, pageSize = 20, active?: boolean) {
    const where = active === undefined ? undefined : { active: active ? 1 : 0 }
    const [list, total] = await this.stateRepo.findAndCount({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      order: { active: 'DESC', updatedAt: 'DESC', id: 'DESC' },
    })
    return { list, total, page, pageSize }
  }

  async listEvents(page = 1, pageSize = 20, fingerprint?: string) {
    const where = fingerprint ? { fingerprint } : undefined
    const [list, total] = await this.eventRepo.findAndCount({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      order: { occurredAt: 'DESC', id: 'DESC' },
    })
    return { list, total, page, pageSize }
  }

  private async loadMetrics(from: Date, now: Date): Promise<AvailabilityAlertMetricRow[]> {
    const rows = await this.logRepo
      .createQueryBuilder('l')
      .select('l.protocol', 'protocol')
      .addSelect('l.model', 'model')
      .addSelect('l.channelId', 'channelId')
      // 请求数与失败数排除调用方主动取消，避免慢网络误伤服务可用性。
      .addSelect("SUM(CASE WHEN l.errorCode = 'client_disconnected' THEN 0 ELSE 1 END)", 'requests')
      .addSelect('SUM(CASE WHEN l.status = 1 THEN 1 ELSE 0 END)', 'successes')
      .addSelect("SUM(CASE WHEN l.status = 0 AND (l.errorCode IS NULL OR l.errorCode <> 'client_disconnected') THEN 1 ELSE 0 END)", 'serviceFailures')
      .addSelect("SUM(CASE WHEN l.errorCode = 'no_responses_channel' THEN 1 ELSE 0 END)", 'noResponsesFailures')
      .addSelect("SUM(CASE WHEN l.status = 0 AND l.responseStatus BETWEEN 500 AND 599 AND (l.errorCode IS NULL OR l.errorCode NOT IN ('client_disconnected', 'no_responses_channel')) THEN 1 ELSE 0 END)", 'server5xxFailures')
      .where('l.createdAt >= :from', { from })
      .andWhere('l.createdAt <= :now', { now })
      .groupBy('l.protocol')
      .addGroupBy('l.model')
      .addGroupBy('l.channelId')
      .getRawMany()
    return rows.map((row: any) => ({
      protocol: String(row.protocol || ''),
      model: String(row.model || ''),
      channelId: row.channelId === null || row.channelId === undefined ? null : Number(row.channelId),
      requests: this.numberValue(row.requests),
      successes: this.numberValue(row.successes),
      serviceFailures: this.numberValue(row.serviceFailures),
      noResponsesFailures: this.numberValue(row.noResponsesFailures),
      server5xxFailures: this.numberValue(row.server5xxFailures),
    })).filter((row) => row.protocol && row.model)
  }

  private async transitionFailure(finding: AvailabilityAlertFinding, now: Date) {
    return this.dataSource.transaction(async (manager) => {
      const state = await this.lockState(manager, finding)
      const evaluationKey = this.evaluationKey(now)
      if (state.lastEvaluationKey === evaluationKey) {
        return { triggered: 0, suppressed: 0 }
      }
      state.lastEvaluationKey = evaluationKey
      state.lastEvaluatedAt = now
      state.consecutiveHealthyWindows = 0
      if (state.active === 1) {
        await manager.getRepository(AvailabilityAlertState).save(state)
        return { triggered: 0, suppressed: 0 }
      }

      state.active = 1
      const suppressed = state.lastTriggeredAt !== null
        && now.getTime() - state.lastTriggeredAt.getTime() < AVAILABILITY_ALERT_SUPPRESSION_MS
      if (!suppressed) {
        state.lastTriggeredAt = now
      }
      await manager.getRepository(AvailabilityAlertState).save(state)
      if (!suppressed) {
        await this.recordEvent(manager, state, 'triggered', finding, now)
        return { triggered: 1, suppressed: 0 }
      }
      return { triggered: 0, suppressed: 1 }
    })
  }

  private async transitionHealthy(
    identity: AlertIdentity,
    recoveryEvidence: AvailabilityAlertRecoveryEvidence,
    now: Date,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const state = await this.lockState(manager, identity)
      if (state.active !== 1) return { recovered: 0 }
      const evaluationKey = this.evaluationKey(now)
      if (state.lastEvaluationKey === evaluationKey) return { recovered: 0 }
      state.lastEvaluationKey = evaluationKey
      state.lastEvaluatedAt = now
      state.consecutiveHealthyWindows += 1
      if (state.consecutiveHealthyWindows < AVAILABILITY_ALERT_RECOVERY_WINDOWS) {
        await manager.getRepository(AvailabilityAlertState).save(state)
        return { recovered: 0 }
      }

      state.active = 0
      state.consecutiveHealthyWindows = 0
      state.lastRecoveredAt = now
      await manager.getRepository(AvailabilityAlertState).save(state)
      await this.recordEvent(manager, state, 'recovered', recoveryEvidence, now)
      return { recovered: 1 }
    })
  }

  private async lockState(manager: EntityManager, identity: AlertIdentity): Promise<AvailabilityAlertState> {
    // 唯一键先占位，再加行锁：同一应用并发和多实例同时评估都只会发生一次状态转换。
    await manager.query(
      `INSERT IGNORE INTO availability_alert_states
        (fingerprint, protocol, model, channelId, errorClass, active, consecutiveHealthyWindows)
       VALUES (?, ?, ?, ?, ?, 0, 0)`,
      [identity.fingerprint, identity.protocol, identity.model, identity.channelId, identity.errorClass],
    )
    const state = await manager.getRepository(AvailabilityAlertState).findOne({
      where: { fingerprint: identity.fingerprint },
      lock: { mode: 'pessimistic_write' },
    })
    if (!state) throw new Error(`无法锁定可用性告警状态：${identity.fingerprint}`)
    return state
  }

  private async recordEvent(
    manager: EntityManager,
    state: AvailabilityAlertState,
    eventType: 'triggered' | 'recovered',
    finding: Pick<AvailabilityAlertFinding, 'requests' | 'successes' | 'serviceFailures' | 'serviceSuccessRate' | 'matchingFailures'>,
    now: Date,
  ) {
    await manager.getRepository(AvailabilityAlertEvent).insert({
      stateId: state.id,
      fingerprint: state.fingerprint,
      protocol: state.protocol,
      model: state.model,
      channelId: state.channelId,
      errorClass: state.errorClass,
      eventType,
      windowMinutes: AVAILABILITY_ALERT_WINDOW_MINUTES,
      requests: finding.requests,
      successes: finding.successes,
      serviceFailures: finding.serviceFailures,
      matchingFailures: finding.matchingFailures,
      serviceSuccessRate: finding.serviceSuccessRate,
      windowEndAt: now,
    } as any)
  }

  private identityFromState(state: AvailabilityAlertState): AlertIdentity {
    return {
      fingerprint: state.fingerprint,
      protocol: state.protocol,
      model: state.model,
      channelId: state.channelId,
      errorClass: state.errorClass,
    }
  }

  private emptyEvaluation(now: Date, skipped: boolean): AvailabilityAlertEvaluation {
    return {
      skipped,
      windowMinutes: AVAILABILITY_ALERT_WINDOW_MINUTES,
      windowEndAt: now,
      findings: 0,
      triggered: 0,
      suppressed: 0,
      recovered: 0,
      active: 0,
    }
  }

  private numberValue(value: unknown): number {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }

  private evaluationKey(now: Date): string {
    return `${now.toISOString().slice(0, 16)}:00Z`
  }
}
