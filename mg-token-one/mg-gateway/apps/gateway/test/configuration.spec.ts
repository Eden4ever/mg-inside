import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildConfiguration,
  validateAppConfig,
} from '../src/config/configuration'

test('数据库自动同步默认关闭', () => {
  const config = buildConfiguration({})
  assert.equal(config.db.synchronize, false)
  assert.equal(config.environment, 'development')
  assert.equal(config.relay.autoCircuitBreakerEnabled, true)
  assert.equal(config.availabilityMonitoring.schedulerEnabled, true)
  assert.deepEqual(config.requestLogRetention, {
    schedulerEnabled: true,
    retentionMonths: 3,
    batchSize: 1000,
    maxBatchesPerRun: 10,
  })
})

test('可用性告警调度生产默认开启，测试可显式关闭', () => {
  assert.equal(buildConfiguration({ NODE_ENV: 'production' }).availabilityMonitoring.schedulerEnabled, true)
  assert.equal(buildConfiguration({ AVAILABILITY_MONITORING_SCHEDULER_ENABLED: 'false' }).availabilityMonitoring.schedulerEnabled, false)
})

test('可用性告警调度开关拒绝非法值', () => {
  assert.throws(
    () => buildConfiguration({ AVAILABILITY_MONITORING_SCHEDULER_ENABLED: 'enabled' }),
    /AVAILABILITY_MONITORING_SCHEDULER_ENABLED 必须是 true 或 false/,
  )
})

test('调用记录保留默认启用，且采用滚动 3 个日历月策略', () => {
  const config = buildConfiguration({ NODE_ENV: 'production' })
  assert.equal(config.requestLogRetention.schedulerEnabled, true)
  assert.equal(config.requestLogRetention.retentionMonths, 3)
  assert.equal(buildConfiguration({ REQUEST_LOG_RETENTION_SCHEDULER_ENABLED: 'false' }).requestLogRetention.schedulerEnabled, false)
})

test('调用记录保留配置拒绝非法布尔值和无界批量参数', () => {
  assert.throws(
    () => buildConfiguration({ REQUEST_LOG_RETENTION_SCHEDULER_ENABLED: 'yes' }),
    /REQUEST_LOG_RETENTION_SCHEDULER_ENABLED 必须是 true 或 false/,
  )
  for (const [name, value] of [
    ['REQUEST_LOG_RETENTION_MONTHS', '0'],
    ['REQUEST_LOG_RETENTION_MONTHS', '3.5'],
    ['REQUEST_LOG_RETENTION_BATCH_SIZE', '5001'],
    ['REQUEST_LOG_RETENTION_MAX_BATCHES_PER_RUN', '21'],
  ]) {
    assert.throws(
      () => buildConfiguration({ [name]: value }),
      new RegExp(`${name} 必须是`),
    )
  }
})

test('开发环境允许显式开启同步和本地默认密钥', () => {
  const config = buildConfiguration({
    NODE_ENV: 'development',
    DB_SYNCHRONIZE: 'true',
  })
  assert.doesNotThrow(() => validateAppConfig(config))
})

test('生产环境拒绝自动同步、空数据库密码和默认 JWT 密钥', () => {
  const config = buildConfiguration({
    NODE_ENV: 'production',
    DB_SYNCHRONIZE: 'true',
  })
  assert.throws(
    () => validateAppConfig(config),
    /生产环境禁止 DB_SYNCHRONIZE=true.*必须设置 DB_PASSWORD.*JWT_SECRET/,
  )
})

test('生产环境接受显式安全配置', () => {
  const config = buildConfiguration({
    NODE_ENV: 'production',
    DB_SYNCHRONIZE: 'false',
    DB_PASSWORD: 'database-password',
    JWT_SECRET: '0123456789abcdef0123456789abcdef',
    MG_RELEASE_ID: '20260819T120000Z',
    MG_RELEASE_SHA256: 'a'.repeat(64),
  })
  assert.equal(config.relay.autoCircuitBreakerEnabled, false)
  assert.equal(validateAppConfig(config), config)
})

test('生产环境禁止显式启用自动熔断', () => {
  const config = buildConfiguration({
    NODE_ENV: 'production',
    DB_SYNCHRONIZE: 'false',
    DB_PASSWORD: 'database-password',
    JWT_SECRET: '0123456789abcdef0123456789abcdef',
    AUTO_CIRCUIT_BREAKER_ENABLED: 'true',
    MG_RELEASE_ID: '20260819T120000Z',
    MG_RELEASE_SHA256: 'a'.repeat(64),
  })
  assert.throws(
    () => validateAppConfig(config),
    /生产环境禁止启用自动熔断/,
  )
})

test('生产环境强制启用调用记录清理并固定保留 3 个日历月', () => {
  const base = {
    NODE_ENV: 'production',
    DB_SYNCHRONIZE: 'false',
    DB_PASSWORD: 'database-password',
    JWT_SECRET: '0123456789abcdef0123456789abcdef',
    MG_RELEASE_ID: '20260819T120000Z',
    MG_RELEASE_SHA256: 'a'.repeat(64),
  }
  assert.throws(
    () => validateAppConfig(buildConfiguration({
      ...base,
      REQUEST_LOG_RETENTION_SCHEDULER_ENABLED: 'false',
    })),
    /生产环境必须启用调用记录保留清理/,
  )
  assert.throws(
    () => validateAppConfig(buildConfiguration({
      ...base,
      REQUEST_LOG_RETENTION_MONTHS: '4',
    })),
    /生产环境调用记录保留期必须为 3 个日历月/,
  )
})

test('生产环境名称忽略首尾空格和大小写，自动熔断仍默认关闭', () => {
  const config = buildConfiguration({
    NODE_ENV: ' Production ',
    DB_SYNCHRONIZE: 'false',
    DB_PASSWORD: 'database-password',
    JWT_SECRET: '0123456789abcdef0123456789abcdef',
    MG_RELEASE_ID: '20260819T120000Z',
    MG_RELEASE_SHA256: 'a'.repeat(64),
  })
  assert.equal(config.environment, 'production')
  assert.equal(config.relay.autoCircuitBreakerEnabled, false)
  assert.equal(validateAppConfig(config), config)
})

test('生产环境拒绝缺失或非法发布编号', () => {
  const base = {
    NODE_ENV: 'production',
    DB_SYNCHRONIZE: 'false',
    DB_PASSWORD: 'database-password',
    JWT_SECRET: '0123456789abcdef0123456789abcdef',
    MG_RELEASE_SHA256: 'a'.repeat(64),
  }
  assert.throws(
    () => validateAppConfig(buildConfiguration(base)),
    /MG_RELEASE_ID 必须是 UTC 发布编号/,
  )
  assert.throws(
    () => validateAppConfig(buildConfiguration({ ...base, MG_RELEASE_ID: 'latest' })),
    /MG_RELEASE_ID 必须是 UTC 发布编号/,
  )
})

test('生产环境拒绝缺失、大写或长度错误的发布摘要', () => {
  const base = {
    NODE_ENV: 'production',
    DB_SYNCHRONIZE: 'false',
    DB_PASSWORD: 'database-password',
    JWT_SECRET: '0123456789abcdef0123456789abcdef',
    MG_RELEASE_ID: '20260819T120000Z',
  }
  for (const value of [undefined, 'A'.repeat(64), 'a'.repeat(63)]) {
    assert.throws(
      () => validateAppConfig(buildConfiguration({
        ...base,
        ...(value === undefined ? {} : { MG_RELEASE_SHA256: value }),
      })),
      /MG_RELEASE_SHA256 必须是 64 位小写 SHA-256/,
    )
  }
})
