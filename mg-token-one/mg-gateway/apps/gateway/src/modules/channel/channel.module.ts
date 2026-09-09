import {
  Module,
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Inject,
  BadRequestException,
  ConflictException,
  HttpCode,
  NotFoundException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { IsInt, IsOptional, Min } from 'class-validator'
import { Type } from 'class-transformer'
import { Channel } from '@/entities/channel.entity'
import { ModelConfig } from '@/entities/model-config.entity'
import { TypeOrmModule } from '@nestjs/typeorm'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { Roles } from '@/modules/auth/guards/roles.guard'
import { CryptoUtil } from '@/common/utils/crypto.util'
import { AppConfig } from '@/config/configuration'
import { PaginationDto, PageResult } from '@/common/dto/pagination.dto'
import { RelayModule } from '@/modules/relay/relay.module'
import { ChannelPoolService } from '@/modules/relay/channel-pool.service'
import { AuthModule } from '@/modules/auth/auth.module'
import { RoutingMetadataModule } from '@/modules/routing-metadata/routing-metadata.module'
import { RoutingMetadataService } from '@/modules/routing-metadata/routing-metadata.service'
import { ModelRouteModule } from '@/modules/model-route/model-route.module'
import { ModelRouteStore } from '@/modules/model-route/model-route.store'
import axios from 'axios'
import { buildUpstreamUrl, ChannelProtocol, RelayProtocol } from '@/common/utils/upstream-protocol.util'
import {
  normalizeChannelBaseUrl,
  normalizeChannelHeaders,
  normalizeChannelPriority,
  normalizeChannelProxy,
  normalizeChannelStatus,
  normalizeChannelType,
  normalizeChannelWeight,
  normalizeProtocols,
  parseChannelHeaders,
  parseChannelProxy,
} from './channel-policy'

class ChannelDto {
  name: string
  supplierAccountId?: number | null
  type?: string
  protocol?: ChannelProtocol
  protocols?: ChannelProtocol[]
  baseUrl: string
  keysText: string
  proxy?: string
  headersJson?: string
  priority?: number
  weight?: number
  status?: number
  remark?: string
}

class ChannelListQuery extends PaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  supplierAccountId?: number
}

@Controller('api/admin/channels')
@UseGuards(JwtAuthGuard, Roles('admin'))
export class ChannelController {
  constructor(
    @InjectRepository(Channel) private readonly repo: Repository<Channel>,
    @InjectRepository(ModelConfig)
    private readonly modelRepo: Repository<ModelConfig>,
    @Inject('APP_CONFIG') private readonly config: AppConfig,
    private readonly pool: ChannelPoolService,
    private readonly metadata: RoutingMetadataService,
    private readonly modelRoutes: ModelRouteStore,
  ) {}

  @Get()
  async list(@Query() q: ChannelListQuery): Promise<PageResult<any>> {
    const page = q.page || 1
    const pageSize = q.pageSize || 10
    const supplierAccountId = await this.metadata.requireSupplierAccount(q.supplierAccountId)
    const [rows, total] = await this.repo.findAndCount({
      where: supplierAccountId === null ? undefined : { supplierAccountId },
      skip: (page - 1) * pageSize,
      take: pageSize,
      order: { priority: 'DESC', id: 'ASC' },
    })
    const catalog = await this.metadata.catalog()
    const accountNames = new Map(catalog.supplierAccounts.map((account) => [Number(account.id), `${account.supplierName} / ${account.name}`]))
    const list = rows.map((c) => {
      const { keysEncrypted, ...rest } = c
      let keyCount: number | null = null
      let keyStatus: 'ready' | 'unreadable' = 'unreadable'
      try {
        keyCount = CryptoUtil.splitKeys(
          CryptoUtil.decrypt(keysEncrypted, this.config.jwt.secret),
        ).length
        keyStatus = 'ready'
      } catch {
        // 历史数据可能由另一套密钥加密；列表仍应可用，以便管理员重新配置。
      }
      return {
        ...rest,
        keyCount,
        keyStatus,
        health: this.pool.health(c.id),
        supplierAccountName: c.supplierAccountId
          ? accountNames.get(Number(c.supplierAccountId)) || null
          : null,
      }
    })
    return { list, total, page, pageSize }
  }

