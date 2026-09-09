import { Injectable, BadRequestException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { Group } from '@/entities/group.entity'
import { ModelConfig } from '@/entities/model-config.entity'

/**
 * 分组与模型的多对多关系由 Group.models 保存。
 * 对旧的 NULL 记录，读取时回退到 ModelConfig.groupTag，避免升级后原有权限丢失。
 */
@Injectable()
export class ModelGroupService {
  constructor(
    @InjectRepository(Group) private readonly groupRepo: Repository<Group>,
    @InjectRepository(ModelConfig) private readonly modelRepo: Repository<ModelConfig>,
  ) {}

  async modelNamesForGroup(group: Group, models?: ModelConfig[]): Promise<string[]> {
    if (Array.isArray(group.models)) return [...new Set(group.models)]
    const source = models || (await this.modelRepo.find())
    return source
      .filter((model) => (model.groupTag || 'default') === group.name)
      .map((model) => model.name)
  }

  async groupNamesForModel(model: ModelConfig, groups?: Group[]): Promise<string[]> {
    const source = groups || (await this.groupRepo.find({ order: { id: 'ASC' } }))
    return source
      .filter((group) =>
        Array.isArray(group.models)
          ? group.models.includes(model.name)
          : (model.groupTag || 'default') === group.name,
      )
      .map((group) => group.name)
  }

  async groupNamesByModel(models: ModelConfig[]): Promise<Map<string, string[]>> {
    const groups = await this.groupRepo.find({ order: { id: 'ASC' } })
    return new Map(
      models.map((model) => [model.name, this.groupNamesForModelFrom(model, groups)]),
    )
  }

  async replaceGroupModels(group: Group, modelNames: string[]): Promise<Group> {
    group.models = [...new Set(modelNames)]
    return this.groupRepo.save(group)
  }

  async validateGroupNames(groupNames?: string[]): Promise<string[]> {
    if (groupNames !== undefined && (!Array.isArray(groupNames) || groupNames.some((name) => typeof name !== 'string'))) {
      throw new BadRequestException('分组列表格式错误')
    }
    const names = [...new Set((groupNames || []).map((name) => name.trim()).filter(Boolean))]
    const groups = await this.groupRepo.find({ select: { name: true } })
    const existing = new Set(groups.map((group) => group.name))
    const missing = names.filter((name) => !existing.has(name))
    if (missing.length) throw new BadRequestException(`分组不存在：${missing.join('、')}`)
    return names
  }

  async syncModelGroups(
    model: ModelConfig,
    groupNames: string[],
    previousName = model.name,
  ): Promise<ModelConfig> {
    const targetNames = await this.validateGroupNames(groupNames)
    const groups = await this.groupRepo.find({ order: { id: 'ASC' } })

    const allModels = await this.modelRepo.find()
    const target = new Set(targetNames)
    const affected: Group[] = []
    for (const group of groups) {
      const members = await this.modelNamesForGroup(group, allModels)
      const hasModel = members.includes(previousName)
      const shouldHaveModel = target.has(group.name)
      const needsRename = hasModel && previousName !== model.name
      if (hasModel === shouldHaveModel && !needsRename) continue
      group.models = shouldHaveModel
        ? [...members.filter((name) => name !== previousName), model.name]
        : members.filter((name) => name !== previousName)
      affected.push(group)
    }
    if (affected.length) await this.groupRepo.save(affected)

    // 兼容旧接口与旧数据；实际授权不再依赖该字段。
    model.groupTag = targetNames[0] || 'default'
    return this.modelRepo.save(model)
  }

  private groupNamesForModelFrom(model: ModelConfig, groups: Group[]): string[] {
    return groups
      .filter((group) =>
        Array.isArray(group.models)
          ? group.models.includes(model.name)
          : (model.groupTag || 'default') === group.name,
      )
      .map((group) => group.name)
  }
}
