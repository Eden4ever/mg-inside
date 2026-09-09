<template>
  <div class="page">
    <div class="page-head">
      <div>
        <el-button class="back-button" text :icon="ArrowLeft" @click="goBack">返回上一页</el-button>
        <h2>CCTQ 账户</h2>
        <p class="sub">CCTQ 全局账户的额度、分组和模型状态</p>
      </div>
      <div class="page-actions">
        <el-button :icon="Connection" @click="openChannels">关联渠道</el-button>
        <el-button type="primary" :icon="Refresh" :loading="syncing" :disabled="!state.configured" @click="sync">
          立即同步
        </el-button>
      </div>
    </div>

    <el-alert
      v-if="hasOptionalSyncWarning"
      class="sync-alert"
      type="warning"
      :title="'附加信息同步不完整'"
      :description="optionalSyncWarningMessage"
      :closable="false"
      show-icon
    />

    <el-alert
      v-if="state.credentialType === 'api_key' && expiresStatus === 'expired'"
      class="expiry-alert"
      type="warning"
      :title="`API Key 已过期（${expiryDateLabel}）`"
      description="请在 CCTQ 侧更新凭据后重新同步。"
      :closable="false"
      show-icon
    />

    <div class="stat-grid">
      <div class="stat-card">
        <div class="label">可用额度</div>
        <div class="num" :class="{ unlimited: isUnlimitedQuota }">{{ quotaAvailableLabel }}</div>
        <div class="foot">{{ quotaAvailableFoot }}</div>
      </div>
      <div class="stat-card">
        <div class="label">已使用额度</div>
        <div class="num">{{ displayFiniteQuota(state.quotaUsedRaw) }}</div>
        <div class="foot">请求 {{ formatNumber(state.requestCount) }} 次</div>
      </div>
      <div v-if="state.credentialType !== 'api_key'" class="stat-card">
        <div class="label">最近 30 天消耗</div>
        <div class="num">{{ displayFiniteQuota(state.last30dQuotaRaw) }}</div>
        <div class="foot">RPM {{ formatNumber(state.rpm) }} / TPM {{ formatNumber(state.tpm) }}</div>
      </div>
      <div class="stat-card">
        <div class="label">连接状态</div>
        <div class="num" :class="statusClass">{{ statusLabel }}</div>
        <div class="foot">{{ lastSyncLabel }}</div>
      </div>
    </div>

    <el-row :gutter="16">
      <el-col :xs="24" :lg="10">
        <div class="page-card">
          <div class="panel-title">CCTQ 账户连接</div>
          <el-form :model="form" label-width="130px">
            <el-form-item label="服务地址">
              <el-input :model-value="state.baseUrl || 'https://www.cctq.ai'" disabled />
            </el-form-item>
            <el-form-item label="凭据类型">
              <el-radio-group v-model="form.credentialType">
                <el-radio-button value="dashboard">Dashboard Token</el-radio-button>
                <el-radio-button value="api_key">API Key</el-radio-button>
              </el-radio-group>
              <div class="form-tip">两种凭据权限不同，切换类型时必须输入对应的新凭据。</div>
            </el-form-item>
            <el-form-item :label="form.credentialType === 'api_key' ? 'API Key' : 'Dashboard Token'">
              <el-input
                v-model="form.credential"
                type="password"
                show-password
                autocomplete="new-password"
                :placeholder="state.configured && state.credentialType === form.credentialType ? '已配置，留空保持不变' : `粘贴 CCTQ ${form.credentialType === 'api_key' ? 'API Key' : 'Dashboard Access Token'}`"
              />
            </el-form-item>
            <el-form-item label="自动同步">
              <el-switch v-model="form.enabled" active-text="启用" inactive-text="停用" />
            </el-form-item>
            <el-form-item label="同步间隔">
              <el-input-number v-model="form.syncIntervalMinutes" :min="5" :max="1440" :step="5" />
              <span class="form-suffix">分钟</span>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="saving" @click="save">保存并验证</el-button>
              <el-button :disabled="saving" @click="load">重置</el-button>
            </el-form-item>
          </el-form>
          <el-alert
            title="Token 只在服务端加密保存，页面和接口不会返回原文。"
            type="info"
            :closable="false"
            show-icon
          />
        </div>
      </el-col>

      <el-col :xs="24" :lg="14">
        <div class="page-card">
          <div class="panel-title">账户摘要</div>
          <el-descriptions :column="2" border>
            <el-descriptions-item label="账户名称">{{ state.displayName || '-' }}</el-descriptions-item>
            <el-descriptions-item v-if="state.credentialType !== 'api_key'" label="账户分组">{{ state.accountGroup || '-' }}</el-descriptions-item>
            <el-descriptions-item v-if="state.credentialType !== 'api_key'" label="账户 ID">{{ state.upstreamAccountId || '-' }}</el-descriptions-item>
            <el-descriptions-item label="凭据模式">{{ state.credentialLabel || (state.credentialType === 'api_key' ? 'API Key' : 'Dashboard Token') }}</el-descriptions-item>
            <el-descriptions-item v-if="state.credentialType !== 'api_key'" label="订阅策略">{{ state.billingPreference || '无订阅' }}</el-descriptions-item>
            <el-descriptions-item label="额度单位">{{ state.quotaDisplayType || 'CNY' }}</el-descriptions-item>
            <el-descriptions-item label="换算基数">{{ formatNumber(state.quotaPerUnit) }}</el-descriptions-item>
            <el-descriptions-item v-if="state.credentialType === 'api_key'" label="有效期">
              <span class="inline-status">
                <el-tag :type="expiryTagType" effect="plain">{{ expiryLabel }}</el-tag>
                <span v-if="expiresStatus !== 'never'" class="status-detail">{{ expiryDateLabel }}</span>
              </span>
            </el-descriptions-item>
          </el-descriptions>
          <el-divider />
          <div v-if="state.credentialType !== 'api_key'" class="panel-title panel-title--small">可见分组</div>
          <div v-if="state.credentialType !== 'api_key'" class="tag-list">
            <el-tag v-for="group in state.groups" :key="group.name" effect="plain">
              {{ group.name }} · {{ group.ratio }}
            </el-tag>
            <span v-if="!state.groups?.length" class="empty-text">暂无分组数据</span>
          </div>
          <div class="panel-title panel-title--small">可见模型（{{ state.models?.length || 0 }}）</div>
          <div class="model-list">
            <el-tag v-for="model in state.models" :key="model" effect="plain" type="info">{{ model }}</el-tag>
            <span v-if="!state.models?.length" class="empty-text">暂无模型数据</span>
          </div>
        </div>
      </el-col>
    </el-row>

    <div v-if="state.credentialType === 'api_key'" class="page-card model-limits-card">
      <div class="section-heading">
        <div>
          <div class="panel-title">模型限制</div>
          <p class="section-caption">CCTQ API Key 的模型级额度限制，与账户可用额度独立展示。</p>
        </div>
        <div class="limit-state">
          <span class="limit-state__label">限制开关</span>
          <el-tag :type="state.modelLimitsEnabled ? 'success' : 'info'" effect="plain">
            {{ state.modelLimitsEnabled ? '已启用' : '未启用' }}
          </el-tag>
        </div>
      </div>
      <el-alert
        v-if="!state.modelLimitsEnabled"
        title="模型限制未启用"
        description="当前 API Key 不按模型应用单独限制。"
        type="info"
        :closable="false"
        show-icon
      />
      <el-alert
        v-else-if="!modelLimitRows.length"
        title="模型限制已启用，但暂无具体配置"
        description="CCTQ 尚未返回逐模型限制，当前不显示虚构的限制值。"
        type="info"
        :closable="false"
        show-icon
      />
      <el-table v-else class="model-limit-table" :data="modelLimitRows" stripe>
        <el-table-column prop="model" label="模型" min-width="220" />
        <el-table-column prop="limit" label="限制值" min-width="160">
          <template #default="scope">
            <span class="model-limit-value">{{ scope.row.limit }}</span>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div v-if="state.history?.length" class="page-card history-card">
      <div class="panel-title">额度快照</div>
      <el-table class="history-table" :data="historyRows" stripe>
        <el-table-column prop="capturedAt" label="采集时间" width="190" />
        <el-table-column prop="available" label="可用额度" />
        <el-table-column prop="used" label="已使用额度" />
        <el-table-column prop="last30d" label="近 30 天消耗" />
        <el-table-column prop="requestCount" label="请求数" />
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowLeft, Connection, Refresh } from '@element-plus/icons-vue'
import api from '@/api'

