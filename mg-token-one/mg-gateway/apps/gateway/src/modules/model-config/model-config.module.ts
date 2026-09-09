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
  NotFoundException,
  BadRequestException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { DeepPartial, In, Repository } from 'typeorm'
import { TypeOrmModule } from '@nestjs/typeorm'
import { ModelConfig } from '@/entities/model-config.entity'
import { Channel } from '@/entities/channel.entity'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { Roles } from '@/modules/auth/guards/roles.guard'
import { PaginationDto, PageResult } from '@/common/dto/pagination.dto'
import { RelayModule } from '@/modules/relay/relay.module'
import { ChannelPoolService } from '@/modules/relay/channel-pool.service'
import { AuthModule } from '@/modules/auth/auth.module'
import { CurrentUser } from '@/common/decorators/current-user.decorator'
import { User } from '@/entities/user.entity'
import { Inject } from '@nestjs/common'
import { Group } from '@/entities/group.entity'
import { GroupModule } from '@/modules/group/group.module'
import { ModelGroupService } from '@/modules/group/model-group.service'
import { RoutingMetadataModule } from '@/modules/routing-metadata/routing-metadata.module'
import { RoutingMetadataService } from '@/modules/routing-metadata/routing-metadata.service'
import { ModelRouteModule } from '@/modules/model-route/model-route.module'
import { ModelRouteStore } from '@/modules/model-route/model-route.store'
import {
  assertBindingChannelsExist,
  ModelBindingInput,
  normalizeBinaryFlag,
  normalizeModelBindings,
  normalizeModelName,
} from './model-policy'
import {
  normalizePrice,
  normalizePricingMode,
  PricingMode,
} from '@/modules/relay/pricing-policy'

class ModelConfigDto {
  name: string
  modelOwnerId?: number | null
  groupTag?: string
  groupNames?: string[]
  bindings?: { channelId: number; upstreamModel: string; priority?: number; weight?: number; status?: number }[]
  inputPrice?: number
  cachePrice?: number
  outputPrice?: number
  pricingMode?: PricingMode
  peakInputPrice?: number
  peakCachePrice?: number
  peakOutputPrice?: number
  status?: number
  remark?: string
  contextLength?: number
  maxOutputTokens?: number
  supportsVision?: number
  supportsTools?: number
  supportsReasoning?: number
  supportsResponses?: number
  supportsAnthropic?: number
  reasoningEfforts?: string
  inputModalities?: string[]
  outputModalities?: string[]
  visionNotes?: string
}

/** 序列化能力元数据（portal 与 relay /v1/models 共用口径） */
function toSpec(m: ModelConfig) {
  return {
    name: m.name,
    groupTag: m.groupTag || 'default',
    remark: m.remark,
    contextLength: m.contextLength || 0,
    maxOutputTokens: m.maxOutputTokens || 0,
    supportsVision: m.supportsVision === 1,
    supportsTools: m.supportsTools === 1,
    supportsReasoning: m.supportsReasoning === 1,
    supportsResponses: m.supportsResponses === 1,
    supportsAnthropic: m.supportsAnthropic === 1,
    reasoningEfforts: m.reasoningEfforts || null,
    inputModalities: m.inputModalities || ['text'],
    outputModalities: m.outputModalities || ['text'],
    visionNotes: m.visionNotes || null,
  }
}

/** Public documentation catalog. Never expose groups, prices, bindings or upstream names. */
function toPublicSpec(m: ModelConfig) {
  return {
    name: m.name,
    contextLength: m.contextLength || 0,
    maxOutputTokens: m.maxOutputTokens || 0,
    supportsVision: m.supportsVision === 1,
    supportsTools: m.supportsTools === 1,
    supportsReasoning: m.supportsReasoning === 1,
    supportsResponses: m.supportsResponses === 1,
    supportsAnthropic: m.supportsAnthropic === 1,
    reasoningEfforts: m.reasoningEfforts || null,
    inputModalities: m.inputModalities || ['text'],
    outputModalities: m.outputModalities || ['text'],
  }
}

