<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h2>模型管理</h2>
        <p class="sub">对外统一模型名，绑定到一个或多个上游渠道实现负载与 failover</p>
      </div>
      <div style="display: flex; gap: 10px; align-items: center">
        <el-select v-model="groupFilter" placeholder="按分组筛选" clearable style="width: 170px" @change="onFilter">
          <el-option v-for="g in allGroups" :key="g.name" :label="g.name" :value="g.name" />
        </el-select>
        <el-button type="primary" :icon="Plus" @click="openCreate">新建模型</el-button>
      </div>
    </div>

    <div class="table-card">
      <el-table :data="rows" v-loading="loading" stripe style="width: 100%">
        <el-table-column prop="id" label="ID" width="64" />
        <el-table-column prop="name" label="模型名" min-width="190" show-overflow-tooltip>
          <template #default="{ row }">
            <span style="font-weight: 600">{{ row.name }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="modelOwnerName" label="模型所有者" width="130" show-overflow-tooltip>
          <template #default="{ row }">{{ row.modelOwnerName || '未标注' }}</template>
        </el-table-column>
        <el-table-column label="分组" min-width="150">
          <template #default="{ row }">
            <el-tag v-for="groupName in row.groupNames" :key="groupName" size="small" effect="plain" style="margin: 0 4px 4px 0">{{ groupName }}</el-tag>
            <span v-if="!row.groupNames?.length" class="tip">未分配</span>
          </template>
        </el-table-column>
        <el-table-column label="绑定渠道" min-width="140">
          <template #default="{ row }">
            <el-tag
              v-for="b in (row.bindings || [])"
              :key="b.channelId + b.upstreamModel"
              size="small"
              effect="plain"
              :type="bindingStatusType(row, b)"
              style="margin-right: 4px"
            >
              <el-tooltip :content="bindingStatusLabel(row, b)" placement="top">
                <span>{{ bindingLabel(b) }}</span>
              </el-tooltip>
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="路由策略" width="130" align="center">
          <template #default="{ row }">
            <el-tag :type="routingStatusType(row)" size="small" effect="light">
              {{ routingStrategyLabel(row) }}
            </el-tag>
            <div class="routing-count">{{ row.routing?.availableBindingCount || 0 }}/{{ row.routing?.configuredBindingCount || 0 }} 可用</div>
          </template>
        </el-table-column>
        <el-table-column prop="inputPrice" label="输入价" width="90" align="center" />
        <el-table-column prop="cachePrice" label="缓存价" width="90" align="center">
          <template #default="{ row }">{{ formatPrice(row.cachePrice) }}</template>
        </el-table-column>
        <el-table-column prop="outputPrice" label="输出价" width="90" align="center" />
        <el-table-column label="计价" width="120" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.pricingMode === 'deepseek_peak_valley'" size="small" type="warning" effect="plain">DeepSeek 峰谷</el-tag>
            <span v-else class="tip">固定</span>
          </template>
        </el-table-column>
        <el-table-column label="能力" min-width="200">
          <template #default="{ row }">
            <el-tag v-if="row.contextLength" size="small" effect="plain" style="margin: 0 4px 4px 0">{{ fmtCtx(row.contextLength) }} ctx</el-tag>
            <el-tag v-if="row.supportsVision === 1" size="small" effect="plain" type="success" style="margin: 0 4px 4px 0">视觉</el-tag>
            <el-tag v-if="row.supportsReasoning === 1" size="small" effect="plain" type="warning" style="margin: 0 4px 4px 0">思考</el-tag>
            <el-tag v-if="row.supportsTools === 1" size="small" effect="plain" type="primary" style="margin: 0 4px 4px 0">工具</el-tag>
            <el-tag v-if="row.supportsResponses === 1" size="small" effect="plain" style="margin: 0 4px 4px 0">Responses</el-tag>
            <el-tag v-if="row.supportsAnthropic === 1" size="small" effect="plain" type="success" style="margin: 0 4px 4px 0">Anthropic</el-tag>
            <span v-if="!row.contextLength && row.supportsVision !== 1 && row.supportsReasoning !== 1 && row.supportsTools !== 1 && row.supportsResponses !== 1 && row.supportsAnthropic !== 1" class="tip">未标注</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'info'" effect="light" round>
              {{ row.status === 1 ? '启用' : '禁用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <el-button size="small" text type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button size="small" text type="danger" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="暂无模型" />
        </template>
      </el-table>
      <div class="table-pager">
        <el-pagination
          background
          layout="total, prev, pager, next, sizes"
          :total="total"
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :page-sizes="[10, 20, 50]"
          @current-change="load"
          @size-change="load"
        />
      </div>
    </div>

    <el-dialog v-model="visible" :title="editing ? '编辑模型' : '新建模型'" width="min(920px, calc(100vw - 28px))" destroy-on-close>
      <el-form :model="form" label-width="96px">
        <el-form-item label="模型名" required>
          <el-input v-model="form.name" placeholder="如 MiniMax-M3" />
        </el-form-item>
        <el-form-item label="模型所有者">
          <el-select v-model="form.modelOwnerId" clearable filterable style="width: 100%" placeholder="选择 OpenAI / Anthropic / DeepSeek 等">
            <el-option v-for="owner in modelOwners" :key="owner.id" :label="owner.name" :value="owner.id" />
          </el-select>
          <div class="form-tip">模型所有者描述能力和官方命名；供应商渠道在绑定关系中单独配置。</div>
        </el-form-item>
        <el-form-item label="分组">
          <el-select v-model="form.groupNames" multiple filterable style="width: 100%" placeholder="选择可访问该模型的分组">
            <el-option v-for="g in allGroups" :key="g.name" :label="g.name" :value="g.name" />
          </el-select>
          <div class="form-tip">一个模型可分配给多个分组；未分配分组的模型仅管理员可见。</div>
        </el-form-item>
        <el-form-item label="绑定">
          <div class="binding-editor">
            <div v-if="bindings.length" class="binding-head" aria-hidden="true">
              <span>渠道与供应商账户</span>
              <span>上游模型</span>
              <span>优先级</span>
              <span>权重</span>
              <span>启用</span>
            </div>
            <div v-for="(binding, index) in bindings" :key="index" class="binding-row">
              <el-select v-model="binding.channelId" filterable placeholder="选择渠道" class="binding-channel" @change="onBindingChannelChange(binding, $event)">
                <el-option
                  v-for="channel in channelOptions"
                  :key="channel.id"
                  :label="channelOptionLabel(channel)"
                  :value="Number(channel.id)"
                  :disabled="channelSelectedElsewhere(Number(channel.id), index)"
                />
              </el-select>
              <el-input v-model="binding.upstreamModel" placeholder="上游模型名" class="binding-model" />
              <div class="binding-control">
                <span class="binding-mobile-label">优先级</span>
                <el-input-number v-model="binding.priority" :min="0" :step="1" :precision="0" controls-position="right" aria-label="绑定优先级" class="binding-priority" />
              </div>
              <div class="binding-control">
                <span class="binding-mobile-label">权重</span>
                <el-input-number v-model="binding.weight" :min="1" :max="1000" :step="1" :precision="0" controls-position="right" aria-label="绑定权重" class="binding-weight" />
              </div>
              <div class="binding-control binding-toggle">
                <span class="binding-mobile-label">启用</span>
                <el-switch v-model="binding.statusOn" aria-label="绑定启用状态" />
              </div>
              <el-tooltip content="移除绑定" placement="top">
                <el-button text type="danger" :icon="Delete" aria-label="移除绑定" class="binding-remove" @click="removeBinding(index)" />
              </el-tooltip>
            </div>
            <el-button :icon="Plus" @click="addBinding">添加渠道</el-button>
            <div v-if="!bindings.length" class="form-tip">当前模型未绑定上游渠道。</div>
          </div>
        </el-form-item>
        <el-row :gutter="12" class="price-grid">
          <el-col :span="8">
            <el-form-item label="输入价" label-position="top">
              <el-input-number v-model="form.inputPrice" :min="0" :step="0.001" :precision="6" :controls="false" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="缓存价" label-position="top">
              <el-input-number v-model="form.cachePrice" :min="0" :step="0.001" :precision="6" :controls="false" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="输出价" label-position="top">
              <el-input-number v-model="form.outputPrice" :min="0" :step="0.001" :precision="6" :controls="false" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <div class="form-tip price-tip">价格单位：人民币元 / 100 万 token；缓存价为 0 时按普通输入价计费</div>
        <el-form-item label="计价模式">
          <el-select v-model="form.pricingMode" style="width: 100%">
            <el-option label="固定价格" value="fixed" />
            <el-option label="DeepSeek 峰谷价格" value="deepseek_peak_valley" />
          </el-select>
          <div v-if="form.pricingMode === 'deepseek_peak_valley'" class="form-tip">
            按北京时间计价：高峰 09:00-12:00、14:00-18:00，其余为低谷。请填写低谷和高峰的输入、缓存命中、输出单价。
          </div>
        </el-form-item>
        <el-row v-if="form.pricingMode === 'deepseek_peak_valley'" :gutter="12" class="price-grid peak-price-grid">
          <el-col :span="8">
            <el-form-item label="高峰输入价" label-position="top">
              <el-input-number v-model="form.peakInputPrice" :min="0" :step="0.001" :precision="6" :controls="false" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="高峰缓存价" label-position="top">
              <el-input-number v-model="form.peakCachePrice" :min="0" :step="0.001" :precision="6" :controls="false" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="高峰输出价" label-position="top">
              <el-input-number v-model="form.peakOutputPrice" :min="0" :step="0.001" :precision="6" :controls="false" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-divider content-position="left">能力元数据</el-divider>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="上下文">
              <el-input-number v-model="form.contextLength" :min="0" :step="1000" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="最大输出">
              <el-input-number v-model="form.maxOutputTokens" :min="0" :step="1000" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="能力开关">
          <div style="display: flex; gap: 18px; flex-wrap: wrap">
            <el-checkbox v-model="form.supportsVision">视觉(图片/视频)</el-checkbox>
            <el-checkbox v-model="form.supportsReasoning">思考/推理</el-checkbox>
            <el-checkbox v-model="form.supportsTools">工具调用</el-checkbox>
            <el-checkbox v-model="form.supportsResponses">Responses API</el-checkbox>
            <el-checkbox v-model="form.supportsAnthropic">Anthropic Messages</el-checkbox>
          </div>
        </el-form-item>
        <el-form-item label="思考强度">
          <el-input v-model="form.reasoningEfforts" placeholder="如 low,medium,high / enabled / on-off（可留空）" />
        </el-form-item>
        <el-form-item label="输入模态">
          <el-select v-model="form.inputModalities" multiple allow-create default-first-option style="width: 100%" placeholder="text, image, video...">
            <el-option label="text" value="text" />
            <el-option label="image" value="image" />
            <el-option label="video" value="video" />
            <el-option label="audio" value="audio" />
          </el-select>
        </el-form-item>
        <el-form-item label="视觉说明">
          <el-input v-model="form.visionNotes" placeholder="图片格式/大小限制（可留空）" />
        </el-form-item>
        <el-divider content-position="left">其他</el-divider>
        <el-form-item label="状态">
          <el-switch v-model="form.statusOn" active-text="启用" inactive-text="禁用" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, Plus } from '@element-plus/icons-vue'
import api from '@/api'

const rows = ref<any[]>([])
const total = ref(0)
const loading = ref(false)
const page = ref(1)
const pageSize = ref(10)

const visible = ref(false)
const editing = ref(false)
const saving = ref(false)
const editingId = ref<number | null>(null)
const bindings = ref<Array<{ channelId: number | null; upstreamModel: string; priority: number; weight: number; statusOn: boolean }>>([])
const allGroups = ref<any[]>([])
const modelOwners = ref<any[]>([])
const channelOptions = ref<any[]>([])
const groupFilter = ref('')
const form = reactive({
  name: '', modelOwnerId: null as number | null, groupNames: ['default'] as string[], inputPrice: 0, cachePrice: 0, outputPrice: 0,
  pricingMode: 'fixed', peakInputPrice: 0, peakCachePrice: 0, peakOutputPrice: 0, statusOn: true, remark: '',
  contextLength: 0, maxOutputTokens: 0, supportsVision: false, supportsReasoning: false,
  supportsTools: false, reasoningEfforts: '', inputModalities: ['text'] as string[], visionNotes: '',
  supportsResponses: false,
  supportsAnthropic: false,
})

function fmtCtx(n: number) {
  if (n >= 1000000) return (n / 1000000).toFixed(0) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(0) + 'K'
  return String(n)
}

function formatPrice(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number.toString() : '0'
}

async function loadGroups() {
  try {
    const { data } = await api.get('/admin/groups')
    allGroups.value = data
  } catch { /* ignore */ }
}

async function loadMetadata() {
  try {
    const { data } = await api.get('/admin/routing-metadata')
    modelOwners.value = data?.modelOwners || []
  } catch { /* metadata is optional for legacy models */ }
}

async function loadChannels() {
  try {
    const { data } = await api.get('/admin/channels', { params: { page: 1, pageSize: 1000 } })
    channelOptions.value = data?.list || []
  } catch { /* 渠道列表加载失败时仍可查看模型 */ }
}

function channelOptionLabel(channel: any) {
  const account = channel.supplierAccountName || '未归属账户'
  return `${account} / ${channel.name}`
}

function bindingLabel(binding: any) {
  const channel = channelOptions.value.find((item) => Number(item.id) === Number(binding.channelId))
  const channelName = channel ? channelOptionLabel(channel) : `渠道 #${binding.channelId}`
  const weight = Number(binding.weight) || Number(channel?.weight) || 1
  return `${channelName} → ${binding.upstreamModel} · P${Number(binding.priority) || 0} · W${weight}`
}

const bindingStatusLabels: Record<string, string> = {
  available: '当前可路由',
  temporarily_disabled: '渠道临时熔断',
  model_disabled: '模型已停用',
  route_disabled: '路由已停用',
  channel_missing: '渠道不存在',
  channel_disabled: '渠道已停用',
  account_missing: '供应商账户不存在',
  account_disabled: '供应商账户未参与路由',
  credential_unreadable: '渠道密钥无法解密',
  credential_empty: '渠道没有可用密钥',
}

function bindingDiagnostic(row: any, binding: any) {
  return row.routing?.bindings?.find((item: any) =>
    Number(item.channelId) === Number(binding.channelId),
  )
}

function bindingStatusLabel(row: any, binding: any) {
  const status = bindingDiagnostic(row, binding)?.status
  return bindingStatusLabels[String(status)] || '尚未进入路由池'
}

function bindingStatusType(row: any, binding: any) {
  const status = bindingDiagnostic(row, binding)?.status
  if (status === 'available') return 'success'
  if (status === 'temporarily_disabled') return 'warning'
  return 'danger'
}

function routingStrategyLabel(row: any) {
  const labels: Record<string, string> = {
    none: '未配置',
    single: '单渠道',
    load_balance: '同级轮询',
    failover: '主备切换',
  }
  return labels[String(row.routing?.strategy)] || '未配置'
}

function routingStatusType(row: any) {
  const configured = Number(row.routing?.configuredBindingCount) || 0
  const available = Number(row.routing?.availableBindingCount) || 0
  if (configured > 0 && available === configured) return 'success'
  if (available > 0) return 'warning'
  return 'danger'
}

function channelSelectedElsewhere(channelId: number, currentIndex: number) {
  return bindings.value.some((binding, index) => index !== currentIndex && binding.channelId === channelId)
}

function onBindingChannelChange(
  binding: { channelId: number | null; upstreamModel: string; priority: number; weight: number; statusOn: boolean },
  channelId: number,
) {
  const channel = channelOptions.value.find((item) => Number(item.id) === Number(channelId))
  binding.priority = Number(channel?.priority) || 0
}

function addBinding() {
  const next = channelOptions.value.find((channel) =>
    !bindings.value.some((binding) => binding.channelId === Number(channel.id)),
  )
  bindings.value.push({
    channelId: next ? Number(next.id) : null,
    upstreamModel: form.name.trim(),
    priority: Number(next?.priority) || 0,
    weight: Number(next?.weight) || 1,
    statusOn: true,
  })
}

function removeBinding(index: number) {
  bindings.value.splice(index, 1)
}

function onFilter() {
  page.value = 1
  load()
}

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/admin/models', {
      params: { page: page.value, pageSize: pageSize.value },
    })
    let list = data.list
    if (groupFilter.value) list = list.filter((m: any) => (m.groupNames || []).includes(groupFilter.value))
    rows.value = list
    total.value = data.total
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editing.value = false
  editingId.value = null
  Object.assign(form, {
    name: '', groupNames: ['default'], inputPrice: 0, cachePrice: 0, outputPrice: 0,
    modelOwnerId: null,
    pricingMode: 'fixed', peakInputPrice: 0, peakCachePrice: 0, peakOutputPrice: 0, statusOn: true, remark: '',
    contextLength: 0, maxOutputTokens: 0, supportsVision: false, supportsReasoning: false,
    supportsTools: false, reasoningEfforts: '', inputModalities: ['text'], visionNotes: '',
    supportsResponses: false,
    supportsAnthropic: false,
  })
  bindings.value = []
  visible.value = true
}

