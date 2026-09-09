import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { InjectRepository } from '@nestjs/typeorm'
import { LessThan, Repository } from 'typeorm'
import { AppConfig } from '@/config/configuration'
import { CryptoUtil } from '@/common/utils/crypto.util'
import { SupplierAccount } from '@/entities/supplier-account.entity'
import { SupplierAccountSnapshotEntity } from '@/entities/supplier-account-snapshot.entity'
import { Supplier } from '@/entities/supplier.entity'
import { CCTQ_BASE_URL, classifyCctqError, normalizeSyncInterval } from './cctq-account.policy'
import { SupplierAccountSnapshot } from '@/common/types/supplier-account.types'
import { SupplierAccountAdapterRegistry } from '@/modules/supplier-account/supplier-account-adapter.registry'
import { SupplierAccountAdapterError } from '@/modules/supplier-account/supplier-account-adapter'
import { SupplierAccountSyncLockService } from '@/modules/supplier-account/supplier-account-sync-lock.service'

export interface SaveCctqAccountInput {
  dashboardToken?: string
  apiKey?: string
  credentialType?: 'dashboard' | 'api_key'
  enabled?: boolean
  syncIntervalMinutes?: number
}

@Injectable()
export class CctqAccountService {
  private readonly logger = new Logger(CctqAccountService.name)
  private syncing = false

  constructor(
    @InjectRepository(SupplierAccount)
    private readonly accountRepo: Repository<SupplierAccount>,
    @InjectRepository(SupplierAccountSnapshotEntity)
    private readonly snapshotRepo: Repository<SupplierAccountSnapshotEntity>,
    @InjectRepository(Supplier)
    private readonly supplierRepo: Repository<Supplier>,
    @Inject('APP_CONFIG') private readonly config: AppConfig,
    private readonly adapterRegistry: SupplierAccountAdapterRegistry,
    private readonly syncLock: SupplierAccountSyncLockService,
  ) {}

  async getState() {
    const account = await this.accountRepo.findOne({ where: { code: 'cctq-global' } })
    const history = await this.snapshotRepo.find({
      where: account ? { supplierAccountId: account.id } : undefined,
      order: { capturedAt: 'DESC' },
      take: 72,
    })
    return this.toPublicState(account, history.reverse())
  }

  async save(input: SaveCctqAccountInput) {
    const existingAccount = await this.accountRepo.findOne({ where: { code: 'cctq-global' } })
    const credential = this.resolveCredentialInput(
      input,
      existingAccount?.adapterCode,
      Boolean(existingAccount?.credentialEncrypted),
    )
    const interval = input.syncIntervalMinutes === undefined
      ? undefined
      : this.applyPolicy(() => normalizeSyncInterval(input.syncIntervalMinutes))

    if (credential.value) {
      // 先验证新凭据，失败时保留原凭据和最后成功快照。
      const remote = await this.fetchRemoteSnapshot(credential.value, undefined, credential.adapterCode)
      let account = existingAccount || await this.getOrCreateAccount()
      const previousModels = Array.isArray(account.models) ? account.models : []
      if (credential.adapterCode === 'cctq-api-key') remote.models = previousModels
      account.adapterCode = credential.adapterCode
      account.credentialEncrypted = CryptoUtil.encrypt(credential.value, this.config.jwt.secret)
      account.enabled = input.enabled === false ? 0 : 1
      if (interval !== undefined) account.syncIntervalMinutes = interval
      account = await this.applySuccess(account, remote)
      await this.syncModelsBestEffort(account, credential.adapterCode, credential.value)
      return this.getState()
    }

    const account = existingAccount || await this.getOrCreateAccount()
    if (input.enabled === true && !account.credentialEncrypted) {
      throw new BadRequestException('请先配置 CCTQ Dashboard Access Token')
    }
    if (input.enabled !== undefined) account.enabled = input.enabled ? 1 : 0
    if (interval !== undefined) account.syncIntervalMinutes = interval
    await this.accountRepo.save(account)
    return this.getState()
  }

