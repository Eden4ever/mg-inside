<template>
  <div class="page">
    <div class="page-head">
      <div>
        <el-button class="back-button" text :icon="ArrowLeft" @click="goBack">返回上一页</el-button>
        <h2>{{ pageTitle }}</h2>
        <p class="sub">{{ state.name || '供应商账户' }}的余额、连接状态和同步记录</p>
      </div>
      <div class="page-actions">
        <el-button :icon="Connection" @click="openChannels">关联渠道</el-button>
        <el-button
          type="primary"
          :icon="Refresh"
          :loading="syncing"
          :disabled="!state.configured"
          @click="sync"
        >
          立即同步
        </el-button>
      </div>
    </div>

    <el-alert
      v-if="state.lastErrorMessage"
      class="sync-alert"
      :title="state.lastErrorMessage"
      :type="state.lastSyncStatus === 'credential_invalid' ? 'error' : 'warning'"
      :closable="false"
      show-icon
    />

    <div class="stat-grid">
      <div class="stat-card">
        <div class="label">可用余额</div>
        <div class="num">{{ displayQuota(state.quotaAvailableRaw) }}</div>
        <div class="foot">{{ state.quotaDisplayType || 'CNY' }} · 最小单位 {{ formatNumber(state.quotaPerUnit) }}</div>
      </div>
      <div class="stat-card">
        <div class="label">连接状态</div>
        <div class="num" :class="statusClass">{{ statusLabel }}</div>
        <div class="foot">{{ lastSyncLabel }}</div>
      </div>
      <div class="stat-card">
        <div class="label">参与路由</div>
        <div class="num">{{ state.routingEnabled ? '已启用' : '已停用' }}</div>
        <div class="foot">在供应商列表中调整路由开关</div>
      </div>
      <div class="stat-card">
        <div class="label">自动同步</div>
        <div class="num">{{ state.enabled ? '已启用' : '已停用' }}</div>
        <div class="foot">每 {{ formatNumber(state.syncIntervalMinutes) }} 分钟</div>
      </div>
    </div>

    <el-row :gutter="16">
      <el-col :xs="24" :lg="10">
        <div class="page-card">
          <div class="panel-title">账户连接</div>
          <el-form :model="form" label-width="110px">
            <el-form-item label="服务地址">
              <el-input :model-value="state.baseUrl || '-'" disabled />
            </el-form-item>
            <el-form-item :label="credentialLabel">
              <el-input
                v-model="form.credential"
                type="password"
                show-password
                autocomplete="new-password"
                :placeholder="state.configured ? '已配置，留空保持不变' : `粘贴${credentialLabel}`"
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
            title="API Key 只在服务端加密保存，页面和接口不会返回原文。"
            type="info"
            :closable="false"
            show-icon
          />
        </div>
      </el-col>

      <el-col :xs="24" :lg="14">
        <div class="page-card summary-card">
          <div class="panel-title">账户摘要</div>
          <el-descriptions :column="2" border>
            <el-descriptions-item label="供应商">{{ state.supplier?.name || '-' }}</el-descriptions-item>
            <el-descriptions-item label="账户名称">{{ state.name || '-' }}</el-descriptions-item>
            <el-descriptions-item label="账户编码">{{ state.code || '-' }}</el-descriptions-item>
            <el-descriptions-item label="适配器">{{ state.adapter?.displayName || state.adapterCode || '-' }}</el-descriptions-item>
            <el-descriptions-item label="凭据状态">{{ state.configured ? '已配置' : '未配置' }}</el-descriptions-item>
            <el-descriptions-item label="余额状态">{{ state.billingPreference || '-' }}</el-descriptions-item>
            <el-descriptions-item label="最近尝试">{{ formatDate(state.lastAttemptAt) }}</el-descriptions-item>
            <el-descriptions-item label="最近成功">{{ formatDate(state.lastSyncAt) }}</el-descriptions-item>
          </el-descriptions>
        </div>
      </el-col>
    </el-row>

    <div class="page-card history-card">
      <div class="panel-title">余额快照</div>
      <el-table :data="historyRows" stripe>
        <el-table-column prop="capturedAt" label="采集时间" min-width="190" />
        <el-table-column prop="available" label="可用余额" min-width="140" />
        <el-table-column prop="used" label="已使用" min-width="120" />
        <el-table-column prop="requestCount" label="请求数" min-width="100" />
        <template #empty><el-empty description="暂无余额快照" /></template>
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