function openEdit(row: any) {
  editing.value = true
  editingId.value = row.id
  Object.assign(form, {
    name: row.name, groupNames: [...(row.groupNames || [])], inputPrice: row.inputPrice,
    modelOwnerId: row.modelOwnerId || null,
    cachePrice: row.cachePrice || 0, outputPrice: row.outputPrice, statusOn: row.status === 1, remark: row.remark || '',
    pricingMode: row.pricingMode || 'fixed', peakInputPrice: row.peakInputPrice || 0,
    peakCachePrice: row.peakCachePrice || 0, peakOutputPrice: row.peakOutputPrice || 0,
    contextLength: row.contextLength || 0, maxOutputTokens: row.maxOutputTokens || 0,
    supportsVision: row.supportsVision === 1, supportsReasoning: row.supportsReasoning === 1,
    supportsTools: row.supportsTools === 1, reasoningEfforts: row.reasoningEfforts || '',
    supportsResponses: row.supportsResponses === 1,
    supportsAnthropic: row.supportsAnthropic === 1,
    inputModalities: row.inputModalities || ['text'], visionNotes: row.visionNotes || '',
  })
  bindings.value = (row.bindings || []).map((binding: any) => ({
    channelId: Number(binding.channelId),
    upstreamModel: String(binding.upstreamModel || ''),
    priority: Number(binding.priority) || 0,
    weight: Number(binding.weight) || 1,
    statusOn: binding.status !== 0,
  }))
  visible.value = true
}