  @Post()
  async create(@Body() dto: ChannelDto) {
    if (!dto.name || !dto.baseUrl || !dto.keysText) {
      throw new BadRequestException('name/baseUrl/keysText 必填')
    }
    const keysEncrypted = CryptoUtil.encrypt(dto.keysText, this.config.jwt.secret)
    const type = this.applyPolicy(() => normalizeChannelType(dto.type))
    const protocols = this.applyPolicy(() => normalizeProtocols(
      dto,
      type === 'anthropic' ? 'anthropic' : 'chat',
    ))
    const ch = this.repo.create({
      name: dto.name.trim(),
      supplierAccountId: await this.metadata.requireSupplierAccount(dto.supplierAccountId),
      type,
      protocol: protocols[0],
      protocols,
      baseUrl: this.applyPolicy(() => normalizeChannelBaseUrl(dto.baseUrl)),
      keysEncrypted,
      proxy: this.applyPolicy(() => normalizeChannelProxy(dto.proxy)),
      headersJson: this.applyPolicy(() => normalizeChannelHeaders(dto.headersJson)),
      priority: this.applyPolicy(() => normalizeChannelPriority(dto.priority, 0)),
      weight: this.applyPolicy(() => normalizeChannelWeight(dto.weight, 1)),
      status: this.applyPolicy(() => normalizeChannelStatus(dto.status, 1)),
      remark: dto.remark || null,
    } as any)
    const saved = await this.repo.save(ch)
    await this.pool.refresh()
    return saved
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: ChannelDto) {
    const ch = await this.repo.findOne({ where: { id: parseInt(id, 10) } })
    if (!ch) throw new NotFoundException('渠道不存在')
    if (dto.name) ch.name = dto.name.trim()
    if (dto.supplierAccountId !== undefined) {
      ch.supplierAccountId = await this.metadata.requireSupplierAccount(dto.supplierAccountId)
    }
    if (dto.type !== undefined) ch.type = this.applyPolicy(() => normalizeChannelType(dto.type))
    if (dto.protocol !== undefined || dto.protocols !== undefined) {
      const protocols = this.applyPolicy(() => normalizeProtocols(dto, ch.protocol || 'chat'))
      ch.protocol = protocols[0]
      ch.protocols = protocols
    }
    if (dto.baseUrl) ch.baseUrl = this.applyPolicy(() => normalizeChannelBaseUrl(dto.baseUrl))
    if (dto.keysText) ch.keysEncrypted = CryptoUtil.encrypt(dto.keysText, this.config.jwt.secret)
    if (dto.proxy !== undefined) {
      ch.proxy = this.applyPolicy(() => normalizeChannelProxy(dto.proxy))
    }
    if (dto.headersJson !== undefined) {
      ch.headersJson = this.applyPolicy(() => normalizeChannelHeaders(dto.headersJson))
    }
    if (dto.priority !== undefined) {
      ch.priority = this.applyPolicy(() => normalizeChannelPriority(dto.priority, ch.priority))
    }
    if (dto.weight !== undefined) {
      ch.weight = this.applyPolicy(() => normalizeChannelWeight(dto.weight, ch.weight))
    }
    if (dto.status !== undefined) {
      ch.status = this.applyPolicy(() => normalizeChannelStatus(dto.status, ch.status))
    }
    if (dto.remark !== undefined) ch.remark = dto.remark || null
    const saved = await this.repo.save(ch)
    await this.pool.refresh()
    return saved
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    const channelId = parseInt(id, 10)
    const referencedBy = await this.modelRoutes.modelNamesReferencingChannel(channelId)
    if (referencedBy.length) {
      throw new ConflictException(`渠道仍被模型引用：${referencedBy.join('、')}`)
    }
    await this.repo.delete(channelId)
    await this.pool.refresh()
    return { ok: true }
  }

