import {
  Module,
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, Repository } from 'typeorm'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Group } from '@/entities/group.entity'
import { ModelConfig } from '@/entities/model-config.entity'
import { User } from '@/entities/user.entity'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { Roles } from '@/modules/auth/guards/roles.guard'
import { AuthModule } from '@/modules/auth/auth.module'
import { GroupPolicyBootstrapService } from './group-policy-bootstrap.service'
import { ModelGroupService } from './model-group.service'

class GroupDto {
  name?: string
  description?: string
  models?: string[]
  monthlyQuota?: number
  status?: number
}

@Controller('api/admin/groups')
@UseGuards(JwtAuthGuard, Roles('admin'))
export class GroupAdminController {
  constructor(
    @InjectRepository(Group) private readonly repo: Repository<Group>,
    @InjectRepository(ModelConfig) private readonly modelRepo: Repository<ModelConfig>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly modelGroups: ModelGroupService,
  ) {}

  /** 分组列表，附带每个分组包含的模型（多对多关系）。 */
  @Get()
  async list() {
    const groups = await this.repo.find({ order: { id: 'ASC' } })
    const models = await this.modelRepo.find()
    return Promise.all(groups.map(async (group) => {
      const modelNames = await this.modelGroups.modelNamesForGroup(group, models)
      return { ...group, modelNames, modelCount: modelNames.length }
    }))
  }

  /** 供分组编辑器选择模型；不返回渠道绑定、价格等模型管理细节。 */
  @Get('model-catalog')
  async modelCatalog() {
    const models = await this.modelRepo.find({ order: { name: 'ASC' } })
    const groupNamesByModel = await this.modelGroups.groupNamesByModel(models)
    return models.map((model) => ({
      id: model.id,
      name: model.name,
      groupNames: groupNamesByModel.get(model.name) || [],
      status: model.status,
    }))
  }

  @Post()
  async create(@Body() dto: GroupDto) {
    if (!dto.name) throw new BadRequestException('name 必填')
    const exists = await this.repo.findOne({ where: { name: dto.name } })
    if (exists) throw new BadRequestException('分组名已存在')
    const monthlyQuota = this.normalizeMonthlyQuota(dto.monthlyQuota)
    const modelNames = await this.validateModelNames(dto.models)
    const g = this.repo.create()
    Object.assign(g, {
      name: dto.name,
      description: dto.description || null,
      models: modelNames,
      monthlyQuota,
      status: dto.status ?? 1,
    })
    const saved = await this.repo.save(g)
    if (dto.models !== undefined) await this.modelGroups.replaceGroupModels(saved, modelNames)
    return saved
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: GroupDto) {
    const g = await this.repo.findOne({ where: { id: parseInt(id, 10) } })
    if (!g) throw new NotFoundException('分组不存在')
    if (dto.description !== undefined) g.description = dto.description || null
    if (dto.monthlyQuota !== undefined)
      g.monthlyQuota = this.normalizeMonthlyQuota(dto.monthlyQuota)
    if (dto.status !== undefined) g.status = dto.status
    const modelNames = await this.validateModelNames(dto.models)
    if (dto.models !== undefined) return this.modelGroups.replaceGroupModels(g, modelNames)
    return this.repo.save(g)
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    const group = await this.repo.findOne({ where: { id: parseInt(id, 10) } })
    if (!group) throw new NotFoundException('分组不存在')
    if (group.name === 'default') throw new BadRequestException('default 分组不可删除')
    const [models, users] = await Promise.all([
      this.modelRepo.find(),
      this.userRepo.find({ select: { id: true, groupNames: true } as any }),
    ])
    if ((await this.modelGroups.modelNamesForGroup(group, models)).length) {
      throw new BadRequestException('该分组仍有关联模型，无法删除')
    }
    if (users.some((user) => Array.isArray(user.groupNames) && user.groupNames.includes(group.name))) {
      throw new BadRequestException('该分组仍有关联用户，无法删除')
    }
    await this.repo.delete(group.id)
    return { ok: true }
  }

  private normalizeMonthlyQuota(value?: number): number {
    const quota = Number(value ?? 0)
    if (!Number.isFinite(quota) || quota < 0) {
      throw new BadRequestException('月度额度必须是不小于 0 的数字')
    }
    return Math.round((quota + Number.EPSILON) * 100) / 100
  }

  private async validateModelNames(models?: string[]): Promise<string[]> {
    if (models === undefined) return []
    if (!Array.isArray(models) || models.some((name) => typeof name !== 'string')) {
      throw new BadRequestException('模型列表格式错误')
    }
    const names = [...new Set(models.map((name) => name.trim()).filter(Boolean))]
    if (!names.length) return []
    const found = await this.modelRepo.find({ where: { name: In(names) } })
    if (found.length !== names.length) {
      const foundNames = new Set(found.map((model) => model.name))
      const missing = names.filter((name) => !foundNames.has(name))
      throw new BadRequestException(`模型不存在：${missing.join('、')}`)
    }
    return names
  }

}

@Module({
  imports: [TypeOrmModule.forFeature([Group, ModelConfig, User]), AuthModule],
  controllers: [GroupAdminController],
  providers: [GroupPolicyBootstrapService, ModelGroupService],
  exports: [TypeOrmModule, ModelGroupService],
})
export class GroupModule {}