const saving = ref(false)
const syncing = ref(false)
const router = useRouter()
const route = useRoute()
const state = reactive<any>({
  configured: false,
  enabled: false,
  baseUrl: 'https://www.cctq.ai',
  syncIntervalMinutes: 10,
  lastSyncStatus: 'unconfigured',
  lastErrorCode: null,
  lastErrorMessage: null,
  unlimitedQuota: false,
  quotaAvailableDisplay: null,
  expiresAt: 0,
  expiresStatus: 'never',
  modelLimits: {},
  modelLimitsEnabled: false,
  history: [],
  groups: [],
  models: [],
})
const form = reactive({ credential: '', credentialType: 'dashboard' as 'dashboard' | 'api_key', enabled: false, syncIntervalMinutes: 10 })

const statusLabels: Record<string, string> = {
  healthy: '正常', stale: '数据过期', credential_invalid: '凭据失效', unconfigured: '未配置',
}
const statusLabel = computed(() => statusLabels[String(state.lastSyncStatus)] || '异常')
const statusClass = computed(() => state.lastSyncStatus === 'healthy' ? '' : 'danger')
const lastSyncLabel = computed(() => state.lastSyncAt ? `最近同步 ${formatDate(state.lastSyncAt)}` : '尚未同步')
const isUnlimitedQuota = computed(() => state.credentialType === 'api_key' && state.unlimitedQuota === true)
const quotaAvailableLabel = computed(() => (
  isUnlimitedQuota.value ? state.quotaAvailableDisplay || '无限额' : displayFiniteQuota(state.quotaAvailableRaw)
))
const quotaAvailableFoot = computed(() => (
  isUnlimitedQuota.value ? '当前 API Key 未设置账户额度上限' : `原始 quota ${formatNumber(state.quotaAvailableRaw)}`
))
const expiresStatus = computed(() => {
  if (state.expiresStatus === 'active' || state.expiresStatus === 'expired' || state.expiresStatus === 'never') {
    return state.expiresStatus
  }
  return Number(state.expiresAt) > 0 ? 'active' : 'never'
})
const expiryDateLabel = computed(() => formatUnixSeconds(state.expiresAt))
const expiryLabel = computed(() => {
  if (expiresStatus.value === 'never') return '永不过期'
  if (expiresStatus.value === 'expired') return '已过期'
  return '有效'
})
const expiryTagType = computed(() => {
  if (expiresStatus.value === 'expired') return 'warning'
  if (expiresStatus.value === 'active') return 'success'
  return 'info'
})
const hasOptionalSyncWarning = computed(() => state.lastErrorCode === 'optional_sync_failed')
const optionalSyncWarningMessage = computed(() => (
  state.lastErrorMessage || 'CCTQ 附加信息暂未完整同步，页面保留了上一次可用数据。'
))
const modelLimitRows = computed(() => Object.entries(state.modelLimits || {})
  .sort(([leftModel], [rightModel]) => (leftModel < rightModel ? -1 : leftModel > rightModel ? 1 : 0))
  .map(([model, limit]) => ({
    model,
    limit: formatModelLimit(limit),
  })))