async function save() {
  if (!form.name) {
    ElMessage.warning('请填写模型名')
    return
  }
  const normalizedBindings = bindings.value.map((binding) => ({
    channelId: Number(binding.channelId),
    upstreamModel: binding.upstreamModel.trim(),
    priority: Number(binding.priority) || 0,
    weight: Number(binding.weight) || 1,
    status: binding.statusOn ? 1 : 0,
  }))
  if (normalizedBindings.some((binding) => !Number.isInteger(binding.channelId) || binding.channelId < 1 || !binding.upstreamModel)) {
    ElMessage.warning('请完整填写每个绑定的渠道和上游模型名')
    return
  }
  if (new Set(normalizedBindings.map((binding) => binding.channelId)).size !== normalizedBindings.length) {
    ElMessage.warning('同一渠道不能重复绑定')
    return
  }
  saving.value = true
  try {
    const payload = {
      name: form.name, modelOwnerId: form.modelOwnerId, groupNames: form.groupNames, bindings: normalizedBindings,
      inputPrice: form.inputPrice, cachePrice: form.cachePrice, outputPrice: form.outputPrice,
      pricingMode: form.pricingMode, peakInputPrice: form.peakInputPrice,
      peakCachePrice: form.peakCachePrice, peakOutputPrice: form.peakOutputPrice,
      status: form.statusOn ? 1 : 0, remark: form.remark || undefined,
      contextLength: form.contextLength || 0, maxOutputTokens: form.maxOutputTokens || 0,
      supportsVision: form.supportsVision ? 1 : 0,
      supportsReasoning: form.supportsReasoning ? 1 : 0,
      supportsTools: form.supportsTools ? 1 : 0,
      supportsResponses: form.supportsResponses ? 1 : 0,
      supportsAnthropic: form.supportsAnthropic ? 1 : 0,
      reasoningEfforts: form.reasoningEfforts || undefined,
      inputModalities: form.inputModalities || ['text'],
      outputModalities: ['text'],
      visionNotes: form.visionNotes || undefined,
    }
    if (editing.value) await api.put(`/admin/models/${editingId.value}`, payload)
    else await api.post('/admin/models', payload)
    ElMessage.success('保存成功')
    visible.value = false
    load()
  } catch (e: any) {
    ElMessage.error(e?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function remove(row: any) {
  try {
    await ElMessageBox.confirm(`确认删除模型「${row.name}」？`, '删除确认', {
      type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消',
      confirmButtonClass: 'el-button--danger',
    })
  } catch { return }
  await api.delete(`/admin/models/${row.id}`)
  ElMessage.success('已删除')
  load()
}

onMounted(() => {
  load()
  loadGroups()
  loadMetadata()
  loadChannels()
})
</script>

<style scoped>
.form-tip { font-size: 12px; color: var(--ink-3); margin-top: 4px; }
.price-grid :deep(.el-form-item) { display: block; }
.price-grid :deep(.el-form-item__label) { display: block; width: auto !important; margin-bottom: 6px; line-height: 20px; }
.price-grid :deep(.el-form-item__content) { margin-left: 0 !important; }
.price-grid :deep(.el-input-number .el-input__inner) { text-align: left; }
.price-tip { margin: -8px 0 12px; }
.peak-price-grid { margin-top: -4px; }
.binding-editor { display: grid; width: 100%; gap: 10px; }
.binding-head { display: grid; grid-template-columns: minmax(190px, 1.5fr) minmax(150px, 1fr) 104px 104px 54px 36px; gap: 8px; color: var(--ink-3); font-size: 12px; line-height: 20px; }
.binding-row { display: grid; grid-template-columns: minmax(190px, 1.5fr) minmax(150px, 1fr) 104px 104px 54px 36px; gap: 8px; align-items: center; }
.binding-priority { width: 104px; }
.binding-weight { width: 104px; }
.binding-control { display: flex; align-items: center; width: 100%; }
.binding-mobile-label { display: none; }
.binding-remove { width: 36px; height: 36px; padding: 0; }
.routing-count { margin-top: 4px; color: var(--ink-3); font-size: 11px; line-height: 1.2; }

@media (max-width: 640px) {
  :deep(.el-form-item) { display: block; }
  :deep(.el-form-item__label) { width: auto !important; height: auto; justify-content: flex-start; margin-bottom: 6px; line-height: 20px; }
  :deep(.el-form-item__content) { margin-left: 0 !important; }
  .price-grid > :deep(.el-col) { max-width: 100%; flex: 0 0 100%; }
  .binding-row { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 54px 36px; align-items: end; }
  .binding-head { display: none; }
  .binding-channel { grid-column: 1 / -1; }
  .binding-model { grid-column: 1 / -1; }
  .binding-control { display: grid; gap: 4px; }
  .binding-mobile-label { display: block; color: var(--ink-3); font-size: 12px; line-height: 18px; }
  .binding-priority, .binding-weight { width: 100%; }
  .binding-toggle { justify-items: center; }
}
</style>
