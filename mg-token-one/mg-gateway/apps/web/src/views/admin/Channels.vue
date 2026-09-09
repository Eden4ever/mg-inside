<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h2>渠道管理</h2>
        <p class="sub">配置上游 LLM 服务渠道，支持多 Key 轮询与请求内故障切换</p>
      </div>
      <div class="page-actions">
        <el-tooltip :content="circuitPolicyDetail" placement="bottom">
          <el-tag :type="circuitPolicyTagType" effect="plain" class="policy-tag">
            自动熔断：{{ circuitPolicyLabel }}
          </el-tag>
        </el-tooltip>
        <el-tooltip :content="releaseIdentityDetail" placement="bottom">
          <el-tag type="info" effect="plain" class="policy-tag">
            版本：{{ releaseIdentityLabel }}
          </el-tag>
        </el-tooltip>
        <el-select
          v-model="supplierAccountFilter"
          clearable
          filterable
          placeholder="全部供应商账户"
          style="width: 240px"
          @change="applySupplierFilter"
        >
          <el-option
            v-for="account in supplierAccounts"
            :key="account.id"
            :label="`${account.supplierName} / ${account.name}`"
            :value="Number(account.id)"
          />
        </el-select>
        <el-button type="primary" :icon="Plus" @click="openCreate">新建渠道</el-button>
      </div>
    </div>

    <div class="table-card">
      <el-table :data="rows" v-loading="loading" stripe style="width: 100%">
        <el-table-column prop="id" label="ID" width="64" />
        <el-table-column prop="name" label="名称" min-width="150" show-overflow-tooltip />
        <el-table-column prop="supplierAccountName" label="供应商账户" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ row.supplierAccountName || '未归属' }}</template>
        </el-table-column>
        <el-table-column label="健康" min-width="180">
          <template #default="{ row }">
            <div class="health-cell">
              <el-tooltip :content="healthDetail(row)" placement="top">
                <el-tag :type="healthTagType(row)" effect="light" size="small">
                  {{ healthLabel(row) }}
                </el-tag>
              </el-tooltip>
              <span v-if="row.health?.consecutiveErrors" class="health-meta">
                连续失败 {{ row.health.consecutiveErrors }} 次
              </span>
              <span v-else class="health-meta">{{ healthTime(row) }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="类型" width="110">
          <template #default="{ row }">
            <el-tag size="small" effect="plain">{{ row.type }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="原生协议" min-width="150">
          <template #default="{ row }">
            <el-tag
              v-for="protocol in channelProtocols(row)"
              :key="protocol"
              size="small"
              effect="plain"
              style="margin-right: 4px"
            >{{ protocolLabel(protocol) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="baseUrl" label="Base URL" min-width="200" show-overflow-tooltip />
        <el-table-column label="密钥数" width="96" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.keyStatus === 'unreadable'" type="danger" size="small" effect="plain">
              无法解密
            </el-tag>
            <span v-else>{{ row.keyCount }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="priority" label="默认 P" width="80" align="center" />
        <el-table-column prop="weight" label="权重" width="70" align="center" />
        <el-table-column label="请求/失败" width="110" align="center">
          <template #default="{ row }">
            <span>{{ row.health?.totalRequests ?? row.totalRequests }}</span>
            <span :style="{ color: (row.health?.failedRequests ?? row.failedRequests) > 0 ? '#f53f3f' : 'inherit' }">
              / {{ row.health?.failedRequests ?? row.failedRequests }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'info'" effect="light" round>
              {{ row.status === 1 ? '启用' : '禁用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="230" fixed="right">
          <template #default="{ row }">
            <el-button size="small" text type="primary" :loading="row._testing" @click="test(row)">测试</el-button>
            <el-button
              v-if="row.health?.canRecover"
              size="small"
              text
              type="warning"
              :icon="RefreshRight"
              :loading="row._recovering"
              @click="recover(row)"
            >{{ recoverLabel(row) }}</el-button>
            <el-button size="small" text type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button size="small" text type="danger" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="暂无渠道，点击右上角新建" />
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

    <el-dialog v-model="visible" :title="editing ? '编辑渠道' : '新建渠道'" width="580px" destroy-on-close>
      <el-form :model="form" label-width="96px" label-position="right">
        <el-form-item label="名称" required>
          <el-input v-model="form.name" placeholder="渠道名称" />
        </el-form-item>
        <el-form-item label="类型">
          <el-select v-model="form.type" style="width: 100%">
            <el-option label="OpenAI 兼容" value="openai" />
            <el-option label="Anthropic" value="anthropic" />
          </el-select>
        </el-form-item>
        <el-form-item label="供应商账户">
          <el-select v-model="form.supplierAccountId" clearable filterable style="width: 100%" placeholder="选择供应商账户">
            <el-option
              v-for="account in supplierAccounts"
              :key="account.id"
              :label="`${account.supplierName} / ${account.name}`"
              :value="account.id"
            />
          </el-select>
          <div class="form-tip">用于标识渠道的上游账户范围，不改变现有密钥配置。</div>
        </el-form-item>
        <el-form-item label="Base URL" required>
          <el-input v-model="form.baseUrl" placeholder="https://api.minimaxi.com" />
        </el-form-item>
        <el-form-item label="原生协议" required>
          <el-checkbox-group v-model="form.protocols">
            <el-checkbox value="chat">Chat Completions</el-checkbox>
            <el-checkbox value="responses">Responses</el-checkbox>
            <el-checkbox value="anthropic">Anthropic Messages</el-checkbox>
          </el-checkbox-group>
          <div class="form-tip">仅勾选上游真实支持的协议；不同协议请求不会互相转换。</div>
        </el-form-item>
        <el-form-item label="密钥" required>
          <el-input
            v-model="form.keysText"
            type="textarea"
            :rows="3"
            :placeholder="editing ? '留空则不修改' : '一行一个 sk-...'"
          />
        </el-form-item>
        <el-form-item label="代理">
          <el-input v-model="form.proxy" placeholder="可选 http://proxy" />
        </el-form-item>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="默认优先级">
              <el-input-number v-model="form.priority" :min="0" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="权重">
              <el-input-number v-model="form.weight" :min="1" :max="1000" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="状态">
          <el-switch v-model="form.statusOn" active-text="启用" inactive-text="禁用" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" placeholder="可选" />
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
import { computed, ref, reactive, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, RefreshRight } from '@element-plus/icons-vue'
import api from '@/api'

const rows = ref<any[]>([])
const route = useRoute()
const router = useRouter()
const total = ref(0)
const loading = ref(false)
const page = ref(1)
const pageSize = ref(10)
const autoCircuitBreakerEnabled = ref<boolean | null>(null)
const releaseId = ref('')
const releaseSha256 = ref('')
const supplierAccounts = ref<any[]>([])
const supplierAccountFilter = ref<number | null>(
  Number.isInteger(Number(route.query.supplierAccountId)) && Number(route.query.supplierAccountId) > 0
    ? Number(route.query.supplierAccountId)
    : null,
)

const visible = ref(false)
const editing = ref(false)
const saving = ref(false)
const editingId = ref<number | null>(null)
const form = reactive({
  name: '', type: 'openai', baseUrl: '', keysText: '',
  supplierAccountId: null as number | null,
  protocols: ['chat'] as string[],
  proxy: '', priority: 0, weight: 1, statusOn: true, remark: '',
})

const circuitPolicyLabel = computed(() => {
  if (autoCircuitBreakerEnabled.value === true) return '已开启'
  if (autoCircuitBreakerEnabled.value === false) return '已关闭'
  return '未知'
})
const circuitPolicyTagType = computed<'success' | 'warning' | 'info'>(() => {
  if (autoCircuitBreakerEnabled.value === true) return 'warning'
  if (autoCircuitBreakerEnabled.value === false) return 'success'
  return 'info'
})
const circuitPolicyDetail = computed(() => {
  if (autoCircuitBreakerEnabled.value === true) {
    return '连续失败达到阈值后，渠道会被临时移出路由池。'
  }
  if (autoCircuitBreakerEnabled.value === false) {
    return '连续失败仅记录健康指标，不会自动将渠道移出路由池。'
  }
  return '无法读取网关当前的自动熔断策略。'
})
const releaseIdentityLabel = computed(() => {
  if (!releaseId.value) return '未知'
  return releaseSha256.value
    ? `${releaseId.value} · ${releaseSha256.value.slice(0, 12)}`
    : releaseId.value
})
const releaseIdentityDetail = computed(() => {
  if (!releaseId.value) return '无法读取当前网关的发布身份。'
  if (!releaseSha256.value) return `发布编号：${releaseId.value}；构建摘要未知。`
  return `发布编号：${releaseId.value}；构建摘要：${releaseSha256.value}`
})

function channelProtocols(row: any): string[] {
  return Array.isArray(row.protocols) && row.protocols.length
    ? row.protocols
    : [row.protocol || 'chat']
}

function protocolLabel(protocol: string) {
  if (protocol === 'responses') return 'Responses'
  if (protocol === 'anthropic') return 'Anthropic'
  return 'Chat'
}

const healthLabels: Record<string, string> = {
  healthy: '正常',
  degraded: '异常',
  circuit_open: '已熔断',
  disabled: '不可路由',
  credential_unreadable: '密钥异常',
}

function healthLabel(row: any) {
  if (
    row.health?.status === 'degraded'
    && autoCircuitBreakerEnabled.value === false
  ) {
    return '异常（仍路由）'
  }
  return healthLabels[String(row.health?.status)] || '未知'
}

function healthTagType(row: any) {
  if (row.health?.status === 'healthy') return 'success'
  if (row.health?.status === 'degraded' || row.health?.status === 'circuit_open') return 'warning'
  return 'danger'
}

function recoverLabel(row: any) {
  return row.health?.status === 'circuit_open' ? '恢复路由' : '清除异常'
}

function formatTime(value: unknown) {
  if (!value) return '暂无记录'
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? '暂无记录' : date.toLocaleString('zh-CN', { hour12: false })
}

function healthTime(row: any) {
  if (row.health?.lastSuccessAt) return `最近成功 ${formatTime(row.health.lastSuccessAt)}`
  if (row.health?.lastFailureAt) return `最近失败 ${formatTime(row.health.lastFailureAt)}`
  return '暂无请求记录'
}

function healthDetail(row: any) {
  const health = row.health
  if (!health) return '健康状态尚未加载'
  const details = [health.reason || healthLabel(row)]
  if (
    health.status === 'degraded'
    && autoCircuitBreakerEnabled.value === false
  ) {
    details.push('自动熔断已关闭，当前渠道仍参与路由')
  }
  if (health.disabledUntil) details.push(`熔断至 ${formatTime(health.disabledUntil)}`)
  if (health.lastFailureAt) details.push(`最近失败 ${formatTime(health.lastFailureAt)}`)
  if (health.lastSuccessAt) details.push(`最近成功 ${formatTime(health.lastSuccessAt)}`)
  return details.join('；')
}

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/admin/channels', {
      params: {
        page: page.value,
        pageSize: pageSize.value,
        supplierAccountId: supplierAccountFilter.value || undefined,
      },
    })
    rows.value = data.list
    total.value = data.total
  } finally {
    loading.value = false
  }
}

async function applySupplierFilter() {
  page.value = 1
  await router.replace({
    query: {
      ...route.query,
      supplierAccountId: supplierAccountFilter.value
        ? String(supplierAccountFilter.value)
        : undefined,
    },
  })
  load()
}

async function loadMetadata() {
  try {
    const { data } = await api.get('/admin/routing-metadata')
    supplierAccounts.value = data?.supplierAccounts || []
  } catch { /* metadata is optional for legacy channels */ }
}

async function loadCircuitPolicy() {
  try {
    const { data } = await api.get('/health/ready')
    const value = data?.policies?.autoCircuitBreakerEnabled
    autoCircuitBreakerEnabled.value = typeof value === 'boolean' ? value : null
    releaseId.value = typeof data?.releaseId === 'string' ? data.releaseId : ''
    releaseSha256.value = typeof data?.releaseSha256 === 'string' ? data.releaseSha256 : ''
  } catch {
    autoCircuitBreakerEnabled.value = null
    releaseId.value = ''
    releaseSha256.value = ''
  }
}

function resetForm() {
  Object.assign(form, {
    name: '', type: 'openai', baseUrl: '', keysText: '',
    supplierAccountId: supplierAccountFilter.value,
    protocols: ['chat'],
    proxy: '', priority: 0, weight: 1, statusOn: true, remark: '',
  })
}

function openCreate() {
  editing.value = false
  editingId.value = null
  resetForm()
  visible.value = true
}

function openEdit(row: any) {
  editing.value = true
  editingId.value = row.id
  Object.assign(form, {
    name: row.name, type: row.type, baseUrl: row.baseUrl, keysText: '',
    supplierAccountId: row.supplierAccountId || null,
    protocols: channelProtocols(row),
    proxy: row.proxy || '', priority: row.priority, weight: row.weight,
    statusOn: row.status === 1, remark: row.remark || '',
  })
  visible.value = true
}

async function save() {
  if (!form.name || !form.baseUrl || !form.protocols.length) {
    ElMessage.warning('请填写名称、Base URL 并至少选择一个原生协议')
    return
  }
  saving.value = true
  try {
    const payload: any = {
      name: form.name, type: form.type, baseUrl: form.baseUrl,
      supplierAccountId: form.supplierAccountId,
      protocols: [...form.protocols],
      proxy: form.proxy || undefined, priority: form.priority,
      weight: form.weight, status: form.statusOn ? 1 : 0,
      remark: form.remark || undefined,
    }
    if (form.keysText.trim()) payload.keysText = form.keysText
    if (editing.value) await api.put(`/admin/channels/${editingId.value}`, payload)
    else await api.post('/admin/channels', payload)
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
    await ElMessageBox.confirm(`确认删除渠道「${row.name}」？`, '删除确认', {
      type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消',
      confirmButtonClass: 'el-button--danger',
    })
  } catch { return }
  await api.delete(`/admin/channels/${row.id}`)
  ElMessage.success('已删除')
  load()
}

async function test(row: any) {
  row._testing = true
  try {
    const { data } = await api.post(`/admin/channels/${row.id}/test`)
    const detail = (data.results || [])
      .map((result: any) => `${protocolLabel(result.protocol)}: ${result.ok ? '正常' : result.error || `HTTP ${result.status}`}`)
      .join('；')
    if (data.ok) ElMessage.success(detail || `渠道「${row.name}」连通正常`)
    else ElMessage.error(`测试失败：${detail || data.error || '未知错误'}`)
  } catch (e: any) {
    ElMessage.error(e?.message || '测试失败')
  } finally {
    row._testing = false
  }
}

async function recover(row: any) {
  row._recovering = true
  const wasCircuitOpen = row.health?.status === 'circuit_open'
  try {
    const { data } = await api.post(`/admin/channels/${row.id}/recover`)
    row.health = data.health
    ElMessage.success(
      wasCircuitOpen
        ? `渠道「${row.name}」已恢复路由`
        : `渠道「${row.name}」的连续失败计数已清除`,
    )
    await load()
  } catch (e: any) {
    ElMessage.error(e?.message || '恢复失败')
  } finally {
    row._recovering = false
  }
}

onMounted(() => {
  load()
  loadMetadata()
  loadCircuitPolicy()
})
</script>

<style scoped>
.page-actions { display: flex; align-items: center; gap: 10px; }
.policy-tag { flex: 0 0 auto; }
.form-tip { width: 100%; margin-top: 4px; color: var(--ink-3); font-size: 12px; }
.health-cell { display: flex; min-width: 0; flex-direction: column; align-items: flex-start; gap: 4px; }
.health-meta { max-width: 100%; overflow: hidden; color: var(--ink-3); font-size: 12px; line-height: 1.3; text-overflow: ellipsis; white-space: nowrap; }
@media (max-width: 760px) {
  .page-actions { width: 100%; align-items: stretch; flex-direction: column; }
  .policy-tag { align-self: flex-start; }
  .page-actions :deep(.el-select) { width: 100% !important; }
}
</style>