const historyRows = computed(() => (state.history || []).map((row: any) => ({
  capturedAt: formatDate(row.capturedAt),
  available: displayFiniteQuota(row.quotaAvailableRaw),
  used: displayFiniteQuota(row.quotaUsedRaw),
  last30d: displayFiniteQuota(row.last30dQuotaRaw),
  requestCount: formatNumber(row.requestCount),
})))

function formatNumber(value: unknown) {
  const num = Number(value)
  return Number.isFinite(num) ? num.toLocaleString('zh-CN') : '-'
}

function displayFiniteQuota(value: unknown) {
  const num = Number(value)
  const base = Number(state.quotaPerUnit) || 500000
  return Number.isFinite(num) ? `${(num / base).toFixed(2)} ${state.quotaDisplayType || 'CNY'}` : '-'
}

function formatModelLimit(value: unknown) {
  if (value === null || value === undefined || value === '') return '未设置'
  if (typeof value === 'number') return Number.isFinite(value) ? value.toLocaleString('zh-CN') : '未设置'
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function formatDate(value: unknown) {
  if (!value) return '-'
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('zh-CN', { hour12: false })
}

function formatUnixSeconds(value: unknown) {
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds <= 0) return '-'
  return formatDate(new Date(seconds * 1000))
}

function apply(next: any) {
  Object.assign(state, next || {})
  Object.assign(form, {
    credential: '',
    credentialType: next?.credentialType === 'api_key' ? 'api_key' : 'dashboard',
    enabled: Boolean(next?.enabled),
    syncIntervalMinutes: Number(next?.syncIntervalMinutes) || 10,
  })
}