/** 门户：当前登录用户可见的模型列表（按分组过滤；走登录 JWT，供文档中心/调试页实时拉取） */
@Controller('api/portal/models')
@UseGuards(JwtAuthGuard)
export class ModelPortalController {
  constructor(
    @InjectRepository(ModelConfig) private readonly repo: Repository<ModelConfig>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly modelGroups: ModelGroupService,
  ) {}

  @Get()
  async list(@CurrentUser() jwt: any) {
    const models = await this.repo.find({ where: { status: 1 }, order: { id: 'ASC' } })
    const me = await this.userRepo.findOne({ where: { id: jwt.sub } })
    const role = me?.role || jwt.role
    const groups: string[] =
      role === 'admin'
        ? [] // admin 见全部
        : Array.isArray(me?.groupNames) && me!.groupNames!.length
          ? me!.groupNames!
          : ['default']
    const groupNamesByModel = await this.modelGroups.groupNamesByModel(models)
    const visible = models.filter((model) =>
      role === 'admin' || (groupNamesByModel.get(model.name) || []).some((name) => groups.includes(name)),
    )
    return {
      list: visible.map((model) => ({
        ...toSpec(model),
        groupNames: groupNamesByModel.get(model.name) || [],
      })),
    }
  }
}

@Controller('api/public/models')
export class PublicModelController {
  constructor(
    @InjectRepository(ModelConfig) private readonly repo: Repository<ModelConfig>,
  ) {}

  @Get()
  async list() {
    const models = await this.repo.find({
      where: { status: 1 },
      order: { id: 'ASC' },
    })
    return { list: models.map(toPublicSpec) }
  }
}

@Controller('api/admin/models')
@UseGuards(JwtAuthGuard, Roles('admin'))
export class ModelConfigController {
  constructor(
    @InjectRepository(ModelConfig) private readonly repo: Repository<ModelConfig>,
    @InjectRepository(Channel) private readonly channelRepo: Repository<Channel>,
    private readonly pool: ChannelPoolService,
    private readonly modelGroups: ModelGroupService,
    private readonly metadata: RoutingMetadataService,
    private readonly modelRoutes: ModelRouteStore,
  ) {}

  @Get()
  async list(@Query() q: PaginationDto): Promise<PageResult<ModelConfig>> {
    const page = q.page || 1
    const pageSize = q.pageSize || 10
    const [list, total] = await this.repo.findAndCount({
      skip: (page - 1) * pageSize,
      take: pageSize,
      order: { id: 'ASC' },
    })
    const groupNamesByModel = await this.modelGroups.groupNamesByModel(list)
    const bindingsByModel = await this.modelRoutes.bindingsByModel(list)
    const catalog = await this.metadata.catalog()
    const ownerNames = new Map(catalog.modelOwners.map((owner) => [owner.id, owner.name]))
    return {
      list: list.map((model) => ({
        ...model,
        bindings: bindingsByModel.get(model.id) || [],
        modelOwnerName: model.modelOwnerId ? ownerNames.get(model.modelOwnerId) || null : null,
        groupNames: groupNamesByModel.get(model.name) || [],
        routing: this.pool.describe(model.name),
      })),
      total,
      page,
      pageSize,
    }
  }

