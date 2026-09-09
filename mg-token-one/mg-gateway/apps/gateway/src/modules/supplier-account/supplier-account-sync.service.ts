import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { InjectRepository } from '@nestjs/typeorm'
import { LessThan, Repository } from 'typeorm'
import { AppConfig } from '@/config/configuration'
import { CryptoUtil } from '@/common/utils/crypto.util'
import { SupplierAccountSnapshot } from '@/common/types/supplier-account.types'
import { Supplier } from '@/entities/supplier.entity'
import { SupplierAccount } from '@/entities/supplier-account.entity'
import { SupplierAccountSnapshotEntity } from '@/entities/supplier-account-snapshot.entity'
import {
  SupplierAccountAdapter,
  SupplierAccountAdapterError,
} from './supplier-account-adapter'
import { SupplierAccountAdapterRegistry } from './supplier-account-adapter.registry'
import { SupplierAccountSyncLockService } from './supplier-account-sync-lock.service'

export interface SaveSupplierAccountCredentialInput {
  credential?: string
  enabled?: boolean
  syncIntervalMinutes?: number
}

@Injectable()
export class SupplierAccountSyncService {
  private readonly logger = new Logger(SupplierAccountSyncService.name)
  private readonly syncingAccountIds = new Set<number>()

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

  async getState(idValue: unknown) {
    const account = await this.requireAccount(idValue)
    const { supplier, adapter } = await this.requireConfigurableAdapter(account)
    const history = await this.snapshotRepo.find({
      where: { supplierAccountId: account.id },
      order: { capturedAt: 'DESC' },
      take: 72,
    })
    return this.toPublicState(account, supplier, adapter, history.reverse())
  }

  async saveCredential(idValue: unknown, input: SaveSupplierAccountCredentialInput) {
    const account = await this.requireAccount(idValue)
    const { supplier, adapter } = await this.requireConfigurableAdapter(account)
    const credential = String(input.credential || '').trim()
    const interval = input.syncIntervalMinutes === undefined
      ? undefined
      : this.normalizeSyncInterval(input.syncIntervalMinutes)

    if (credential) {
      const { remote, modelWarning } = await this.fetchForValidation(
        adapter,
        credential,
        Array.isArray(account.models) ? account.models : [],
      )
      account.credentialEncrypted = CryptoUtil.encrypt(credential, this.config.jwt.secret)
      account.enabled = input.enabled === false ? 0 : 1
      if (interval !== undefined) account.syncIntervalMinutes = interval
      await this.applySuccess(account, remote, modelWarning)
      return this.getState(account.id)
    }

    if (input.enabled === true && !account.credentialEncrypted) {
      throw new BadRequestException('请先配置账户凭据')
    }
    if (input.enabled !== undefined) {
      if (typeof input.enabled !== 'boolean') throw new BadRequestException('enabled 必须是布尔值')
      account.enabled = input.enabled ? 1 : 0
    }
    if (interval !== undefined) account.syncIntervalMinutes = interval
    await this.accountRepo.save(account)
    return this.toPublicState(
      account,
      supplier,
      adapter,
      await this.loadHistory(account.id),
    )
  }

