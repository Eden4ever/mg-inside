import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { DataSource, In, Repository } from 'typeorm'
import { ModelConfig, ModelBinding } from '@/entities/model-config.entity'
import { ModelRoute } from '@/entities/model-route.entity'
import { ModelBindingInput } from '@/modules/model-config/model-policy'

export interface StoredModelBinding extends ModelBinding {
  weight: number
  status: number
}

@Injectable()
export class ModelRouteStore {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ModelRoute)
    private readonly routeRepo: Repository<ModelRoute>,
  ) {}

  async bindingsByModel(
    models: ModelConfig[],
  ): Promise<Map<number, StoredModelBinding[]>> {
    const result = new Map(models.map((model) => [model.id, [] as StoredModelBinding[]]))
    const modelIds = models.map((model) => model.id).filter(Number.isInteger)
    if (!modelIds.length) return result
    const routes = await this.routeRepo.find({
      where: { modelId: In(modelIds) },
      order: { priority: 'DESC', id: 'ASC' },
    })
    for (const route of routes) {
      const bindings = result.get(Number(route.modelId))
      if (!bindings) continue
      bindings.push({
        channelId: Number(route.channelId),
        upstreamModel: route.upstreamModel,
        priority: Number(route.priority) || 0,
        weight: Number(route.weight) || 1,
        status: route.status === 0 ? 0 : 1,
      })
    }
    return result
  }

  async saveModel(
    model: ModelConfig,
    bindings?: ModelBindingInput[],
  ): Promise<ModelConfig> {
    return this.dataSource.transaction(async (manager) => {
      if (bindings !== undefined) model.bindings = this.toShadowBindings(bindings)
      const saved = await manager.getRepository(ModelConfig).save(model)
      if (bindings !== undefined) {
        const routes = manager.getRepository(ModelRoute)
        await routes.delete({ modelId: saved.id })
        if (bindings.length) {
          await routes.save(bindings.map((binding) => routes.create({
            modelId: saved.id,
            channelId: binding.channelId,
            upstreamModel: binding.upstreamModel,
            priority: binding.priority || 0,
            weight: binding.weight || 1,
            status: binding.status === 0 ? 0 : 1,
          })))
        }
      }
      return saved
    })
  }

  async modelNamesReferencingChannel(channelId: number): Promise<string[]> {
    const rows = await this.routeRepo
      .createQueryBuilder('route')
      .innerJoin(ModelConfig, 'model', 'model.id = route.modelId')
      .select('model.name', 'name')
      .where('route.channelId = :channelId', { channelId })
      .orderBy('model.id', 'ASC')
      .getRawMany<{ name: string }>()
    return rows.map((row) => row.name)
  }

  async firstEnabledBindingForChannel(
    channelId: number,
  ): Promise<{ model: ModelConfig; binding: StoredModelBinding } | null> {
    const route = await this.routeRepo.findOne({
      where: { channelId, status: 1 },
      order: { priority: 'DESC', id: 'ASC' },
    })
    if (!route) return null
    const model = await this.dataSource.getRepository(ModelConfig).findOne({
      where: { id: Number(route.modelId), status: 1 },
    })
    if (!model) return null
    return {
      model,
      binding: {
        channelId: Number(route.channelId),
        upstreamModel: route.upstreamModel,
        priority: Number(route.priority) || 0,
        weight: Number(route.weight) || 1,
        status: 1,
      },
    }
  }

  async removeModel(modelId: number): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(ModelRoute).delete({ modelId })
      await manager.getRepository(ModelConfig).delete(modelId)
    })
  }

  private toShadowBindings(bindings: ModelBindingInput[]): StoredModelBinding[] {
    return bindings.map((binding) => ({
      channelId: binding.channelId,
      upstreamModel: binding.upstreamModel,
      priority: binding.priority || 0,
      weight: binding.weight || 1,
      status: binding.status === 0 ? 0 : 1,
    }))
  }
}
