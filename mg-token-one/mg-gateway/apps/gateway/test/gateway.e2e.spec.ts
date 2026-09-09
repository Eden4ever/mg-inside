import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import mysql from 'mysql2/promise'
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter'
import { periodFor } from '../src/modules/relay/monthly-quota-policy'

async function waitForRows(
  dataSource: any,
  sql: string,
  params: unknown[],
  predicate: (rows: any[]) => boolean,
): Promise<any[]> {
  const deadline = Date.now() + 2_000
  let rows: any[] = []
  do {
    rows = await dataSource.query(sql, params)
    if (predicate(rows)) return rows
    await new Promise((resolve) => setTimeout(resolve, 20))
  } while (Date.now() < deadline)
  assert.fail(`等待路径健康持久化超时，当前记录数 ${rows.length}`)
}

test('真实网关主链隔离三协议、执行 Responses 故障转移并记录日志', async () => {
  const database = `mg_gateway_e2e_${process.pid}`
  assert.match(database, /^mg_gateway_e2e_\d+$/)
  const rootConnection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USERNAME || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
  })
  await rootConnection.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)

  const received: { path: string; body: any; headers: Record<string, string | string[] | undefined> }[] = []
  let retryAttempts = 0
  let clientErrorAttempts = 0
  const upstream = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    received.push({ path: req.url || '', body, headers: req.headers })
    res.setHeader('Content-Type', 'application/json')
    if (req.url === '/v1/chat/completions') {
      res.end(JSON.stringify({
        id: 'chatcmpl_e2e',
        object: 'chat.completion',
        choices: [{ index: 0, message: { role: 'assistant', content: 'chat-ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
      }))
      return
    }
    if (req.url === '/v1/responses') {
      if (body.input === 'trigger-client-error') {
        clientErrorAttempts++
        res.statusCode = 400
        res.end(JSON.stringify({
          error: { type: 'invalid_request_error', message: 'invalid input' },
        }))
        return
      }
      if (body.input === 'trigger-retry-success') {
        retryAttempts++
        if (retryAttempts === 1) {
          res.statusCode = 503
          res.end(JSON.stringify({
            error: { type: 'service_unavailable', message: 'retry this channel' },
          }))
          return
        }
      }
      if (body.input === 'trigger-upstream-failure') {
        res.statusCode = 429
        res.end(JSON.stringify({
          error: { type: 'rate_limit_error', message: 'upstream rate limited' },
        }))
        return
      }
      res.end(JSON.stringify({
        id: 'resp_e2e',
        object: 'response',
        status: 'completed',
        model: body.model,
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'responses-ok' }] }],
        usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 },
      }))
      return
    }
    if (req.url === '/v1/messages') {
      res.end(JSON.stringify({
        id: 'msg_e2e',
        type: 'message',
        role: 'assistant',
        model: body.model,
        content: [
          { type: 'text', text: 'anthropic-ok' },
          { type: 'future_block', value: 'keep' },
        ],
        stop_reason: 'end_turn',
        usage: { input_tokens: 9, output_tokens: 4, cache_read_input_tokens: 2 },
      }))
      return
    }
    res.statusCode = 404
    res.end(JSON.stringify({ error: { message: 'not found' } }))
  })
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  const upstreamAddress = upstream.address()
  assert.ok(upstreamAddress && typeof upstreamAddress === 'object')

  Object.assign(process.env, {
    NODE_ENV: 'test',
    DB_DATABASE: database,
    DB_SYNCHRONIZE: 'true',
    JWT_SECRET: 'e2e-secret-0123456789abcdef0123456789',
    ZENTAO_ENABLED: 'false',
    WEB_DIST_DIR: '',
    RELAY_MAX_TRIES: '2',
    // 禁用分钟任务，确保管理员手动评估的 E2E 断言不与 cron 竞争。
    AVAILABILITY_MONITORING_SCHEDULER_ENABLED: 'false',
  })

  let app: any
  try {
    const [{ NestFactory }, { AppModule }, { DataSource }, entities, cryptoModule, jwtModule, poolModule, routeStoreModule] = await Promise.all([
      import('@nestjs/core'),
      import('../src/app.module'),
      import('typeorm'),
      Promise.all([
        import('../src/entities/user.entity'),
        import('../src/entities/token.entity'),
        import('../src/entities/channel.entity'),
        import('../src/entities/model-config.entity'),
        import('../src/entities/group.entity'),
        import('../src/entities/request-log.entity'),
        import('../src/entities/model-owner.entity'),
        import('../src/entities/supplier.entity'),
        import('../src/entities/supplier-account.entity'),
        import('../src/entities/user-monthly-quota.entity'),
        import('../src/entities/user-quota-adjustment.entity'),
        import('../src/entities/model-route.entity'),
      ]),
      import('../src/common/utils/crypto.util'),
      import('../src/common/utils/jwt.util'),
      import('../src/modules/relay/channel-pool.service'),
      import('../src/modules/model-route/model-route.store'),
    ])
    app = await NestFactory.create(AppModule, { logger: false })
    app.useGlobalFilters(new HttpExceptionFilter())
    await app.listen(0, '127.0.0.1')
    const address = app.getHttpServer().address()
    assert.ok(address && typeof address === 'object')
    const baseUrl = `http://127.0.0.1:${address.port}`
    const readyResponse = await fetch(`${baseUrl}/api/health/ready`)
    assert.equal(readyResponse.status, 200)
    const readyState: any = await readyResponse.json()
    assert.equal(readyState.status, 'ready')
    assert.equal(readyState.releaseId, 'development')
    assert.equal(readyState.releaseSha256, 'development')
    assert.equal(readyState.checks.database, 'ok')
    assert.equal(readyState.policies.autoCircuitBreakerEnabled, true)
    const dataSource = app.get(DataSource)
    const [userEntity, tokenEntity, channelEntity, modelEntity, groupEntity, logEntity, ownerEntity, supplierEntity, supplierAccountEntity, monthlyQuotaEntity, quotaAdjustmentEntity, modelRouteEntity] = entities
    const userRepo = dataSource.getRepository(userEntity.User)
    const tokenRepo = dataSource.getRepository(tokenEntity.Token)
    const channelRepo = dataSource.getRepository(channelEntity.Channel)
    const modelRepo = dataSource.getRepository(modelEntity.ModelConfig)
    const groupRepo = dataSource.getRepository(groupEntity.Group)
    const logRepo = dataSource.getRepository(logEntity.RequestLog)
    const ownerRepo = dataSource.getRepository(ownerEntity.ModelOwner)
    const supplierRepo = dataSource.getRepository(supplierEntity.Supplier)
    const supplierAccountRepo = dataSource.getRepository(supplierAccountEntity.SupplierAccount)
    const monthlyQuotaRepo = dataSource.getRepository(monthlyQuotaEntity.UserMonthlyQuota)
    const quotaAdjustmentRepo = dataSource.getRepository(quotaAdjustmentEntity.UserQuotaAdjustment)
    const modelRouteRepo = dataSource.getRepository(modelRouteEntity.ModelRoute)
    const modelRoutes = app.get(routeStoreModule.ModelRouteStore)

    const user = await userRepo.save(userRepo.create({
      username: 'e2e-user',
      displayName: 'E2E User',
      role: 'admin',
      status: 1,
      quotaTotal: 0,
      quotaUsed: 0,
      syncSource: 'local',
      groupNames: ['default'],
    }))
    const regularUser = await userRepo.save(userRepo.create({
      username: 'e2e-regular-user',
      displayName: 'E2E Regular User',
      role: 'user',
      status: 1,
      quotaTotal: 0,
      quotaUsed: 0,
      fixedMonthlyQuota: 20,
      syncSource: 'local',
      groupNames: ['default'],
    }))
    const rawToken = 'sk-e2e-native-token'
    await tokenRepo.save(tokenRepo.create({
      keyHash: cryptoModule.CryptoUtil.sha256(rawToken.slice(3)),
      keyPrefix: rawToken.slice(0, 8),
      name: 'e2e',
      userId: user.id,
      quotaTotal: 0,
      quotaUsed: 0,
      status: 1,
    }))
    const owner = await ownerRepo.save(ownerRepo.create({
      code: 'openai',
      name: 'OpenAI',
      website: 'https://openai.com',
      status: 1,
    }))
    const supplier = await supplierRepo.save(supplierRepo.create({
      code: 'cctq',
      name: 'CCTQ',
      kind: 'third_party',
      website: 'https://www.cctq.ai',
      status: 1,
    }))
    const deepseekSupplier = await supplierRepo.save(supplierRepo.create({
      code: 'deepseek',
      name: 'DeepSeek 官方',
      kind: 'official',
      website: 'https://platform.deepseek.com',
      status: 1,
    }))
    const supplierAccount = await supplierAccountRepo.save(supplierAccountRepo.create({
      code: 'cctq-e2e',
      supplierId: supplier.id,
      adapterCode: 'e2e',
      name: 'CCTQ E2E',
      credentialEncrypted: null,
      enabled: 1,
      syncIntervalMinutes: 10,
      lastSyncStatus: 'unconfigured',
    }))
    const channel = await channelRepo.save(channelRepo.create({
      name: 'E2E Dual Protocol',
      supplierAccountId: supplierAccount.id,
      type: 'openai',
      protocol: 'chat',
      protocols: ['chat', 'responses', 'anthropic'],
      baseUrl: `http://127.0.0.1:${upstreamAddress.port}/v1`,
      keysEncrypted: cryptoModule.CryptoUtil.encrypt('fake-upstream-key', process.env.JWT_SECRET!),
      priority: 0,
      weight: 1,
      status: 1,
    }))
    const retryChannel = await channelRepo.save(channelRepo.create({
      name: 'E2E Retry First',
      type: 'openai',
      protocol: 'responses',
      protocols: ['responses'],
      baseUrl: `http://127.0.0.1:${upstreamAddress.port}/v1`,
      keysEncrypted: cryptoModule.CryptoUtil.encrypt('retry-fail-key', process.env.JWT_SECRET!),
      priority: 10,
      weight: 1,
      status: 1,
    }))
    const modelBindings = [
      { channelId: retryChannel.id, upstreamModel: 'upstream-e2e', priority: 10, weight: 2, status: 1 },
      { channelId: channel.id, upstreamModel: 'upstream-e2e', priority: 0, weight: 1, status: 1 },
    ]
    const savedModel = await modelRoutes.saveModel(modelRepo.create({
      name: 'e2e-model',
      modelOwnerId: owner.id,
      groupTag: 'default',
      bindings: null,
      inputPrice: 0,
      outputPrice: 0,
      status: 1,
      supportsResponses: 1,
      supportsAnthropic: 1,
      supportsTools: 1,
      supportsReasoning: 1,
    }), modelBindings)
    assert.deepEqual(savedModel.bindings, modelBindings)
    assert.equal(await modelRouteRepo.count({ where: { modelId: savedModel.id } }), 2)
    await modelRepo.update(savedModel.id, { bindings: [] })
    await app.get(poolModule.ChannelPoolService).refresh()
    assert.equal(
      app.get(poolModule.ChannelPoolService).describe('e2e-model').configuredBindingCount,
      2,
    )
    await modelRoutes.saveModel(
      (await modelRepo.findOneByOrFail({ id: savedModel.id })),
      modelBindings,
    )
    const defaultGroup = await groupRepo.findOne({ where: { name: 'default' } })
    assert.ok(defaultGroup)
    defaultGroup.models = ['e2e-model']
    defaultGroup.monthlyQuota = 100
    await groupRepo.save(defaultGroup)
    await monthlyQuotaRepo.save(monthlyQuotaRepo.create({
      userId: regularUser.id,
      period: periodFor(new Date()),
      quotaUsed: 82,
      temporaryMonthlyQuota: 30,
    }))
    await app.get(poolModule.ChannelPoolService).refresh()

    const headers = { Authorization: `Bearer ${rawToken}`, 'Content-Type': 'application/json' }
    const adminJwt = jwtModule.JwtUtil.sign(
      { sub: user.id, role: user.role, username: user.username },
      process.env.JWT_SECRET!,
      '1h',
    )
    const regularJwt = jwtModule.JwtUtil.sign(
      { sub: regularUser.id, role: regularUser.role, username: regularUser.username },
      process.env.JWT_SECRET!,
      '1h',
    )

    const unauthorizedUsers = await fetch(`${baseUrl}/api/admin/users?page=1&pageSize=10`, {
      headers: { Authorization: `Bearer ${regularJwt}` },
    })
    assert.equal(unauthorizedUsers.status, 403)
    const usersResponse = await fetch(`${baseUrl}/api/admin/users?page=1&pageSize=10`, {
      headers: { Authorization: `Bearer ${adminJwt}` },
    })
    assert.equal(usersResponse.status, 200)
    const usersState: any = await usersResponse.json()
    const listedAdmin = usersState.list.find((item: any) => item.id === user.id)
    const listedRegular = usersState.list.find((item: any) => item.id === regularUser.id)
    assert.equal(listedAdmin.isQuotaUnlimited, true)
    assert.equal(listedAdmin.effectiveMonthlyQuota, null)
    assert.equal(listedAdmin.monthlyQuotaRemaining, null)
    assert.equal(listedAdmin.passwordHash, undefined)
    assert.equal(listedRegular.isQuotaUnlimited, false)
    assert.equal(listedRegular.groupMonthlyQuota, 100)
    assert.equal(listedRegular.fixedMonthlyQuota, 20)
    assert.equal(listedRegular.temporaryMonthlyQuota, 30)
    assert.equal(listedRegular.effectiveMonthlyQuota, 150)
    assert.equal(listedRegular.monthlyQuotaUsed, 82)
    assert.equal(listedRegular.monthlyQuotaRemaining, 68)
    assert.equal(listedRegular.monthlyQuotaPeriod, periodFor(new Date()))
    assert.equal(listedRegular.passwordHash, undefined)

    const createQuotaUser = await fetch(`${baseUrl}/api/admin/users`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminJwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'e2e-created-quota-user',
        displayName: 'E2E Created Quota User',
        password: 'e2e-password',
        role: 'user',
        groupNames: ['default'],
        fixedMonthlyQuota: 12.5,
        temporaryMonthlyQuota: 7.5,
        quotaAdjustmentReason: 'E2E 新员工额度初始化',
      }),
    })
    assert.equal(createQuotaUser.status, 201)
    const createdQuotaUser: any = await createQuotaUser.json()
    const createdQuotaLedger = await monthlyQuotaRepo.findOne({
      where: { userId: createdQuotaUser.id, period: periodFor(new Date()) },
    })
    const createdQuotaAdjustment = await quotaAdjustmentRepo.findOne({
      where: { userId: createdQuotaUser.id },
    })
    assert.equal(Number(createdQuotaUser.fixedMonthlyQuota), 12.5)
    assert.equal(Number(createdQuotaLedger?.temporaryMonthlyQuota), 7.5)
    assert.equal(createdQuotaAdjustment?.period, createdQuotaLedger?.period)
    assert.equal(Number(createdQuotaAdjustment?.fixedQuotaAfter), 12.5)
    assert.equal(Number(createdQuotaAdjustment?.temporaryQuotaAfter), 7.5)
    assert.equal(createdQuotaAdjustment?.reason, 'E2E 新员工额度初始化')

    const invalidRole = await fetch(`${baseUrl}/api/admin/users/${regularUser.id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminJwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'owner' }),
    })
    assert.equal(invalidRole.status, 400)

    const invalidQuotaType = await fetch(`${baseUrl}/api/admin/users/${regularUser.id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminJwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        temporaryMonthlyQuota: true,
        quotaAdjustmentReason: 'E2E 非法额度类型',
      }),
    })
    assert.equal(invalidQuotaType.status, 400)

    const updateQuotaPackages = await fetch(`${baseUrl}/api/admin/users/${regularUser.id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminJwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fixedMonthlyQuota: 25,
        temporaryMonthlyQuota: 35,
        quotaAdjustmentReason: 'E2E 项目临时扩容',
      }),
    })
    assert.equal(updateQuotaPackages.status, 200)
    const monthlyQuotaAfterUpdate = await monthlyQuotaRepo.findOne({
      where: { userId: regularUser.id, period: periodFor(new Date()) },
    })
    assert.equal(Number(monthlyQuotaAfterUpdate?.quotaUsed), 82)
    assert.equal(Number(monthlyQuotaAfterUpdate?.temporaryMonthlyQuota), 35)
    const portalStatsResponse = await fetch(`${baseUrl}/api/portal/stats/my`, {
      headers: { Authorization: `Bearer ${regularJwt}` },
    })
    assert.equal(portalStatsResponse.status, 200)
    const portalStats: any = await portalStatsResponse.json()
    assert.equal(portalStats.monthly.groupQuota, 100)
    assert.equal(portalStats.monthly.fixedQuota, 25)
    assert.equal(portalStats.monthly.temporaryQuota, 35)
    assert.equal(portalStats.monthly.quota, 160)
    assert.equal(portalStats.monthly.used, 82)
    assert.equal(portalStats.monthly.remaining, 78)

    const quotaAdjustmentsResponse = await fetch(
      `${baseUrl}/api/admin/users/${regularUser.id}/quota-adjustments?page=1&pageSize=20`,
      { headers: { Authorization: `Bearer ${adminJwt}` } },
    )
    assert.equal(quotaAdjustmentsResponse.status, 200)
    const quotaAdjustments: any = await quotaAdjustmentsResponse.json()
    assert.equal(quotaAdjustments.total, 1)
    assert.equal(quotaAdjustments.list[0].username, regularUser.username)
    assert.equal(quotaAdjustments.list[0].operatorUserId, user.id)
    assert.equal(quotaAdjustments.list[0].operatorUsername, user.username)
    assert.equal(Number(quotaAdjustments.list[0].fixedQuotaBefore), 20)
    assert.equal(Number(quotaAdjustments.list[0].fixedQuotaAfter), 25)
    assert.equal(Number(quotaAdjustments.list[0].temporaryQuotaBefore), 30)
    assert.equal(Number(quotaAdjustments.list[0].temporaryQuotaAfter), 35)
    assert.equal(quotaAdjustments.list[0].reason, 'E2E 项目临时扩容')
    assert.equal(quotaAdjustments.list[0].period, periodFor(new Date()))

    const unchangedQuotaPackages = await fetch(`${baseUrl}/api/admin/users/${regularUser.id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminJwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fixedMonthlyQuota: 25, temporaryMonthlyQuota: 35 }),
    })
    assert.equal(unchangedQuotaPackages.status, 200)
    assert.equal(await quotaAdjustmentRepo.countBy({ userId: regularUser.id }), 1)

    const missingQuotaReason = await fetch(`${baseUrl}/api/admin/users/${regularUser.id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminJwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ temporaryMonthlyQuota: 40 }),
    })
    assert.equal(missingQuotaReason.status, 400)
    const quotaAfterRejectedUpdate = await monthlyQuotaRepo.findOne({
      where: { userId: regularUser.id, period: periodFor(new Date()) },
    })
    assert.equal(Number(quotaAfterRejectedUpdate?.temporaryMonthlyQuota), 35)
    assert.equal(await quotaAdjustmentRepo.countBy({ userId: regularUser.id }), 1)

    const unauthorizedQuotaAdjustments = await fetch(
      `${baseUrl}/api/admin/users/${regularUser.id}/quota-adjustments`,
      { headers: { Authorization: `Bearer ${regularJwt}` } },
    )
    assert.equal(unauthorizedQuotaAdjustments.status, 403)

    const invalidQuotaPackage = await fetch(`${baseUrl}/api/admin/users/${regularUser.id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminJwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ temporaryMonthlyQuota: -1 }),
    })
    assert.equal(invalidQuotaPackage.status, 400)

    const unauthenticatedAccount = await fetch(`${baseUrl}/api/admin/cctq-account`)
    assert.equal(unauthenticatedAccount.status, 401)
    const unauthorizedAccount = await fetch(`${baseUrl}/api/admin/cctq-account`, {
      headers: { Authorization: `Bearer ${regularJwt}` },
    })
    assert.equal(unauthorizedAccount.status, 403)
    const accountResponse = await fetch(`${baseUrl}/api/admin/cctq-account`, {
      headers: { Authorization: `Bearer ${adminJwt}` },
    })
    assert.equal(accountResponse.status, 200)
    const accountState: any = await accountResponse.json()
    assert.equal(accountState.configured, false)
    assert.equal(accountState.lastSyncStatus, 'unconfigured')
    assert.equal(accountState.baseUrl, 'https://www.cctq.ai')
    assert.equal(accountState.dashboardToken, undefined)
    assert.equal(accountState.dashboardTokenEncrypted, undefined)
    assert.equal(accountState.credentialEncrypted, undefined)

    const unauthenticatedDirectory = await fetch(`${baseUrl}/api/admin/supplier-accounts`)
    assert.equal(unauthenticatedDirectory.status, 401)
    const unauthorizedDirectory = await fetch(`${baseUrl}/api/admin/supplier-accounts`, {
      headers: { Authorization: `Bearer ${regularJwt}` },
    })
    assert.equal(unauthorizedDirectory.status, 403)
    const directoryResponse = await fetch(`${baseUrl}/api/admin/supplier-accounts`, {
      headers: { Authorization: `Bearer ${adminJwt}` },
    })
    assert.equal(directoryResponse.status, 200)
    const directoryState: any = await directoryResponse.json()
    assert.equal(directoryState.total, 1)
    assert.equal(directoryState.list[0].supplierCode, 'cctq')
    assert.equal(directoryState.list[0].status, 'unconfigured')
    assert.equal(directoryState.list[0].dashboardToken, undefined)
    assert.equal(directoryState.list[0].dashboardTokenEncrypted, undefined)
    assert.equal(directoryState.list[0].credentialEncrypted, undefined)

    const deepseekAdapterAccount = await supplierAccountRepo.save(supplierAccountRepo.create({
      code: 'deepseek-adapter-e2e',
      supplierId: deepseekSupplier.id,
      adapterCode: 'deepseek',
      name: 'DeepSeek Adapter E2E',
      credentialEncrypted: null,
      enabled: 0,
      routingEnabled: 1,
      syncIntervalMinutes: 10,
      lastSyncStatus: 'unconfigured',
    }))
    const unauthenticatedSupplierState = await fetch(
      `${baseUrl}/api/admin/supplier-accounts/${deepseekAdapterAccount.id}`,
    )
    assert.equal(unauthenticatedSupplierState.status, 401)
    const supplierStateResponse = await fetch(
      `${baseUrl}/api/admin/supplier-accounts/${deepseekAdapterAccount.id}`,
      { headers: { Authorization: `Bearer ${adminJwt}` } },
    )
    assert.equal(supplierStateResponse.status, 200)
    const supplierState: any = await supplierStateResponse.json()
    assert.equal(supplierState.supplier.code, 'deepseek')
    assert.equal(supplierState.baseUrl, 'https://api.deepseek.com')
    assert.equal(supplierState.configured, false)
    assert.equal(supplierState.credentialEncrypted, undefined)

    const enableUnconfiguredSupplier = await fetch(
      `${baseUrl}/api/admin/supplier-accounts/${deepseekAdapterAccount.id}/credential`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${adminJwt}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true, syncIntervalMinutes: 10 }),
      },
    )
    assert.equal(enableUnconfiguredSupplier.status, 400)
    const syncUnconfiguredSupplier = await fetch(
      `${baseUrl}/api/admin/supplier-accounts/${deepseekAdapterAccount.id}/sync`,
      { method: 'POST', headers: { Authorization: `Bearer ${adminJwt}` } },
    )
    assert.equal(syncUnconfiguredSupplier.status, 400)

    const createSupplierAccountResponse = await fetch(`${baseUrl}/api/admin/supplier-accounts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminJwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: 'deepseek-e2e',
        supplierId: deepseekSupplier.id,
        name: 'DeepSeek E2E',
        adapterCode: 'manual',
        routingEnabled: true,
      }),
    })
    assert.equal(createSupplierAccountResponse.status, 201)
    const createdSupplierAccount: any = await createSupplierAccountResponse.json()
    assert.equal(createdSupplierAccount.code, 'deepseek-e2e')
    assert.equal(createdSupplierAccount.routingEnabled, true)
    assert.equal(createdSupplierAccount.credentialEncrypted, undefined)

    const createManagedSupplierAccountResponse = await fetch(`${baseUrl}/api/admin/supplier-accounts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminJwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: 'deepseek-managed-e2e',
        supplierId: deepseekSupplier.id,
        name: 'DeepSeek Managed E2E',
        adapterCode: 'deepseek',
        routingEnabled: true,
      }),
    })
    assert.equal(createManagedSupplierAccountResponse.status, 201)
    const managedSupplierAccount: any = await createManagedSupplierAccountResponse.json()
    assert.equal(managedSupplierAccount.adapterCode, 'deepseek')
    assert.equal(managedSupplierAccount.configured, false)
    assert.equal(managedSupplierAccount.quotaPerUnit, 100)

    const mismatchedAdapterResponse = await fetch(`${baseUrl}/api/admin/supplier-accounts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminJwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: 'mismatched-adapter-e2e',
        supplierId: supplier.id,
        name: 'Mismatched Adapter',
        adapterCode: 'deepseek',
      }),
    })
    assert.equal(mismatchedAdapterResponse.status, 409)

    const duplicateSupplierAccountResponse = await fetch(`${baseUrl}/api/admin/supplier-accounts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminJwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: 'deepseek-e2e',
        supplierId: deepseekSupplier.id,
        name: 'Duplicate',
      }),
    })
    assert.equal(duplicateSupplierAccountResponse.status, 409)

    const secondCctqAccountResponse = await fetch(`${baseUrl}/api/admin/supplier-accounts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminJwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: 'cctq-second',
        supplierId: supplier.id,
        name: 'CCTQ Second',
      }),
    })
    assert.equal(secondCctqAccountResponse.status, 409)

    const disableSupplierAccountResponse = await fetch(
      `${baseUrl}/api/admin/supplier-accounts/${createdSupplierAccount.id}`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${adminJwt}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'DeepSeek E2E Updated', routingEnabled: false }),
      },
    )
    assert.equal(disableSupplierAccountResponse.status, 200)
    const disabledSupplierAccount: any = await disableSupplierAccountResponse.json()
    assert.equal(disabledSupplierAccount.name, 'DeepSeek E2E Updated')
    assert.equal(disabledSupplierAccount.routingEnabled, false)
    assert.equal(disabledSupplierAccount.status, 'disabled')

    const metadataResponse = await fetch(`${baseUrl}/api/admin/routing-metadata`, {
      headers: { Authorization: `Bearer ${adminJwt}` },
    })
    assert.equal(metadataResponse.status, 200)
    const metadataState: any = await metadataResponse.json()
    assert.equal(metadataState.modelOwners[0].name, 'OpenAI')
    assert.deepEqual(
      metadataState.supplierAccountAdapters.map((item: any) => item.code),
      ['cctq', 'cctq-api-key', 'deepseek'],
    )
    assert.equal(metadataState.supplierAccountAdapters[0].capabilities.balanceSync, true)
    assert.equal(metadataState.supplierAccounts[0].supplierName, 'CCTQ')
    assert.equal(metadataState.supplierAccounts[0].credentialEncrypted, undefined)

    const disabledUntil = Date.now() + 300_000
    await channelRepo.update(channel.id, { consecutiveErrors: 3, disabledUntil })
    await app.get(poolModule.ChannelPoolService).refresh()

    const channelListResponse = await fetch(`${baseUrl}/api/admin/channels?page=1&pageSize=10`, {
      headers: { Authorization: `Bearer ${adminJwt}` },
    })
    assert.equal(channelListResponse.status, 200)
    const channelList: any = await channelListResponse.json()
    const managedChannel = channelList.list.find((item: any) => item.name === 'E2E Dual Protocol')
    assert.equal(managedChannel.supplierAccountName, 'CCTQ / CCTQ E2E')
    // 该渠道还承载 chat/Anthropic；Responses 虽有 retryChannel，但没有覆盖全部
    // 模型协议的健康备用，因此必须保留最后路由，不能把真实上游错误变成无渠道。
    // channels 的旧健康字段只保留聚合展示，不能恢复为路径健康状态。
    assert.equal(managedChannel.health.status, 'healthy')
    assert.equal(managedChannel.health.consecutiveErrors, 0)
    assert.equal(managedChannel.health.disabledUntil, null)
    assert.equal(managedChannel.health.canRecover, false)
    const retainedInitialBinding = app
      .get(poolModule.ChannelPoolService)
      .describe('e2e-model')
      .bindings.find((binding: any) => binding.channelId === channel.id)
    assert.equal(retainedInitialBinding?.status, 'available')
    assert.equal(retainedInitialBinding?.disabledUntil, null)

    const recoverResponse = await fetch(`${baseUrl}/api/admin/channels/${channel.id}/recover`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminJwt}` },
    })
    assert.equal(recoverResponse.status, 200)
    const recoveredChannel: any = await recoverResponse.json()
    assert.equal(recoveredChannel.ok, true)
    assert.equal(recoveredChannel.health.status, 'healthy')
    assert.equal(recoveredChannel.health.consecutiveErrors, 0)
    const persistedRecovery = await channelRepo.findOne({ where: { id: channel.id } })
    assert.equal(persistedRecovery?.consecutiveErrors, 0)
    assert.equal(persistedRecovery?.disabledUntil, null)

    const runtimeConfig = app.get('APP_CONFIG')
    runtimeConfig.relay.autoCircuitBreakerEnabled = false
    try {
      await channelRepo.update(channel.id, {
        consecutiveErrors: 3,
        disabledUntil: Date.now() + 300_000,
      })
      await app.get(poolModule.ChannelPoolService).refresh()

      const persistedWithoutCircuit = await channelRepo.findOne({ where: { id: channel.id } })
      assert.equal(persistedWithoutCircuit?.consecutiveErrors, 3)
      assert.equal(persistedWithoutCircuit?.disabledUntil, null)
      const routingWithoutCircuit = app
        .get(poolModule.ChannelPoolService)
        .describe('e2e-model')
      const channelWithoutCircuit = routingWithoutCircuit.bindings.find(
        (binding: any) => binding.channelId === channel.id,
      )
      assert.equal(channelWithoutCircuit?.status, 'available')
      assert.equal(channelWithoutCircuit?.disabledUntil, null)

      const channelsWithoutCircuitResponse = await fetch(
        `${baseUrl}/api/admin/channels?page=1&pageSize=10`,
        { headers: { Authorization: `Bearer ${adminJwt}` } },
      )
      assert.equal(channelsWithoutCircuitResponse.status, 200)
      const channelsWithoutCircuit: any = await channelsWithoutCircuitResponse.json()
      const managedWithoutCircuit = channelsWithoutCircuit.list.find(
        (item: any) => item.id === channel.id,
      )
      assert.equal(managedWithoutCircuit.health.status, 'healthy')
      assert.equal(managedWithoutCircuit.health.disabledUntil, null)
    } finally {
      runtimeConfig.relay.autoCircuitBreakerEnabled = true
      await channelRepo.update(channel.id, { consecutiveErrors: 0, disabledUntil: null })
      await app.get(poolModule.ChannelPoolService).refresh()
    }

    const filteredChannelResponse = await fetch(
      `${baseUrl}/api/admin/channels?page=1&pageSize=10&supplierAccountId=${supplierAccount.id}`,
      { headers: { Authorization: `Bearer ${adminJwt}` } },
    )
    assert.equal(filteredChannelResponse.status, 200)
    const filteredChannels: any = await filteredChannelResponse.json()
    assert.equal(filteredChannels.total, 1)
    assert.equal(filteredChannels.list[0].supplierAccountId, supplierAccount.id)

    const missingAccountFilterResponse = await fetch(
      `${baseUrl}/api/admin/channels?page=1&pageSize=10&supplierAccountId=999999`,
      { headers: { Authorization: `Bearer ${adminJwt}` } },
    )
    assert.equal(missingAccountFilterResponse.status, 400)

    const modelListResponse = await fetch(`${baseUrl}/api/admin/models?page=1&pageSize=10`, {
      headers: { Authorization: `Bearer ${adminJwt}` },
    })
    assert.equal(modelListResponse.status, 200)
    const adminModelList: any = await modelListResponse.json()
    assert.equal(adminModelList.list[0].modelOwnerName, 'OpenAI')
    assert.equal(adminModelList.list[0].routing.strategy, 'failover')
    assert.equal(adminModelList.list[0].routing.configuredBindingCount, 2)
    assert.equal(adminModelList.list[0].routing.availableBindingCount, 2)
    assert.equal(adminModelList.list[0].routing.protocolAvailability.responses, 2)
    assert.equal(adminModelList.list[0].bindings[0].weight, 2)
    assert.equal(adminModelList.list[0].bindings[0].status, 1)
    assert.equal(adminModelList.list[0].routing.bindings[0].weight, 2)
    assert.equal(adminModelList.list[0].routing.bindings[0].keys, undefined)

    const chatResponse = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'e2e-model',
        messages: [{ role: 'developer', content: 'Use the policy.' }],
        stream: false,
      }),
    })
    assert.equal(chatResponse.status, 200)
    const chatJson: any = await chatResponse.json()
    assert.equal(chatJson.choices[0].message.content, 'chat-ok')

    const responsesRequest = {
      model: 'e2e-model',
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'hello' }] }],
      instructions: 'Be precise.',
      previous_response_id: 'resp_previous',
      tools: [{ type: 'function', name: 'lookup', parameters: { type: 'object' } }],
      reasoning: { effort: 'high' },
      store: false,
      stream: false,
    }
    const responsesResponse = await fetch(`${baseUrl}/v1/responses`, {
      method: 'POST',
      headers: {
        ...headers,
        'user-agent': 'codex_cli/e2e',
        'openai-beta': 'responses=experimental',
        'x-stainless-runtime': 'node',
      },
      body: JSON.stringify(responsesRequest),
    })
    assert.equal(responsesResponse.status, 200)
    const responsesJson: any = await responsesResponse.json()
    assert.equal(responsesJson.id, 'resp_e2e')

    const failedResponse = await fetch(`${baseUrl}/v1/responses`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'e2e-model',
        input: 'trigger-upstream-failure',
        stream: false,
      }),
    })
    assert.equal(failedResponse.status, 429)
    const failedJson: any = await failedResponse.json()
    assert.equal(failedJson.error.message, 'upstream rate limited')

    const retriedResponse = await fetch(`${baseUrl}/v1/responses`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'e2e-model',
        input: 'trigger-retry-success',
        stream: false,
      }),
    })
    assert.equal(retriedResponse.status, 200)
    const retriedJson: any = await retriedResponse.json()
    assert.equal(retriedJson.id, 'resp_e2e')

    const messagesRequest = {
      model: 'e2e-model',
      max_tokens: 128,
      system: [{ type: 'text', text: 'Be precise.' }],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      tools: [{ name: 'lookup', description: 'Look up data', input_schema: { type: 'object' } }],
      thinking: { type: 'enabled', budget_tokens: 64 },
      stream: false,
    }
    const messagesResponse = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': rawToken,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'interleaved-thinking-2025-05-14',
        'user-agent': 'claude-code/e2e',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messagesRequest),
    })
    assert.equal(messagesResponse.status, 200)
    const messagesJson: any = await messagesResponse.json()
    assert.equal(messagesJson.content[0].text, 'anthropic-ok')

    const clientErrorResponse = await fetch(`${baseUrl}/v1/responses`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'e2e-model',
        input: 'trigger-client-error',
        stream: false,
      }),
    })
    assert.equal(clientErrorResponse.status, 400)
    const clientErrorJson: any = await clientErrorResponse.json()
    assert.equal(clientErrorJson.error.message, 'invalid input')
    assert.equal(clientErrorAttempts, 1)

    const unauthenticatedMessages = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messagesRequest),
    })
    assert.equal(unauthenticatedMessages.status, 401)
    const unauthenticatedJson: any = await unauthenticatedMessages.json()
    assert.equal(unauthenticatedJson.type, 'error')
    assert.equal(unauthenticatedJson.error.type, 'authentication_error')

    const modelIdentity = `id:${savedModel.id}`
    const routeHealthRows = await waitForRows(
      dataSource,
      `SELECT channelId, modelIdentity, modelName, protocol,
              consecutiveErrors, disabledUntil, totalRequests, failedRequests,
              lastSuccessAt, lastFailureAt, lastOutcomeAt
       FROM channel_route_health
       WHERE modelIdentity = ?
       ORDER BY channelId, protocol`,
      [modelIdentity],
      (rows) => rows.length === 4 && rows.every((row) => row.lastOutcomeAt),
    )
    const healthByPath = new Map(
      routeHealthRows.map((row) => [`${row.channelId}:${row.protocol}`, row]),
    )
    const retryResponsesHealth = healthByPath.get(`${retryChannel.id}:responses`)
    const fallbackResponsesHealth = healthByPath.get(`${channel.id}:responses`)
    const fallbackChatHealth = healthByPath.get(`${channel.id}:chat`)
    const fallbackAnthropicHealth = healthByPath.get(`${channel.id}:anthropic`)

    assert.ok(retryResponsesHealth)
    assert.ok(fallbackResponsesHealth)
    assert.ok(fallbackChatHealth)
    assert.ok(fallbackAnthropicHealth)
    assert.ok(routeHealthRows.every((row) => row.modelName === 'e2e-model'))
    assert.equal(Number(retryResponsesHealth.consecutiveErrors), 2)
    assert.equal(Number(retryResponsesHealth.failedRequests), 2)
    assert.ok(retryResponsesHealth.lastSuccessAt instanceof Date)
    assert.ok(retryResponsesHealth.lastFailureAt instanceof Date)
    assert.ok(retryResponsesHealth.lastFailureAt > retryResponsesHealth.lastSuccessAt)
    assert.equal(retryResponsesHealth.disabledUntil, null)

    assert.equal(Number(fallbackResponsesHealth.consecutiveErrors), 0)
    assert.equal(Number(fallbackResponsesHealth.failedRequests), 1)
    assert.ok(fallbackResponsesHealth.lastSuccessAt instanceof Date)
    assert.ok(fallbackResponsesHealth.lastFailureAt instanceof Date)
    assert.ok(fallbackResponsesHealth.lastSuccessAt >= fallbackResponsesHealth.lastFailureAt)
    assert.equal(fallbackResponsesHealth.disabledUntil, null)

    // 同渠道 Chat/Anthropic 的成功拥有独立路径，不能覆盖 Responses 的失败时间轴。
    assert.equal(Number(fallbackChatHealth.consecutiveErrors), 0)
    assert.equal(Number(fallbackChatHealth.failedRequests), 0)
    assert.ok(fallbackChatHealth.lastSuccessAt instanceof Date)
    assert.equal(fallbackChatHealth.lastFailureAt, null)
    assert.equal(Number(fallbackAnthropicHealth.consecutiveErrors), 0)
    assert.equal(Number(fallbackAnthropicHealth.failedRequests), 0)
    assert.ok(fallbackAnthropicHealth.lastSuccessAt instanceof Date)
    assert.equal(fallbackAnthropicHealth.lastFailureAt, null)

    assert.equal(received[0].path, '/v1/chat/completions')
    assert.equal(received[0].body.messages[0].role, 'system')
    assert.equal(received[1].path, '/v1/responses')
    assert.deepEqual(received[1].body, { ...responsesRequest, model: 'upstream-e2e' })
    assert.equal(received[1].headers.authorization, 'Bearer retry-fail-key')
    assert.equal(received[1].headers['user-agent'], 'codex_cli/e2e')
    assert.equal(received[1].headers['openai-beta'], 'responses=experimental')
    assert.equal(received[1].headers['x-stainless-runtime'], 'node')
    assert.equal(received[4].path, '/v1/responses')
    assert.equal(received[5].path, '/v1/responses')
    assert.notEqual(received[4].headers.authorization, received[5].headers.authorization)
    assert.equal(received[6].path, '/v1/messages')
    assert.deepEqual(received[6].body, { ...messagesRequest, model: 'upstream-e2e' })
    assert.equal(received[6].headers['x-api-key'], 'fake-upstream-key')
    assert.equal(received[6].headers['anthropic-version'], '2023-06-01')
    assert.equal(received[6].headers['anthropic-beta'], 'interleaved-thinking-2025-05-14')
    assert.equal(received[6].headers.authorization, undefined)

    const modelsResponse = await fetch(`${baseUrl}/v1/models`, { headers })
    assert.equal(modelsResponse.status, 200)
    const modelList: any = await modelsResponse.json()
    assert.equal(modelList.data[0].supports_responses, true)
    assert.equal(modelList.data[0].supports_anthropic, true)

    const anthropicModelsResponse = await fetch(`${baseUrl}/v1/models?limit=1`, {
      headers: {
        'x-api-key': rawToken,
        'anthropic-version': '2023-06-01',
      },
    })
    assert.equal(anthropicModelsResponse.status, 200)
    const anthropicModels: any = await anthropicModelsResponse.json()
    assert.equal(anthropicModels.data[0].type, 'model')
    assert.equal(anthropicModels.data[0].id, 'e2e-model')
    assert.equal(anthropicModels.first_id, 'e2e-model')
    assert.equal(anthropicModels.last_id, 'e2e-model')

    // 重新构造 route-aware 熔断场景：没有覆盖全部协议的健康备用时，刷新会清除
    // 历史临时禁用并保留最后路由；已有连续失败的渠道不能支撑熔断另一条路由。
    const pool = app.get(poolModule.ChannelPoolService)
    await channelRepo.update(channel.id, {
      consecutiveErrors: 3,
      disabledUntil: Date.now() + 300_000,
    })
    await pool.refresh()
    const retainedHealth = pool.health(channel.id)
    // 手工写旧渠道字段不能构造路径故障。
    assert.equal(retainedHealth?.status, 'healthy')
    assert.equal(retainedHealth?.consecutiveErrors, 0)
    assert.equal(retainedHealth?.disabledUntil, null)
    const retainedBinding = pool
      .describe('e2e-model')
      .bindings.find((binding: any) => binding.channelId === channel.id)
    assert.equal(retainedBinding?.status, 'available')
    assert.equal(retainedBinding?.disabledUntil, null)

    await channelRepo.update(retryChannel.id, {
      consecutiveErrors: 3,
      disabledUntil: Date.now() + 300_000,
    })
    await pool.refresh()
    const fallbackHealth = pool.health(retryChannel.id)
    assert.equal(fallbackHealth?.status, 'degraded')
    assert.ok((fallbackHealth?.consecutiveErrors || 0) >= 1)
    assert.equal(fallbackHealth?.disabledUntil, null)
    const fallbackBinding = pool
      .describe('e2e-model')
      .bindings.find((binding: any) => binding.channelId === retryChannel.id)
    assert.equal(fallbackBinding?.status, 'available')
    assert.equal(fallbackBinding?.disabledUntil, null)

    // 两条渠道都已劣化时仍保留路由，并透传上游返回的 429，
    // 而不是返回网关层的“无可用渠道”。
    const retainedRouteErrorResponse = await fetch(`${baseUrl}/v1/responses`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'e2e-model',
        input: 'trigger-upstream-failure',
        stream: false,
      }),
    })
    assert.equal(retainedRouteErrorResponse.status, 429)
    const retainedRouteErrorJson: any = await retainedRouteErrorResponse.json()
    assert.equal(retainedRouteErrorJson.error.message, 'upstream rate limited')
    const retainedRouteRequests = received.filter((item) =>
      item.path === '/v1/responses' && item.body.input === 'trigger-upstream-failure',
    )
    assert.ok(retainedRouteRequests.length >= 2)
    const retainedRouteAttempts = retainedRouteRequests
      .slice(-2)
      .map((item) => item.headers.authorization)
    assert.deepEqual(
      new Set(retainedRouteAttempts),
      new Set(['Bearer retry-fail-key', 'Bearer fake-upstream-key']),
    )
    assert.equal(retainedRouteAttempts.at(-1), 'Bearer fake-upstream-key')

    const failedPathRows = await dataSource.query(
      `SELECT channelId, consecutiveErrors, disabledUntil, lastSuccessAt, lastFailureAt
       FROM channel_route_health
       WHERE modelIdentity = ? AND protocol = 'responses'
         AND channelId IN (?, ?)
       ORDER BY channelId`,
      [modelIdentity, channel.id, retryChannel.id],
    )
    const failedHealthByChannel = new Map<number, any>(
      failedPathRows.map((row: any) => [Number(row.channelId), row]),
    )
    const circuitPrimary = failedHealthByChannel.get(retryChannel.id)
    const retainedLastRoute = failedHealthByChannel.get(channel.id)
    assert.ok(circuitPrimary)
    assert.ok(retainedLastRoute)
    assert.equal(Number(circuitPrimary.consecutiveErrors), 3)
    assert.ok(Number(circuitPrimary.disabledUntil) > Date.now())
    assert.equal(Number(retainedLastRoute.consecutiveErrors), 1)
    assert.equal(retainedLastRoute.disabledUntil, null)
    assert.ok(retainedLastRoute.lastFailureAt instanceof Date)
    const routingAfterFailures = pool.describe('e2e-model')
    assert.equal(
      routingAfterFailures.bindings.find((binding: any) => binding.channelId === retryChannel.id)?.status,
      'temporarily_disabled',
    )
    assert.equal(
      routingAfterFailures.bindings.find((binding: any) => binding.channelId === channel.id)?.status,
      'available',
    )
    assert.equal(pool.pick('e2e-model', 'responses')?.channelId, channel.id)

    await pool.recover(retryChannel.id)
    await pool.recover(channel.id)
    await pool.refresh()
    assert.equal(pool.health(retryChannel.id)?.status, 'healthy')
    assert.equal(pool.health(channel.id)?.status, 'healthy')
    const recoveredPathRows = await dataSource.query(
      `SELECT channelId, consecutiveErrors, disabledUntil
       FROM channel_route_health
       WHERE modelIdentity = ? AND protocol = 'responses'
         AND channelId IN (?, ?)`,
      [modelIdentity, channel.id, retryChannel.id],
    )
    assert.equal(recoveredPathRows.length, 2)
    assert.ok(recoveredPathRows.every((row: any) =>
      Number(row.consecutiveErrors) === 0 && row.disabledUntil === null,
    ))

    await new Promise((resolve) => setTimeout(resolve, 100))
    const logs = await logRepo.find({ order: { id: 'ASC' } })
    assert.equal(logs.length, 7)
    assert.deepEqual(
      logs.map((log) => log.protocol),
      ['chat', 'responses', 'responses', 'responses', 'anthropic', 'responses', 'responses'],
    )
    assert.deepEqual(logs.map((log) => log.status), [1, 1, 0, 1, 1, 0, 0])
    assert.deepEqual(logs.map((log) => log.totalTokens), [6, 8, 0, 8, 13, 0, 0])
    assert.deepEqual(logs.map((log) => log.errorCode), [
      null, null, 'upstream_error', null, null, 'upstream_error', 'upstream_error',
    ])
    const clientErrorLog = logs.find((log) => /invalid input/.test(log.errorMessage || ''))
    assert.equal(clientErrorLog?.errorCode, 'upstream_error')
    assert.equal(clientErrorLog?.responseStatus, 400)
    const rateLimitedLogs = logs.filter((log) => /upstream rate limited/.test(log.errorMessage || ''))
    assert.equal(rateLimitedLogs.length, 2)
    assert.ok(rateLimitedLogs.every((log) =>
      log.errorCode === 'upstream_error' && log.responseStatus === 429,
    ))

    const availabilityResponse = await fetch(`${baseUrl}/api/admin/stats/availability?window=5`, {
      headers: { Authorization: `Bearer ${adminJwt}` },
    })
    assert.equal(availabilityResponse.status, 200)
    const availability: any = await availabilityResponse.json()
    assert.equal(availability.windowMinutes, 5)
    assert.ok(availability.groups.some((row: any) =>
      row.protocol === 'responses'
      && row.errorCode === 'upstream_error'
      && row.responseStatus === 429,
    ))
    assert.equal(availability.summary.excludedClientDisconnected, 0)

    await logRepo.save(logRepo.create([
      1, 2, 3,
    ].map((sequence) => ({
      requestId: `availability-no-channel-${sequence}`,
      userId: user.id,
      tokenId: null,
      department: null,
      model: 'gpt-5.6-terra',
      protocol: 'responses',
      upstreamModel: null,
      channelId: null,
      status: 0,
      errorCode: 'no_responses_channel',
      responseStatus: 503,
      errorMessage: 'no native responses channel',
      createdAt: new Date(),
    } as any))))
    const alertEvaluateResponse = await fetch(`${baseUrl}/api/admin/availability-alerts/evaluate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminJwt}`, 'Content-Type': 'application/json' },
      body: '{}',
    })
    assert.equal(alertEvaluateResponse.status, 200)
    const alertEvaluation: any = await alertEvaluateResponse.json()
    assert.equal(alertEvaluation.triggered, 1)
    const alertStatesResponse = await fetch(`${baseUrl}/api/admin/availability-alerts/states?active=true`, {
      headers: { Authorization: `Bearer ${adminJwt}` },
    })
    assert.equal(alertStatesResponse.status, 200)
    const alertStates: any = await alertStatesResponse.json()
    assert.equal(alertStates.total, 1)
    assert.equal(alertStates.list[0].errorClass, 'no_responses_channel')
    const alertEventsResponse = await fetch(`${baseUrl}/api/admin/availability-alerts/events`, {
      headers: { Authorization: `Bearer ${adminJwt}` },
    })
    assert.equal(alertEventsResponse.status, 200)
    const alertEvents: any = await alertEventsResponse.json()
    assert.equal(alertEvents.total, 1)
    assert.equal(alertEvents.list[0].eventType, 'triggered')
    const nonAdminAlertResponse = await fetch(`${baseUrl}/api/admin/availability-alerts/states`, {
      headers: { Authorization: `Bearer ${regularJwt}` },
    })
    assert.equal(nonAdminAlertResponse.status, 403)
    const invalidAlertQueryResponse = await fetch(`${baseUrl}/api/admin/availability-alerts/states?active=maybe`, {
      headers: { Authorization: `Bearer ${adminJwt}` },
    })
    assert.equal(invalidAlertQueryResponse.status, 400)
    const invalidAlertEvaluateResponse = await fetch(`${baseUrl}/api/admin/availability-alerts/evaluate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminJwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ unexpected: true }),
    })
    assert.equal(invalidAlertEvaluateResponse.status, 400)
  } finally {
    if (app) await app.close()
    await new Promise<void>((resolve) => upstream.close(() => resolve()))
    await rootConnection.query(`DROP DATABASE IF EXISTS \`${database}\``)
    await rootConnection.end()
  }
})
