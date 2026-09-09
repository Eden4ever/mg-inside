<template>
  <div class="page availability-page">
    <div class="page-head">
      <div>
        <h2>可用性告警</h2>
        <p class="sub">观察短窗口内的服务可用性、活跃告警和历史恢复情况</p>
      </div>
      <div class="page-actions">
        <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
        <el-button type="primary" :icon="RefreshRight" :loading="evaluating" @click="evaluateNow">
          立即评估
        </el-button>
      </div>
    </div>

    <div class="page-card availability-controls">
      <div class="window-control">
        <span class="control-label">统计窗口</span>
        <el-radio-group v-model="windowMinutes" @change="load">
          <el-radio-button v-for="window in windows" :key="window" :value="window">
            {{ window }} 分钟
          </el-radio-button>
        </el-radio-group>
      </div>
      <span v-if="lastLoadedAt" class="loaded-at">最近更新 {{ formatTime(lastLoadedAt) }}</span>
    </div>

    <el-alert v-if="error" class="load-error" type="error" :closable="false" show-icon>
      <template #title>
        <span>{{ error }}</span>
        <el-button link type="danger" @click="load">重试</el-button>
      </template>
    </el-alert>

    <div class="readonly-note">
      <el-icon><InfoFilled /></el-icon>
      <span>本页仅展示可用性与当前路由状态，不提供停用、熔断或恢复操作；监控告警不会修改渠道路由。</span>
    </div>

    <div class="stat-grid" v-loading="loading">
      <div class="stat-card">
        <div class="label">窗口请求</div>
        <div class="num">{{ formatNumber(summary.requests) }}</div>
        <div class="stat-detail">服务请求 {{ formatNumber(summary.serviceRequests) }}</div>
      </div>
      <div class="stat-card">
        <div class="label">服务成功率</div>
        <div class="num" :class="successRateClass(summary.serviceSuccessRate)">
          {{ formatPercent(summary.serviceSuccessRate) }}
        </div>
        <div class="stat-detail">成功 {{ formatNumber(summary.successes) }}</div>
      </div>
      <div class="stat-card">
        <div class="label">服务失败</div>
        <div class="num danger">{{ formatNumber(summary.serviceFailures) }}</div>
        <div class="stat-detail">总失败 {{ formatNumber(summary.failures) }}</div>
      </div>
      <div class="stat-card">
        <div class="label">活跃告警</div>
        <div class="num" :class="activeTotal > 0 ? 'danger' : 'success'">{{ formatNumber(activeTotal) }}</div>
        <div class="stat-detail">主动断开排除 {{ formatNumber(summary.excludedClientDisconnected) }}</div>
      </div>
    </div>

    <div class="page-card availability-panel">
      <div class="panel-head">
        <div>
          <div class="panel-title">窗口明细</div>
          <div class="panel-caption">按协议、模型、渠道和错误类型聚合，当前窗口 {{ windowMinutes }} 分钟</div>
        </div>
        <el-tag type="info" effect="plain">只读</el-tag>
      </div>
      <el-table :data="availabilityGroups" v-loading="loading" stripe class="responsive-table" style="width: 100%">
        <el-table-column label="协议" width="130">
          <template #default="{ row }">
            <el-tag size="small" effect="plain" :type="protocolTagType(row.protocol)">{{ protocolLabel(row.protocol) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="model" label="模型" min-width="170" show-overflow-tooltip>
          <template #default="{ row }"><strong>{{ row.model || '—' }}</strong></template>
        </el-table-column>
        <el-table-column label="渠道" min-width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ channelLabel(row.channelId) }}</template>
        </el-table-column>
        <el-table-column label="错误类型" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">{{ errorLabel(row.errorCode, row.responseStatus) }}</template>
        </el-table-column>
        <el-table-column label="成功率" width="110" align="right">
          <template #default="{ row }">{{ formatPercent(rowSuccessRate(row)) }}</template>
        </el-table-column>
        <el-table-column prop="requests" label="请求" width="90" align="right" />
        <el-table-column prop="successes" label="成功" width="90" align="right" />
        <el-table-column prop="failures" label="失败" width="90" align="right" />
        <template #empty><el-empty description="当前窗口暂无请求数据" :image-size="64" /></template>
      </el-table>
    </div>

    <div class="page-card availability-panel">
      <div class="panel-head">
        <div>
          <div class="panel-title">活跃告警</div>
          <div class="panel-caption">告警状态仅用于观察，不会摘除最后可用路由</div>
        </div>
        <el-tag :type="activeTotal > 0 ? 'warning' : 'success'" effect="light">
          {{ activeTotal > 0 ? `${activeTotal} 条活跃` : '当前无告警' }}
        </el-tag>
      </div>
      <el-table :data="activeAlerts" v-loading="activeLoading" stripe class="responsive-table" style="width: 100%">
        <el-table-column label="协议" width="130">
          <template #default="{ row }"><el-tag size="small" effect="plain" :type="protocolTagType(row.protocol)">{{ protocolLabel(row.protocol) }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="model" label="模型" min-width="170" show-overflow-tooltip />
        <el-table-column label="渠道" min-width="120"><template #default="{ row }">{{ channelLabel(row.channelId) }}</template></el-table-column>
        <el-table-column label="错误类型" min-width="160" show-overflow-tooltip><template #default="{ row }">{{ errorClassLabel(row.errorClass) }}</template></el-table-column>
        <el-table-column label="成功率" width="110" align="right"><template #default="{ row }">{{ formatPercent(activeAlertRate(row)) }}</template></el-table-column>
        <el-table-column label="触发时间" width="180"><template #default="{ row }">{{ formatTime(row.lastTriggeredAt) }}</template></el-table-column>
        <el-table-column label="恢复时间" width="180"><template #default="{ row }">{{ formatTime(row.lastRecoveredAt) }}</template></el-table-column>
        <el-table-column label="最近评估" width="180"><template #default="{ row }">{{ formatTime(row.lastEvaluatedAt) }}</template></el-table-column>
        <template #empty><el-empty description="当前无活跃告警" :image-size="64" /></template>
      </el-table>
      <div v-if="activeTotal > activePageSize" class="table-pager">
        <el-pagination
          v-model:current-page="activePage"
          :page-size="activePageSize"
          layout="total, prev, pager, next"
          :total="activeTotal"
          background
          @current-change="loadActiveAlerts"
        />
      </div>
    </div>

    <div class="page-card availability-panel">
      <div class="panel-head">
        <div>
          <div class="panel-title">事件历史</div>
          <div class="panel-caption">记录告警触发和恢复事件，以及对应窗口的服务成功率</div>
        </div>
        <span class="panel-meta">共 {{ formatNumber(eventTotal) }} 条</span>
      </div>
      <el-table :data="events" v-loading="eventsLoading" stripe class="responsive-table" style="width: 100%">
        <el-table-column label="事件" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="row.eventType === 'triggered' ? 'danger' : 'success'" effect="light">
              {{ row.eventType === 'triggered' ? '触发' : '恢复' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="协议" width="130"><template #default="{ row }"><el-tag size="small" effect="plain" :type="protocolTagType(row.protocol)">{{ protocolLabel(row.protocol) }}</el-tag></template></el-table-column>
        <el-table-column prop="model" label="模型" min-width="170" show-overflow-tooltip />
        <el-table-column label="渠道" min-width="120"><template #default="{ row }">{{ channelLabel(row.channelId) }}</template></el-table-column>
        <el-table-column label="错误类型" min-width="160" show-overflow-tooltip><template #default="{ row }">{{ errorClassLabel(row.errorClass) }}</template></el-table-column>
        <el-table-column label="成功率" width="110" align="right"><template #default="{ row }">{{ formatPercent(row.serviceSuccessRate) }}</template></el-table-column>
        <el-table-column label="匹配失败" width="100" align="right"><template #default="{ row }">{{ formatNumber(row.matchingFailures) }}</template></el-table-column>
        <el-table-column label="窗口结束" width="180"><template #default="{ row }">{{ formatTime(row.windowEndAt) }}</template></el-table-column>
        <el-table-column label="发生时间" width="180"><template #default="{ row }">{{ formatTime(row.occurredAt) }}</template></el-table-column>
        <template #empty><el-empty description="暂无告警事件" :image-size="64" /></template>
      </el-table>
      <div v-if="eventTotal > eventPageSize" class="table-pager">
        <el-pagination
          v-model:current-page="eventPage"
          :page-size="eventPageSize"
          layout="total, prev, pager, next"
          :total="eventTotal"
          background
          @current-change="loadEvents"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { InfoFilled, Refresh, RefreshRight } from '@element-plus/icons-vue'
import api from '@/api'

interface AvailabilitySummary {
  requests: number
  successes: number
  failures: number
  excludedClientDisconnected: number
  serviceRequests: number
  serviceFailures: number
  successRate: number | null
  serviceSuccessRate: number | null
}

interface AvailabilityGroup {
  protocol: string | null
  model: string | null
  channelId: number | null
  errorCode: string | null
  responseStatus: number | null
  requests: number
  successes: number
  failures: number
}

interface AlertState {
  id: number
  fingerprint: string
  protocol: string
  model: string
  channelId: number | null
  errorClass: string
  active: number
  lastEvaluatedAt: string | null
  lastTriggeredAt: string | null
  lastRecoveredAt: string | null
}

interface AlertEvent {
  id: number
  protocol: string
  model: string
  channelId: number | null
  errorClass: string
  eventType: 'triggered' | 'recovered'
  matchingFailures: number
  serviceSuccessRate: number | null
  windowEndAt: string | null
  occurredAt: string | null
}

const windows = [5, 15, 60]
const windowMinutes = ref(15)
const loading = ref(false)
const activeLoading = ref(false)
const eventsLoading = ref(false)
const evaluating = ref(false)
const error = ref('')
const lastLoadedAt = ref<string | null>(null)
const availabilityGroups = ref<AvailabilityGroup[]>([])
const availabilitySummary = ref<AvailabilitySummary>({
  requests: 0,
  successes: 0,
  failures: 0,
  excludedClientDisconnected: 0,
  serviceRequests: 0,
  serviceFailures: 0,
  successRate: null,
  serviceSuccessRate: null,
})
const activeAlerts = ref<AlertState[]>([])
const activeTotal = ref(0)
const activePage = ref(1)
const activePageSize = 20
const events = ref<AlertEvent[]>([])
const eventTotal = ref(0)
const eventPage = ref(1)
const eventPageSize = 20

const summary = computed(() => availabilitySummary.value)

function formatNumber(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number.toLocaleString('zh-CN') : '0'
}

function formatPercent(value: unknown) {
  const number = Number(value)
  return value === null || value === undefined || !Number.isFinite(number) ? '—' : `${number.toFixed(2)}%`
}

function formatTime(value: unknown) {
  if (!value) return '—'
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', { hour12: false })
}

function protocolLabel(protocol: unknown) {
  if (protocol === 'responses') return 'Responses'
  if (protocol === 'anthropic') return 'Anthropic'
  if (protocol === 'chat') return 'Chat Completions'
  return String(protocol || '未知协议')
}

function protocolTagType(protocol: unknown) {
  if (protocol === 'responses') return 'warning'
  if (protocol === 'anthropic') return 'success'
  return 'info'
}

function channelLabel(channelId: unknown) {
  if (channelId === null || channelId === undefined || channelId === '') return '全渠道'
  return `渠道 #${channelId}`
}

function errorClassLabel(errorClass: unknown) {
  if (errorClass === 'no_responses_channel') return '无原生 Responses 渠道'
  if (errorClass === 'service_5xx') return '服务端 5xx'
  return errorLabel(errorClass, null)
}

function errorLabel(errorCode: unknown, responseStatus: unknown) {
  if (errorCode === 'no_responses_channel') return '无原生 Responses 渠道'
  if (errorCode === 'client_disconnected') return '客户端主动断开'
  if (errorCode === 'upstream_error') return responseStatus ? `上游错误 HTTP ${responseStatus}` : '上游错误'
  if (errorCode) return String(errorCode)
  if (Number(responseStatus) >= 500 && Number(responseStatus) <= 599) return `服务端 5xx HTTP ${responseStatus}`
  return responseStatus ? `HTTP ${responseStatus}` : '无错误标记'
}

function rowSuccessRate(row: AvailabilityGroup) {
  return row.requests > 0 ? (row.successes / row.requests) * 100 : null
}

function aggregateRate(rows: AvailabilityGroup[]) {
  const requests = rows.reduce((sum, row) => sum + Number(row.requests || 0), 0)
  const successes = rows.reduce((sum, row) => sum + Number(row.successes || 0), 0)
  return requests > 0 ? (successes / requests) * 100 : null
}

function activeAlertRate(state: AlertState) {
  const matching = availabilityGroups.value.filter((row) => {
    if (row.protocol !== state.protocol || row.model !== state.model) return false
    if (state.errorClass === 'no_responses_channel') return row.errorCode === 'no_responses_channel'
    return row.channelId === state.channelId && Number(row.responseStatus) >= 500 && Number(row.responseStatus) <= 599
  })
  return aggregateRate(matching)
}

function successRateClass(value: unknown) {
  const number = Number(value)
  if (!Number.isFinite(number)) return ''
  if (number < 95) return 'danger'
  if (number < 99) return 'warning'
  return 'success'
}

function errorMessage(reason: unknown) {
  const message = (reason as any)?.response?.data?.message || (reason as any)?.message
  return typeof message === 'string' && message ? message : '可用性数据加载失败，请稍后重试'
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [availabilityResponse, statesResponse, eventsResponse] = await Promise.all([
      api.get('/admin/stats/availability', { params: { window: windowMinutes.value } }),
      api.get('/admin/availability-alerts/states', {
        params: { active: 'true', page: activePage.value, pageSize: activePageSize },
      }),
      api.get('/admin/availability-alerts/events', {
        params: { page: eventPage.value, pageSize: eventPageSize },
      }),
    ])
    const availability = availabilityResponse.data || {}
    availabilityGroups.value = Array.isArray(availability.groups) ? availability.groups : []
    availabilitySummary.value = { ...availabilitySummary.value, ...(availability.summary || {}) }
    activeAlerts.value = Array.isArray(statesResponse.data?.list) ? statesResponse.data.list : []
    activeTotal.value = Number(statesResponse.data?.total || 0)
    events.value = Array.isArray(eventsResponse.data?.list) ? eventsResponse.data.list : []
    eventTotal.value = Number(eventsResponse.data?.total || 0)
    lastLoadedAt.value = new Date().toISOString()
  } catch (reason) {
    error.value = errorMessage(reason)
  } finally {
    loading.value = false
  }
}

async function loadActiveAlerts() {
  activeLoading.value = true
  try {
    const { data } = await api.get('/admin/availability-alerts/states', {
      params: { active: 'true', page: activePage.value, pageSize: activePageSize },
    })
    activeAlerts.value = Array.isArray(data?.list) ? data.list : []
    activeTotal.value = Number(data?.total || 0)
  } catch (reason) {
    error.value = errorMessage(reason)
  } finally {
    activeLoading.value = false
  }
}

async function loadEvents() {
  eventsLoading.value = true
  try {
    const { data } = await api.get('/admin/availability-alerts/events', {
      params: { page: eventPage.value, pageSize: eventPageSize },
    })
    events.value = Array.isArray(data?.list) ? data.list : []
    eventTotal.value = Number(data?.total || 0)
  } catch (reason) {
    error.value = errorMessage(reason)
  } finally {
    eventsLoading.value = false
  }
}

async function evaluateNow() {
  evaluating.value = true
  error.value = ''
  try {
    const { data } = await api.post('/admin/availability-alerts/evaluate')
    ElMessage.success(`评估完成：活跃 ${formatNumber(data?.active)}，触发 ${formatNumber(data?.triggered)}，恢复 ${formatNumber(data?.recovered)}`)
    await load()
  } catch (reason) {
    error.value = errorMessage(reason)
    ElMessage.error(error.value)
  } finally {
    evaluating.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.page-actions { display: flex; align-items: center; gap: 10px; }
.availability-controls { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 14px; }
.window-control { display: flex; align-items: center; gap: 14px; min-width: 0; }
.control-label { flex: 0 0 auto; color: var(--ink-2); font-size: 13px; font-weight: 600; }
.loaded-at, .panel-caption, .panel-meta, .stat-detail { color: var(--ink-3); font-size: 12px; }
.loaded-at { flex: 0 0 auto; }
.load-error { margin-bottom: 14px; }
.load-error :deep(.el-alert__title) { display: flex; align-items: center; gap: 10px; }
.readonly-note { display: flex; align-items: flex-start; gap: 8px; margin: 0 0 16px; padding: 10px 12px; border: 1px solid #dbeafe; border-radius: 6px; background: #f5f9ff; color: #35577c; font-size: 12px; line-height: 1.6; }
.readonly-note .el-icon { flex: 0 0 auto; margin-top: 2px; }
.stat-card .num.success { color: #16805c; }
.stat-card .num.warning { color: #b7791f; }
.availability-panel { margin-bottom: 16px; overflow: hidden; }
.panel-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.panel-title { color: var(--ink); font-size: 15px; font-weight: 700; line-height: 1.4; }
.panel-caption { margin-top: 4px; line-height: 1.5; }
.panel-meta { flex: 0 0 auto; padding-top: 2px; }
.responsive-table { min-width: 1000px; }
.table-pager { display: flex; justify-content: flex-end; padding: 14px 4px 0; }
@media (max-width: 760px) {
  .page-actions { width: 100%; }
  .page-actions .el-button { flex: 1; }
  .availability-controls { align-items: flex-start; flex-direction: column; }
  .window-control { width: 100%; align-items: flex-start; flex-direction: column; gap: 8px; }
  .window-control :deep(.el-radio-group) { width: 100%; display: flex; }
  .window-control :deep(.el-radio-button) { flex: 1; }
  .window-control :deep(.el-radio-button__inner) { width: 100%; padding-right: 8px; padding-left: 8px; }
  .loaded-at { align-self: flex-end; }
  .availability-panel { overflow-x: auto; }
  .availability-panel :deep(.el-table) { min-width: 1000px; }
  .table-pager { justify-content: flex-start; min-width: 1000px; }
}
</style>
