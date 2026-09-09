export interface AppConfig {
  environment: string
  releaseId: string
  releaseSha256: string
  port: number
  webDistDir: string
  db: {
    host: string
    port: number
    username: string
    password: string
    database: string
    synchronize: boolean
  }
  jwt: { secret: string; expiresIn: string }
  gatewayPublicUrl: string
  /** 禅道统一登录 */
  zentao: {
    enabled: boolean
    /** 禅道站点地址，如 http://106.52.90.82 或 http://localhost:18080 */
    baseUrl: string
    /** 禅道 role 映射为网关 admin 的角色码（逗号分隔） */
    adminRoles: string[]
    /** 登录请求超时 ms */
    timeoutMs: number
  }
  relay: {
    maxTries: number
    autoCircuitBreakerEnabled: boolean
    channelDisableSeconds: number
    outputRatio: number
    enableLocalUsageEstimate: boolean
    /** 额度预扣估算单价（元/token）。员工月度额度按人民币计。 */
    quotaRmbPerToken: number
  }
  availabilityMonitoring: {
    /** 是否启用每分钟的可用性告警评估。管理员手动评估始终可用。 */
    schedulerEnabled: boolean
  }
  requestLogRetention: {
    /** 是否启用调用记录保留清理。 */
    schedulerEnabled: boolean
    /** 当前 UTC 时刻回退的日历月数。 */
    retentionMonths: number
    /** 单个 DELETE 的最大行数。 */
    batchSize: number
    /** 单轮任务的最大 DELETE 批次数。 */
    maxBatchesPerRun: number
  }
}

export function buildConfiguration(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const environment = (env.NODE_ENV || 'development').trim().toLowerCase()
  const autoCircuitBreakerDefault = environment === 'production' ? 'false' : 'true'
  const availabilityMonitoringSchedulerEnabled = parseBooleanEnv(
    'AVAILABILITY_MONITORING_SCHEDULER_ENABLED',
    env.AVAILABILITY_MONITORING_SCHEDULER_ENABLED,
    true,
  )
  const requestLogRetentionSchedulerEnabled = parseBooleanEnv(
    'REQUEST_LOG_RETENTION_SCHEDULER_ENABLED',
    env.REQUEST_LOG_RETENTION_SCHEDULER_ENABLED,
    true,
  )
  return {
  environment,
  releaseId: (env.MG_RELEASE_ID || (environment === 'production' ? '' : 'development')).trim(),
  releaseSha256: (env.MG_RELEASE_SHA256 || (environment === 'production' ? '' : 'development')).trim(),
  port: parseInt(env.PORT || '3000', 10),
  webDistDir: env.WEB_DIST_DIR || '',
  db: {
    host: env.DB_HOST || '127.0.0.1',
    port: parseInt(env.DB_PORT || '3306', 10),
    username: env.DB_USERNAME || 'root',
    password: env.DB_PASSWORD || '',
    database: env.DB_DATABASE || 'mg_gateway',
    synchronize: (env.DB_SYNCHRONIZE || 'false') === 'true',
  },
  jwt: {
    secret: env.JWT_SECRET || 'change-me-in-prod-32bytes-min',
    expiresIn: env.JWT_EXPIRES_IN || '7d',
  },
  gatewayPublicUrl: env.GATEWAY_PUBLIC_URL || 'http://localhost:3000',
  zentao: {
    enabled: (env.ZENTAO_ENABLED || 'true') === 'true',
    baseUrl: (env.ZENTAO_BASE_URL || 'http://localhost:18080').replace(/\/+$/, ''),
    adminRoles: (env.ZENTAO_ADMIN_ROLES || 'admin')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    timeoutMs: parseInt(env.ZENTAO_TIMEOUT_MS || '8000', 10),
  },
  relay: {
    maxTries: parseInt(env.RELAY_MAX_TRIES || '3', 10),
    autoCircuitBreakerEnabled:
      (env.AUTO_CIRCUIT_BREAKER_ENABLED || autoCircuitBreakerDefault) === 'true',
    channelDisableSeconds: parseInt(env.CHANNEL_DISABLE_SECONDS || '300', 10),
    outputRatio: parseFloat(env.OUTPUT_RATIO || '3'),
    enableLocalUsageEstimate:
      (env.ENABLE_LOCAL_USAGE_ESTIMATE || 'true') === 'true',
    quotaRmbPerToken: parseFloat(env.QUOTA_RMB_PER_TOKEN || '0.000003'),
  },
  availabilityMonitoring: {
    schedulerEnabled: availabilityMonitoringSchedulerEnabled,
  },
  requestLogRetention: {
    schedulerEnabled: requestLogRetentionSchedulerEnabled,
    retentionMonths: parseBoundedPositiveInteger(
      'REQUEST_LOG_RETENTION_MONTHS',
      env.REQUEST_LOG_RETENTION_MONTHS,
      3,
      1,
      120,
    ),
    batchSize: parseBoundedPositiveInteger(
      'REQUEST_LOG_RETENTION_BATCH_SIZE',
      env.REQUEST_LOG_RETENTION_BATCH_SIZE,
      1000,
      1,
      5000,
    ),
    maxBatchesPerRun: parseBoundedPositiveInteger(
      'REQUEST_LOG_RETENTION_MAX_BATCHES_PER_RUN',
      env.REQUEST_LOG_RETENTION_MAX_BATCHES_PER_RUN,
      10,
      1,
      20,
    ),
  },
  }
}