  @Post()
  async create(@Body() dto: ModelConfigDto) {
    const name = this.applyPolicy(() => normalizeModelName(dto.name))
    const bindings = this.applyPolicy(() => normalizeModelBindings(dto.bindings))
    await this.validateBindingChannels(bindings)
    const exists = await this.repo.findOne({ where: { name } })
    if (exists) throw new BadRequestException('模型名已存在')
    const groupNames = await this.modelGroups.validateGroupNames(
      dto.groupNames ?? (dto.groupTag ? [dto.groupTag] : ['default']),
    )
    const m = this.repo.create({
      name,
      modelOwnerId: await this.metadata.requireModelOwner(dto.modelOwnerId),
      groupTag: groupNames[0] || 'default',
      bindings: null,
      inputPrice: this.applyPolicy(() => normalizePrice(dto.inputPrice)),
      cachePrice: this.applyPolicy(() => normalizePrice(dto.cachePrice)),
      outputPrice: this.applyPolicy(() => normalizePrice(dto.outputPrice)),
      pricingMode: this.applyPolicy(() => normalizePricingMode(dto.pricingMode)),
      peakInputPrice: this.applyPolicy(() => normalizePrice(dto.peakInputPrice)),
      peakCachePrice: this.applyPolicy(() => normalizePrice(dto.peakCachePrice)),
      peakOutputPrice: this.applyPolicy(() => normalizePrice(dto.peakOutputPrice)),
      status: this.applyPolicy(() => normalizeBinaryFlag(dto.status, 1)),
      remark: dto.remark || null,
      contextLength: dto.contextLength ?? 0,
      maxOutputTokens: dto.maxOutputTokens ?? 0,
      supportsVision: this.applyPolicy(() => normalizeBinaryFlag(dto.supportsVision)),
      supportsTools: this.applyPolicy(() => normalizeBinaryFlag(dto.supportsTools)),
      supportsReasoning: this.applyPolicy(() => normalizeBinaryFlag(dto.supportsReasoning)),
      supportsResponses: this.applyPolicy(() => normalizeBinaryFlag(dto.supportsResponses)),
      supportsAnthropic: this.applyPolicy(() => normalizeBinaryFlag(dto.supportsAnthropic)),
      reasoningEfforts: dto.reasoningEfforts || null,
      inputModalities: dto.inputModalities || null,
      outputModalities: dto.outputModalities || null,
      visionNotes: dto.visionNotes || null,
    } as DeepPartial<ModelConfig>)
    const saved = await this.modelGroups.syncModelGroups(
      await this.saveModel(m, bindings),
      groupNames,
    )
    await this.pool.refresh()
    return saved
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: ModelConfigDto) {
    const m = await this.repo.findOne({ where: { id: parseInt(id, 10) } })
    if (!m) throw new NotFoundException('模型不存在')
    const previousName = m.name
    if (dto.name !== undefined) {
      const name = this.applyPolicy(() => normalizeModelName(dto.name))
      const duplicate = await this.repo.findOne({ where: { name } })
      if (duplicate && duplicate.id !== m.id) throw new BadRequestException('模型名已存在')
      m.name = name
    }
    if (dto.modelOwnerId !== undefined) {
      m.modelOwnerId = await this.metadata.requireModelOwner(dto.modelOwnerId)
    }
    const requestedGroupNames =
      dto.groupNames ?? (dto.groupTag !== undefined ? [dto.groupTag] : undefined)
    let requestedBindings: ModelBindingInput[] | undefined
    if (dto.bindings !== undefined) {
      const bindings = this.applyPolicy(() => normalizeModelBindings(dto.bindings))
      await this.validateBindingChannels(bindings)
      requestedBindings = bindings
    }
    if (dto.inputPrice !== undefined) {
      m.inputPrice = this.applyPolicy(() => normalizePrice(dto.inputPrice, m.inputPrice))
    }
    if (dto.cachePrice !== undefined) {
      m.cachePrice = this.applyPolicy(() => normalizePrice(dto.cachePrice, m.cachePrice))
    }
    if (dto.outputPrice !== undefined) {
      m.outputPrice = this.applyPolicy(() => normalizePrice(dto.outputPrice, m.outputPrice))
    }
    if (dto.pricingMode !== undefined) {
      m.pricingMode = this.applyPolicy(() => normalizePricingMode(dto.pricingMode, m.pricingMode))
    }
    if (dto.peakInputPrice !== undefined) {
      m.peakInputPrice = this.applyPolicy(() => normalizePrice(dto.peakInputPrice, m.peakInputPrice))
    }
    if (dto.peakCachePrice !== undefined) {
      m.peakCachePrice = this.applyPolicy(() => normalizePrice(dto.peakCachePrice, m.peakCachePrice))
    }
    if (dto.peakOutputPrice !== undefined) {
      m.peakOutputPrice = this.applyPolicy(() => normalizePrice(dto.peakOutputPrice, m.peakOutputPrice))
    }
    if (dto.status !== undefined) {
      m.status = this.applyPolicy(() => normalizeBinaryFlag(dto.status, m.status))
    }
    if (dto.remark !== undefined) m.remark = dto.remark || null
    if (dto.contextLength !== undefined) m.contextLength = dto.contextLength
    if (dto.maxOutputTokens !== undefined) m.maxOutputTokens = dto.maxOutputTokens
    if (dto.supportsVision !== undefined) {
      m.supportsVision = this.applyPolicy(() => normalizeBinaryFlag(dto.supportsVision, m.supportsVision))
    }
    if (dto.supportsTools !== undefined) {
      m.supportsTools = this.applyPolicy(() => normalizeBinaryFlag(dto.supportsTools, m.supportsTools))
    }
    if (dto.supportsReasoning !== undefined) {
      m.supportsReasoning = this.applyPolicy(() => normalizeBinaryFlag(dto.supportsReasoning, m.supportsReasoning))
    }
    if (dto.supportsResponses !== undefined) {
      m.supportsResponses = this.applyPolicy(() => normalizeBinaryFlag(dto.supportsResponses, m.supportsResponses))
    }
    if (dto.supportsAnthropic !== undefined) {
      m.supportsAnthropic = this.applyPolicy(() => normalizeBinaryFlag(dto.supportsAnthropic, m.supportsAnthropic))
    }
    if (dto.reasoningEfforts !== undefined) m.reasoningEfforts = dto.reasoningEfforts || null
    if (dto.inputModalities !== undefined) m.inputModalities = dto.inputModalities || null
    if (dto.outputModalities !== undefined) m.outputModalities = dto.outputModalities || null
    if (dto.visionNotes !== undefined) m.visionNotes = dto.visionNotes || null
    const routeSaved = await this.saveModel(m, requestedBindings)
    const saved = requestedGroupNames === undefined
      ? routeSaved
      : await this.modelGroups.syncModelGroups(routeSaved, requestedGroupNames, previousName)
    await this.pool.refresh()
    return saved
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    const model = await this.repo.findOne({ where: { id: parseInt(id, 10) } })
    if (model) await this.modelGroups.syncModelGroups(model, [])
    await this.modelRoutes.removeModel(parseInt(id, 10))
    await this.pool.refresh()
    return { ok: true }
  }

  private applyPolicy<T>(fn: () => T): T {
    try {
      return fn()
    } catch (error) {
      throw new BadRequestException(error?.message || '模型配置错误')
    }
  }

  private async saveModel(
    model: ModelConfig,
    bindings?: ModelBindingInput[],
  ): Promise<ModelConfig> {
    return this.modelRoutes.saveModel(model, bindings)
  }

  private async validateBindingChannels(bindings: ModelBindingInput[]): Promise<void> {
    if (!bindings.length) return
    const ids = bindings.map((binding) => binding.channelId)
    const channels = await this.channelRepo.find({ where: { id: In(ids) } })
    this.applyPolicy(() => assertBindingChannelsExist(bindings, channels.map((channel) => channel.id)))
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([ModelConfig, Channel, User, Group]), RelayModule, AuthModule, GroupModule, RoutingMetadataModule, ModelRouteModule],
  controllers: [ModelConfigController, ModelPortalController, PublicModelController],
})
export class ModelConfigModule {}