function goBack() {
  const previousPath = window.history.state?.back
  if (typeof previousPath === 'string' && /^\/admin\/suppliers\/?(?:[?#].*)?$/.test(previousPath)) {
    router.back()
    return
  }
  router.push('/admin/suppliers')
}

function openChannels() {
  if (state.id) {
    router.push({ name: 'admin-channels', query: { supplierAccountId: String(state.id) } })
    return
  }
  router.push({ name: 'admin-channels' })
}

async function load() {
  try {
    const { data } = await api.get('/admin/cctq-account')
    apply(data)
  } catch (error: any) {
    ElMessage.error(error?.message || '加载 CCTQ 账户失败')
  }
}

async function save() {
  saving.value = true
  try {
    const payload: any = {
      credentialType: form.credentialType,
      enabled: form.enabled,
      syncIntervalMinutes: form.syncIntervalMinutes,
    }
    if (form.credential.trim()) {
      if (form.credentialType === 'api_key') payload.apiKey = form.credential.trim()
      else payload.dashboardToken = form.credential.trim()
    }
    const { data } = await api.put('/admin/cctq-account', payload)
    apply(data)
    ElMessage.success('已保存并完成 CCTQ 验证')
  } catch (error: any) {
    ElMessage.error(error?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function sync() {
  syncing.value = true
  try {
    const { data } = await api.post('/admin/cctq-account/sync')
    apply(data)
    ElMessage.success('CCTQ 账户已同步')
  } catch (error: any) {
    ElMessage.error(error?.message || '同步失败')
  } finally {
    syncing.value = false
  }
}

onMounted(() => {
  if (route.params.supplier !== 'cctq') {
    router.replace('/admin/suppliers')
    return
  }
  load()
})
</script>

<style scoped>
.panel-title { margin-bottom: 16px; font-size: 15px; font-weight: 600; }
.back-button { margin: 0 0 8px -10px; padding-left: 8px; }
.page-actions { display: flex; align-items: center; gap: 10px; }
.panel-title--small { margin: 16px 0 10px; font-size: 13px; }
.form-suffix { margin-left: 8px; color: var(--ink-3); font-size: 13px; }
.tag-list, .model-list { display: flex; flex-wrap: wrap; gap: 8px; }
.model-list { max-height: 150px; overflow: auto; }
.empty-text { color: var(--ink-3); font-size: 13px; }
.sync-alert, .expiry-alert { margin-bottom: 16px; }
.section-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.section-caption { margin: -8px 0 0; color: var(--ink-3); font-size: 12px; line-height: 1.5; }
.limit-state { display: flex; align-items: center; flex: 0 0 auto; gap: 8px; }
.limit-state__label { color: var(--ink-2); font-size: 13px; }
.model-limits-card { margin-top: 16px; }
.model-limit-value { display: block; overflow-wrap: anywhere; white-space: normal; }
.inline-status { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 8px; max-width: 100%; }
.status-detail { color: var(--ink-2); overflow-wrap: anywhere; }
.history-card { margin-top: 16px; }
.danger { color: #c2413a !important; }
.unlimited { color: #176b45 !important; }
@media (max-width: 760px) {
  .page-actions { width: 100%; flex-wrap: wrap; }
  .page-actions .el-button { flex: 1 1 auto; min-width: 0; }
  .section-heading { flex-direction: column; gap: 10px; }
  .limit-state { width: 100%; justify-content: space-between; }
  .model-limit-table, .history-table { width: 100%; }
  .history-card { overflow-x: auto; }
}
</style>