  @Post(':id/recover')
  @HttpCode(200)
  async recover(@Param('id') id: string) {
    const channelId = parseInt(id, 10)
    const ch = await this.repo.findOne({ where: { id: channelId } })
    if (!ch) throw new NotFoundException('渠道不存在')
    return { ok: true, health: await this.pool.recover(channelId) }
  }

  @Post(':id/test')
  async test(@Param('id') id: string) {
    const ch = await this.repo.findOne({ where: { id: parseInt(id, 10) } })
    if (!ch) throw new NotFoundException('渠道不存在')
    const keys = CryptoUtil.splitKeys(
      CryptoUtil.decrypt(ch.keysEncrypted, this.config.jwt.secret),
    )
    if (!keys.length) return { ok: false, error: '渠道没有可用密钥', results: [] }

    const binding = await this.modelRoutes.firstEnabledBindingForChannel(ch.id)
    if (!binding) {
      return { ok: false, error: '请先为渠道绑定一个启用模型', results: [] }
    }

    const protocols = this.applyPolicy(() => normalizeProtocols(ch, ch.protocol || 'chat'))
    const results = []
    for (const protocol of protocols) {
      results.push(
        await this.testProtocol(
          ch,
          keys[0],
          protocol,
          binding.binding.upstreamModel || binding.model.name,
        ),
      )
    }
    return {
      ok: results.length > 0 && results.every((result) => result.ok),
      results,
    }
  }

  private applyPolicy<T>(fn: () => T): T {
    try {
      return fn()
    } catch (error) {
      throw new BadRequestException(error?.message || '渠道协议配置错误')
    }
  }

  private async testProtocol(
    channel: Channel,
    key: string,
    protocol: RelayProtocol,
    upstreamModel: string,
  ) {
    let extraHeaders: Record<string, string>
    try {
      extraHeaders = parseChannelHeaders(channel.headersJson)
    } catch (error) {
      return { protocol, ok: false, error: error?.message || '自定义请求头配置错误' }
    }
    const path = protocol === 'responses'
      ? '/responses'
      : protocol === 'anthropic'
        ? '/messages'
        : '/chat/completions'
    const body = protocol === 'responses'
      ? {
          model: upstreamModel,
          input: 'Reply with OK.',
          max_output_tokens: 1,
          stream: false,
        }
      : protocol === 'anthropic'
        ? {
            model: upstreamModel,
            messages: [{ role: 'user', content: 'Reply with OK.' }],
            max_tokens: 1,
            stream: false,
          }
      : {
          model: upstreamModel,
          messages: [{ role: 'user', content: 'Reply with OK.' }],
          max_tokens: 1,
          stream: false,
        }
    try {
      const response = await axios.post(buildUpstreamUrl(channel.baseUrl, path), body, {
        headers: protocol === 'anthropic'
          ? {
              'Content-Type': 'application/json',
              'anthropic-version': '2023-06-01',
              ...extraHeaders,
              'x-api-key': key,
            }
          : {
              Authorization: `Bearer ${key}`,
              'Content-Type': 'application/json',
              ...extraHeaders,
            },
        timeout: 30_000,
        proxy: parseChannelProxy(channel.proxy),
        validateStatus: () => true,
      })
      const ok = response.status >= 200 && response.status < 300 && !response.data?.error
      return {
        protocol,
        ok,
        status: response.status,
        error: ok
          ? undefined
          : response.data?.error?.message || `HTTP ${response.status}`,
      }
    } catch (error) {
      return { protocol, ok: false, error: error?.message || '请求失败' }
    }
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Channel, ModelConfig]), RelayModule, AuthModule, RoutingMetadataModule, ModelRouteModule],
  controllers: [ChannelController],
})
export class ChannelModule {}