  async synchronize(source: 'manual' | 'scheduled' = 'manual') {
    if (this.syncing) {
      if (source === 'scheduled') return this.getState()
      throw new ConflictException('CCTQ 账户正在同步')
    }
    this.syncing = true
    let lock: Awaited<ReturnType<SupplierAccountSyncLockService['tryAcquire']>>
    try {
      // cctq-global is a SupplierAccount as well, so it shares the same
      // cross-instance lock with the generic account synchronization path.
      const initialAccount = await this.accountRepo.findOne({ where: { code: 'cctq-global' } })
      if (!initialAccount?.credentialEncrypted) {
        throw new BadRequestException('CCTQ 账户尚未配置')
      }
      lock = await this.syncLock.tryAcquire(Number(initialAccount.id))
      if (!lock) {
        if (source === 'scheduled') return this.getState()
        throw new ConflictException('CCTQ 账户正在同步')
      }

      const account = await this.accountRepo.findOne({ where: { code: 'cctq-global' } })
      if (!account?.credentialEncrypted) {
        throw new BadRequestException('CCTQ 账户尚未配置')
      }
      if (source === 'scheduled' && !this.isSyncDue(account)) return this.getState()

      let token: string
      try {
        token = CryptoUtil.decrypt(account.credentialEncrypted, this.config.jwt.secret)
      } catch {
        account.lastAttemptAt = new Date()
        account.lastSyncStatus = 'credential_invalid'
        account.lastErrorCode = 'decrypt_failed'
        account.lastErrorMessage = 'CCTQ 凭据无法解密，请重新配置'
        await this.accountRepo.save(account)
        throw new BadRequestException(account.lastErrorMessage)
      }
      const adapterCode = account.adapterCode || 'cctq'
      const remote = await this.fetchRemoteSnapshot(token, account, adapterCode)
      if (adapterCode === 'cctq-api-key') {
        remote.models = Array.isArray(account.models) ? account.models : []
      }
      await this.applySuccess(account, remote)
      await this.syncModelsBestEffort(account, adapterCode, token)
      return this.getState()
    } finally {
      try {
        await lock?.release()
      } finally {
        this.syncing = false
      }
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async scheduledSync() {
    const account = await this.accountRepo.findOne({ where: { code: 'cctq-global' } })
    if (!account?.enabled || !account.credentialEncrypted || this.syncing) return
    if (!this.isSyncDue(account)) return
    try {
      await this.synchronize('scheduled')
    } catch (error) {
      this.logger.warn(`CCTQ 定时同步失败：${error?.message || '未知错误'}`)
    }
  }

  private isSyncDue(account: SupplierAccount) {
    const intervalMs = Math.max(5, Number(account.syncIntervalMinutes) || 10) * 60_000
    const lastAttempt = account.lastAttemptAt?.getTime() || 0
    return Date.now() - lastAttempt >= intervalMs
  }

  private async fetchRemoteSnapshot(
    token: string,
    existingAccount?: SupplierAccount,
    adapterCode = 'cctq',
  ): Promise<SupplierAccountSnapshot> {
    try {
      return await this.adapterRegistry.require(adapterCode).fetchSnapshot(token)
    } catch (error) {
      const failure = error instanceof SupplierAccountAdapterError
        ? {
            code: error.code,
            message: error.message,
            credentialInvalid: error.credentialInvalid,
          }
        : classifyCctqError(error)
      if (existingAccount) {
        existingAccount.lastAttemptAt = new Date()
        existingAccount.lastSyncStatus = failure.credentialInvalid ? 'credential_invalid' : 'stale'
        existingAccount.lastErrorCode = failure.code
        existingAccount.lastErrorMessage = failure.message
        await this.accountRepo.save(existingAccount)
      }
      throw new BadRequestException(failure.message)
    }
  }

  private async applySuccess(account: SupplierAccount, remote: SupplierAccountSnapshot) {
    const optionalWarnings = remote.optionalDataWarnings || []
    const failedOptionalSources = new Set(optionalWarnings.map((warning) => warning.source))
    const preserveGroups = failedOptionalSources.has('groups')
    const preserveModels = failedOptionalSources.has('models')
    const preserveSubscriptions = failedOptionalSources.has('subscriptions')
    const optionalWarningMessage = optionalWarnings.length
      ? `CCTQ 附加数据同步失败：${optionalWarnings.map((warning) => warning.source).join('、')}（已保留上次数据）`
      : null
    Object.assign(account, {
      externalAccountId: remote.externalAccountId,
      displayName: remote.displayName,
      accountGroup: remote.accountGroup,
      quotaAvailableRaw: remote.quotaAvailableRaw,
      quotaUsedRaw: remote.quotaUsedRaw,
      requestCount: remote.requestCount,
      last30dQuotaRaw: remote.last30dQuotaRaw,
      rpm: remote.rpm,
      tpm: remote.tpm,
      quotaDisplayType: remote.quotaDisplayType,
      quotaPerUnit: remote.quotaPerUnit,
      usdExchangeRate: remote.usdExchangeRate,
      billingPreference: preserveSubscriptions ? account.billingPreference : remote.billingPreference,
      subscriptions: preserveSubscriptions ? account.subscriptions : remote.subscriptions,
      groups: preserveGroups ? account.groups : remote.groups,
      models: preserveModels ? account.models : remote.models,
      unlimitedQuota: remote.unlimitedQuota ? 1 : 0,
      expiresAt: this.normalizeExpiresAt(remote.expiresAt),
      modelLimits: remote.modelLimits || null,
      modelLimitsEnabled: remote.modelLimitsEnabled ? 1 : 0,
      lastAttemptAt: new Date(),
      lastSyncAt: new Date(),
      lastSyncStatus: 'healthy',
      lastErrorCode: optionalWarnings.length ? 'optional_sync_failed' : null,
      lastErrorMessage: optionalWarningMessage,
    })
    const saved = await this.accountRepo.save(account)
    await this.snapshotRepo.save(this.snapshotRepo.create({
      supplierAccountId: saved.id,
      quotaAvailableRaw: remote.quotaAvailableRaw,
      quotaUsedRaw: remote.quotaUsedRaw,
      requestCount: remote.requestCount,
      last30dQuotaRaw: remote.last30dQuotaRaw,
    }))
    const retentionStart = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
    await this.snapshotRepo.delete({ capturedAt: LessThan(retentionStart) })
    for (const warning of optionalWarnings) {
      this.logger.warn(`CCTQ 附加数据同步失败：${warning.source}（${warning.code}），已保留上次数据`)
    }
    return saved
  }

  /**
   * API Key 额度和模型目录是两个独立上游契约。模型目录失败时保留上次目录，
   * 额度仍保持 healthy，避免把可用余额误判为账户或渠道故障。
   */
  private async syncModelsBestEffort(
    account: SupplierAccount,
    adapterCode: string,
    credential: string,
  ) {
    const adapter = this.adapterRegistry.get(adapterCode)
    if (!adapter?.fetchModels) return
    try {
      account.models = await adapter.fetchModels(credential)
      await this.accountRepo.save(account)
    } catch (error) {
      const failure = this.normalizeAdapterError(error)
      account.lastSyncStatus = 'healthy'
      account.lastErrorCode = `models_${failure.code}`
      account.lastErrorMessage = `模型目录同步失败：${failure.message}`
      await this.accountRepo.save(account)
      this.logger.warn(`CCTQ 模型目录同步失败，保留上次目录：${failure.message}`)
    }
  }

  private normalizeAdapterError(error: unknown) {
    if (error instanceof SupplierAccountAdapterError) {
      return {
        code: error.code,
        message: error.message,
        credentialInvalid: error.credentialInvalid,
      }
    }
    return {
      code: 'sync_failed',
      message: '供应商账户同步失败',
      credentialInvalid: false,
    }
  }

  private async getOrCreateAccount() {
    const existing = await this.accountRepo.findOne({ where: { code: 'cctq-global' } })
    if (existing) return existing
    let supplier = await this.supplierRepo.findOne({ where: { code: 'cctq' } })
    if (!supplier) {
      supplier = await this.supplierRepo.save(this.supplierRepo.create({
        code: 'cctq',
        name: 'CCTQ',
        kind: 'third_party',
        website: CCTQ_BASE_URL,
        status: 1,
      }))
    }
    return this.accountRepo.create({
      code: 'cctq-global',
      supplierId: supplier.id,
      adapterCode: 'cctq',
      name: 'CCTQ 全局账户',
      credentialEncrypted: null,
      enabled: 0,
      syncIntervalMinutes: 10,
      lastSyncStatus: 'unconfigured',
    })
  }

  private toPublicState(account: SupplierAccount | null, history: SupplierAccountSnapshotEntity[]) {
    if (!account) {
      return {
        configured: false,
        enabled: false,
        baseUrl: CCTQ_BASE_URL,
        syncIntervalMinutes: 10,
        lastSyncStatus: 'unconfigured',
        unlimitedQuota: false,
        quotaAvailableDisplay: null,
        expiresAt: 0,
        expiresStatus: 'never',
        modelLimits: {},
        modelLimitsEnabled: false,
        history: [],
      }
    }
    const { credentialEncrypted, ...safe } = account
    const unlimitedQuota = account.unlimitedQuota === 1
    const expiresAt = this.normalizeExpiresAt(account.expiresAt)
    return {
      ...safe,
      configured: Boolean(credentialEncrypted),
      enabled: account.enabled === 1,
      baseUrl: CCTQ_BASE_URL,
      credentialType: account.adapterCode === 'cctq-api-key' ? 'api_key' : 'dashboard',
      credentialLabel: account.adapterCode === 'cctq-api-key' ? 'API Key' : 'Dashboard Token',
      unlimitedQuota,
      quotaAvailableDisplay: unlimitedQuota ? '无限额' : null,
      expiresAt,
      expiresStatus: this.getExpiresStatus(expiresAt),
      modelLimits: account.modelLimits || {},
      modelLimitsEnabled: account.modelLimitsEnabled === 1,
      history,
    }
  }

  private normalizeExpiresAt(value: unknown) {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0
  }

  private getExpiresStatus(expiresAt: number): 'never' | 'active' | 'expired' {
    if (expiresAt === 0) return 'never'
    return expiresAt * 1000 <= Date.now() ? 'expired' : 'active'
  }

  private resolveCredentialInput(
    input: SaveCctqAccountInput,
    currentAdapterCode?: string,
    hasExistingCredential = false,
  ): {
    value: string
    adapterCode: 'cctq' | 'cctq-api-key'
  } {
    const dashboardToken = String(input.dashboardToken || '').trim()
    const apiKey = String(input.apiKey || '').trim()
    if (dashboardToken && apiKey) {
      throw new BadRequestException('Dashboard Token 和 API Key 只能配置一个')
    }
    if (input.credentialType !== undefined
      && input.credentialType !== 'dashboard'
      && input.credentialType !== 'api_key') {
      throw new BadRequestException('credentialType 必须是 dashboard 或 api_key')
    }
    if (input.credentialType === 'api_key' && dashboardToken) {
      throw new BadRequestException('credentialType=api_key 时必须提供 apiKey')
    }
    if (input.credentialType === 'dashboard' && apiKey) {
      throw new BadRequestException('credentialType=dashboard 时必须提供 dashboardToken')
    }
    const value = apiKey || dashboardToken
    if (!value) {
      const requestedAdapter = input.credentialType === 'api_key'
        ? 'cctq-api-key'
        : input.credentialType === 'dashboard'
          ? 'cctq'
          : currentAdapterCode
      if (
        hasExistingCredential
        && requestedAdapter
        && requestedAdapter !== currentAdapterCode
      ) {
        throw new BadRequestException('切换 CCTQ 凭据类型时必须同时提供新凭据')
      }
      return {
        value: '',
        adapterCode: input.credentialType === 'api_key' ? 'cctq-api-key' : 'cctq',
      }
    }
    const adapterCode = input.credentialType === 'api_key' || apiKey
      ? 'cctq-api-key'
      : input.credentialType === 'dashboard'
        ? 'cctq'
        : currentAdapterCode === 'cctq-api-key'
          ? 'cctq-api-key'
          : 'cctq'
    return { value, adapterCode }
  }

  private applyPolicy<T>(fn: () => T): T {
    try {
      return fn()
    } catch (error) {
      throw new BadRequestException(error?.message || 'CCTQ 配置错误')
    }
  }
}