const route = useRoute()
const router = useRouter()
const saving = ref(false)
const syncing = ref(false)
const accountId = computed(() => Number(route.params.accountId))
const state = reactive<any>({
  configured: false,
  enabled: false,
  routingEnabled: false,
  syncIntervalMinutes: 10,
  lastSyncStatus: 'unconfigured',
  history: [],
  supplier: null,
})
const form = reactive({ credential: '', enabled: false, syncIntervalMinutes: 10 })

const statusLabels: Record<string, string> = {
  healthy: '正常',
  stale: '数据过期',
  credential_invalid: '凭据失效',
  unconfigured: '未配置',
}
const pageTitle = computed(() => `${state.supplier?.name || '供应商'}账户`)
const credentialLabel = computed(() => state.adapter?.credentialLabel || '账户凭据')
const statusLabel = computed(() => statusLabels[String(state.lastSyncStatus)] || '异常')
const statusClass = computed(() => state.lastSyncStatus === 'healthy' ? '' : 'danger')
const lastSyncLabel = computed(() => state.lastSyncAt ? `最近同步 ${formatDate(state.lastSyncAt)}` : '尚未同步')
const historyRows = computed(() => (state.history || []).map((row: any) => ({
  capturedAt: formatDate(row.capturedAt),
  available: displayQuota(row.quotaAvailableRaw),
  used: displayQuota(row.quotaUsedRaw),
  requestCount: formatNumber(row.requestCount),
})))

function formatNumber(value: unknown) {
  const num = Number(value)
  return Number.isFinite(num) ? num.toLocaleString('zh-CN') : '-'
}

function displayQuota(value: unknown) {
  if (value === null || value === undefined || value === '') return '-'
  const num = Number(value)
  const base = Number(state.quotaPerUnit) || 100
  return Number.isFinite(num) ? `${(num / base).toFixed(2)} ${state.quotaDisplayType || 'CNY'}` : '-'
}

function formatDate(value: unknown) {
  if (!value) return '-'
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('zh-CN', { hour12: false })
}

function apply(next: any) {
  Object.assign(state, next || {})
  Object.assign(form, {
    credential: '',
    enabled: Boolean(next?.enabled),
    syncIntervalMinutes: Number(next?.syncIntervalMinutes) || 10,
  })
}

function goBack() {
  const previousPath = window.history.state?.back
  if (typeof previousPath === 'string' && previousPath.startsWith('/admin/suppliers')) {
    router.back()
    return
  }
  router.push('/admin/suppliers')
}

function openChannels() {
  router.push({ name: 'admin-channels', query: { supplierAccountId: String(accountId.value) } })
}

async function load() {
  try {
    const { data } = await api.get(`/admin/supplier-accounts/${accountId.value}`)
    if (String(data?.supplier?.code) !== String(route.params.supplier)) {
      await router.replace('/admin/suppliers')
      return
    }
    apply(data)
  } catch (error: any) {
    ElMessage.error(error?.message || '加载供应商账户失败')
    await router.replace('/admin/suppliers')
  }
}

async function save() {
  saving.value = true
  try {
    const hasNewCredential = Boolean(form.credential.trim())
    const payload: any = {
      enabled: form.enabled,
      syncIntervalMinutes: form.syncIntervalMinutes,
    }
    if (hasNewCredential) payload.credential = form.credential.trim()
    const { data } = await api.put(`/admin/supplier-accounts/${accountId.value}/credential`, payload)
    apply(data)
    ElMessage.success(hasNewCredential ? '凭据已验证并保存' : '同步设置已保存')
  } catch (error: any) {
    ElMessage.error(error?.message || '保存供应商账户失败')
  } finally {
    saving.value = false
  }
}

async function sync() {
  syncing.value = true
  try {
    const { data } = await api.post(`/admin/supplier-accounts/${accountId.value}/sync`)
    apply(data)
    ElMessage.success('供应商账户已同步')
  } catch (error: any) {
    ElMessage.error(error?.message || '同步供应商账户失败')
    await load()
  } finally {
    syncing.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.back-button { margin: 0 0 8px -10px; padding-left: 8px; }
.page-actions { display: flex; align-items: center; gap: 10px; }
.sync-alert { margin-bottom: 16px; }
.panel-title { margin-bottom: 16px; font-size: 15px; font-weight: 600; }
.form-suffix { margin-left: 8px; color: var(--ink-3); font-size: 13px; }
.summary-card { min-height: 100%; }
.history-card { margin-top: 16px; }
.danger { color: #c2413a !important; }
@media (max-width: 1199px) {
  .summary-card { min-height: 0; margin-top: 16px; }
}
</style>
