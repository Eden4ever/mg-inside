export interface ModelBindingInput {
  channelId: number
  upstreamModel: string
  priority?: number
  weight?: number
  status?: number
}

export function normalizeModelName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : ''
  if (!name) throw new Error('模型名必填')
  if (name.length > 100) throw new Error('模型名不能超过 100 个字符')
  return name
}

export function normalizeModelBindings(value: unknown): ModelBindingInput[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error('bindings 必须是数组')
  const seen = new Set<number>()
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`bindings[${index}] 必须是对象`)
    }
    const binding = item as Record<string, unknown>
    const channelId = Number(binding.channelId)
    const upstreamModel = typeof binding.upstreamModel === 'string'
      ? binding.upstreamModel.trim()
      : ''
    const priority = binding.priority === undefined ? 0 : Number(binding.priority)
    const weight = binding.weight === undefined ? 1 : Number(binding.weight)
    const status = binding.status === undefined ? 1 : Number(binding.status)
    if (!Number.isInteger(channelId) || channelId < 1) {
      throw new Error(`bindings[${index}].channelId 必须是正整数`)
    }
    if (seen.has(channelId)) throw new Error(`渠道 ${channelId} 不能重复绑定`)
    if (!upstreamModel || upstreamModel.length > 100) {
      throw new Error(`bindings[${index}].upstreamModel 无效`)
    }
    if (!Number.isInteger(priority) || priority < 0) {
      throw new Error(`bindings[${index}].priority 必须是非负整数`)
    }
    if (!Number.isInteger(weight) || weight < 1 || weight > 1000) {
      throw new Error(`bindings[${index}].weight 必须是 1-1000 的整数`)
    }
    if (status !== 0 && status !== 1) {
      throw new Error(`bindings[${index}].status 必须是 0 或 1`)
    }
    seen.add(channelId)
    return { channelId, upstreamModel, priority, weight, status }
  })
}

export function normalizeBinaryFlag(value: unknown, fallback = 0): number {
  if (typeof value === 'boolean') throw new Error('能力开关必须是 0 或 1')
  const result = value === undefined ? fallback : Number(value)
  if (result !== 0 && result !== 1) throw new Error('能力开关必须是 0 或 1')
  return result
}

export function assertBindingChannelsExist(
  bindings: ModelBindingInput[],
  existingChannelIds: Iterable<number>,
): void {
  const existing = new Set(existingChannelIds)
  const missing = bindings
    .map((binding) => binding.channelId)
    .filter((channelId) => !existing.has(channelId))
  if (missing.length) {
    throw new Error(`绑定渠道不存在：${missing.join('、')}`)
  }
}