function parseBooleanEnv(name: string, value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback
  const normalized = value.trim().toLowerCase()
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  throw new Error(`${name} 必须是 true 或 false`)
}

function parseBoundedPositiveInteger(
  name: string,
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || value.trim() === '') return fallback
  if (!/^\d+$/.test(value.trim())) {
    throw new Error(`${name} 必须是 ${minimum}-${maximum} 的整数`)
  }
  const parsed = Number(value.trim())
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} 必须是 ${minimum}-${maximum} 的整数`)
  }
  return parsed
}

export function validateAppConfig(config: AppConfig): AppConfig {
  const errors: string[] = []
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    errors.push('PORT 必须是 1-65535 的整数')
  }
  if (!Number.isInteger(config.db.port) || config.db.port < 1 || config.db.port > 65535) {
    errors.push('DB_PORT 必须是 1-65535 的整数')
  }
  if (!Number.isInteger(config.relay.maxTries) || config.relay.maxTries < 1) {
    errors.push('RELAY_MAX_TRIES 必须是正整数')
  }
  if (config.environment === 'production') {
    if (!/^\d{8}T\d{6}Z$/.test(config.releaseId)) {
      errors.push('生产环境 MG_RELEASE_ID 必须是 UTC 发布编号（YYYYMMDDTHHMMSSZ）')
    }
    if (!/^[a-f0-9]{64}$/.test(config.releaseSha256)) {
      errors.push('生产环境 MG_RELEASE_SHA256 必须是 64 位小写 SHA-256')
    }
    if (config.relay.autoCircuitBreakerEnabled) {
      errors.push('生产环境禁止启用自动熔断')
    }
    if (!config.requestLogRetention.schedulerEnabled) {
      errors.push('生产环境必须启用调用记录保留清理')
    }
    if (config.requestLogRetention.retentionMonths !== 3) {
      errors.push('生产环境调用记录保留期必须为 3 个日历月')
    }
    if (config.db.synchronize) errors.push('生产环境禁止 DB_SYNCHRONIZE=true')
    if (!config.db.password) errors.push('生产环境必须设置 DB_PASSWORD')
    if (
      config.jwt.secret === 'change-me-in-prod-32bytes-min' ||
      config.jwt.secret.length < 32
    ) {
      errors.push('生产环境 JWT_SECRET 必须是至少 32 字符的非默认密钥')
    }
  }
  if (errors.length) throw new Error(`配置校验失败：${errors.join('；')}`)
  return config
}

export default (): AppConfig => buildConfiguration()