  async synchronize(idValue: unknown, source: 'manual' | 'scheduled' = 'manual') {
    const id = this.parseAccountId(idValue)
    if (this.syncingAccountIds.has(id)) {
      if (source === 'scheduled') return null
      throw new ConflictException('供应商账户正在同步')
    }

    this.syncingAccountIds.add(id)
    let lock: Awaited<ReturnType<SupplierAccountSyncLockService['tryAcquire']>>
    try {
      lock = await this.syncLock.tryAcquire(id)
      if (!lock) {
        if (source === 'scheduled') return null
        throw new ConflictException('供应商账户正在同步')
      }

      // Another instance may have completed while this process waited for the
      // database lock. Re-read before deciding whether the scheduled window is due.
      const account = await this.requireAccount(id)
      if (source === 'scheduled' && !this.isSyncDue(account)) return null
      const { adapter } = await this.requireConfigurableAdapter(account)
      if (!account.credentialEncrypted) throw new BadRequestException('供应商账户尚未配置凭据')

      let credential: string
      try {
        credential = CryptoUtil.decrypt(account.credentialEncrypted, this.config.jwt.secret)
      } catch {
        await this.applyFailure(account, {
          code: 'decrypt_failed',
          message: '账户凭据无法解密，请重新配置',
          credentialInvalid: true,
        })
        throw new BadRequestException('账户凭据无法解密，请重新配置')
      }

      try {
        const { remote, modelWarning } = await this.fetchWithOptionalModels(
          adapter,
          credential,
          Array.isArray(account.models) ? account.models : [],
        )
        await this.applySuccess(account, remote, modelWarning)
        return this.getState(id)
      } catch (error) {
        const failure = this.normalizeAdapterError(error)
        await this.applyFailure(account, failure)
        throw new BadRequestException(failure.message)
      }
    } finally {
      try {
        await lock?.release()
      } finally {
        this.syncingAccountIds.delete(id)
      }
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async scheduledSync() {
    const accounts = await this.accountRepo.find({ where: { enabled: 1 } })
    for (const account of accounts) {
      if (
        !account.credentialEncrypted
        || account.adapterCode === 'manual'
        // CCTQ is exclusively owned by CctqAccountService.scheduledSync.
        || account.code === 'cctq-global'
      ) continue
      if (!this.adapterRegistry.get(account.adapterCode)?.capabilities.balanceSync) continue
      if (!this.isSyncDue(account)) continue
      try {
        await this.synchronize(account.id, 'scheduled')
      } catch (error: any) {
        this.logger.warn(`供应商账户 ${account.code} 定时同步失败：${error?.message || '未知错误'}`)
      }
    }
  }

  private async requireAccount(idValue: unknown) {
    const id = this.parseAccountId(idValue)
    const account = await this.accountRepo.findOne({ where: { id } })
    if (!account) throw new NotFoundException('供应商账户不存在')
    return account
  }

  private parseAccountId(idValue: unknown) {
    const id = Number(idValue)
    if (!Number.isInteger(id) || id < 1) throw new BadRequestException('供应商账户 ID 必须是正整数')
    return id
  }

  private isSyncDue(account: SupplierAccount) {
    const intervalMs = Math.max(5, Number(account.syncIntervalMinutes) || 10) * 60_000
    const lastAttempt = account.lastAttemptAt?.getTime() || 0
    return Date.now() - lastAttempt >= intervalMs
  }

  private async requireConfigurableAdapter(account: SupplierAccount) {
    if (account.adapterCode === 'cctq' || account.adapterCode === 'cctq-api-key') {
      throw new BadRequestException('CCTQ 请使用全局账户详情接口')
    }
    const adapter = this.adapterRegistry.get(account.adapterCode)
    if (!adapter?.capabilities.configuration || !adapter.capabilities.balanceSync) {
      throw new BadRequestException(`账户适配器不支持凭据配置：${account.adapterCode}`)
    }
    const supplier = await this.supplierRepo.findOne({ where: { id: account.supplierId } })
    if (!supplier) throw new BadRequestException('账户关联的供应商不存在')
    if (supplier.code !== adapter.supplierCode) {
      throw new BadRequestException('账户供应商与适配器不匹配')
    }
    return { supplier, adapter }
  }

  private async fetchForValidation(
    adapter: SupplierAccountAdapter,
    credential: string,
    previousModels: string[],
  ) {
    try {
      return this.fetchWithOptionalModels(adapter, credential, previousModels)
    } catch (error) {
      const failure = this.normalizeAdapterError(error)
      throw new BadRequestException(failure.message)
    }
  }

  private async fetchWithOptionalModels(
    adapter: SupplierAccountAdapter,
    credential: string,
    previousModels: string[],
  ): Promise<{
    remote: SupplierAccountSnapshot
    modelWarning: { code: string; message: string } | null
  }> {
    const remote = await adapter.fetchSnapshot(credential)
    if (!adapter.fetchModels) return { remote, modelWarning: null }
    try {
      remote.models = await adapter.fetchModels(credential)
      return { remote, modelWarning: null }
    } catch (error) {
      const failure = this.normalizeAdapterError(error)
      remote.models = previousModels
      return {
        remote,
        modelWarning: {
          code: `models_${failure.code}`,
          message: `模型目录同步失败：${failure.message}`,
        },
      }
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

  private async applySuccess(
    account: SupplierAccount,
    remote: SupplierAccountSnapshot,
    modelWarning: { code: string; message: string } | null = null,
  ) {
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
      billingPreference: remote.billingPreference,
      subscriptions: remote.subscriptions,
      groups: remote.groups,
      models: remote.models,
      lastAttemptAt: new Date(),
      lastSyncAt: new Date(),
      lastSyncStatus: 'healthy',
      lastErrorCode: modelWarning?.code || null,
      lastErrorMessage: modelWarning?.message || null,
    })
    const saved = await this.accountRepo.save(account)
    await this.snapshotRepo.save(this.snapshotRepo.create({
      supplierAccountId: saved.id,
      quotaAvailableRaw: remote.quotaAvailableRaw,
      quotaUsedRaw: remote.quotaUsedRaw,
      requestCount: remote.requestCount,
      last30dQuotaRaw: remote.last30dQuotaRaw,
    }))
    await this.snapshotRepo.delete({
      capturedAt: LessThan(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)),
    })
  }

  private async applyFailure(
    account: SupplierAccount,
    failure: { code: string; message: string; credentialInvalid: boolean },
  ) {
    account.lastAttemptAt = new Date()
    account.lastSyncStatus = failure.credentialInvalid ? 'credential_invalid' : 'stale'
    account.lastErrorCode = failure.code
    account.lastErrorMessage = failure.message
    await this.accountRepo.save(account)
  }

  private async loadHistory(accountId: number) {
    const history = await this.snapshotRepo.find({
      where: { supplierAccountId: accountId },
      order: { capturedAt: 'DESC' },
      take: 72,
    })
    return history.reverse()
  }

  private toPublicState(
    account: SupplierAccount,
    supplier: Supplier,
    adapter: SupplierAccountAdapter,
    history: SupplierAccountSnapshotEntity[],
  ) {
    const { credentialEncrypted, ...safe } = account
    return {
      ...safe,
      supplier: {
        id: Number(supplier.id),
        code: supplier.code,
        name: supplier.name,
        kind: supplier.kind,
      },
      configured: Boolean(credentialEncrypted),
      enabled: account.enabled === 1,
      routingEnabled: account.routingEnabled !== 0,
      baseUrl: adapter.baseUrl,
      adapter: {
        code: adapter.code,
        displayName: adapter.displayName,
        credentialLabel: adapter.credentialLabel,
      },
      history,
    }
  }

  private normalizeSyncInterval(value: unknown) {
    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed < 5 || parsed > 1440) {
      throw new BadRequestException('同步间隔必须在 5-1440 分钟之间')
    }
    return parsed
  }
}
