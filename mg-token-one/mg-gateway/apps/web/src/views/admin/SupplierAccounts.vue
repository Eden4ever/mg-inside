<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h2>供应商账户</h2>
        <p class="sub">统一查看各模型供应商的账户状态、额度和可见模型</p>
      </div>
      <el-button type="primary" :icon="Plus" @click="openCreate">新增账户</el-button>
    </div>

    <div class="table-card supplier-list-card">
      <el-table :data="rows" v-loading="loading" stripe style="width: 100%">
        <el-table-column label="供应商" min-width="180">
          <template #default="{ row }">
            <div class="supplier-name">
              <span class="supplier-mark">{{ row.shortName }}</span>
              <div>
                <strong>{{ row.name }}</strong>
                <span class="supplier-kind">{{ row.kind }}</span>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="账户" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ row.accountName || '未配置' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="110" align="center">
          <template #default="{ row }">
            <el-tag :type="row.statusType" effect="light" round>{{ row.statusLabel }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="参与路由" width="110" align="center">
          <template #default="{ row }">
            <el-switch
              v-model="row.routingEnabled"
              :loading="row._routing"
              :disabled="row._routing"
              :before-change="() => confirmRoutingChange(row)"
              :aria-label="`${row.accountName}参与路由`"
              @change="updateRouting(row, $event)"
            />
          </template>
        </el-table-column>
        <el-table-column label="可用额度" width="150" align="right">
          <template #default="{ row }">{{ row.quota }}</template>
        </el-table-column>
        <el-table-column prop="modelCount" label="可见模型" width="100" align="center" />
        <el-table-column prop="lastSync" label="最近同步" width="190" />
        <el-table-column label="操作" width="250" fixed="right" align="center">
          <template #default="{ row }">
            <el-button text type="primary" @click="openAccount(row)">
              {{ row.supportsDetail ? '查看详情' : '查看渠道' }}
            </el-button>
            <el-button v-if="row.supportsDetail" text type="primary" @click="openChannels(row)">查看渠道</el-button>
            <el-button v-if="row.adapterCode !== 'cctq' && row.adapterCode !== 'cctq-api-key'" text type="primary" @click="openEdit(row)">
              编辑
            </el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="暂无供应商账户" />
        </template>
      </el-table>
    </div>

    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑供应商账户' : '新增供应商账户'" width="520px" destroy-on-close>
      <el-form :model="form" label-width="96px">
        <el-form-item label="供应商" required>
          <el-select v-model="form.supplierId" :disabled="Boolean(editingId)" filterable style="width: 100%" placeholder="选择供应商" @change="onSupplierChange">
            <el-option
              v-for="supplier in selectableSuppliers"
              :key="supplier.id"
              :label="supplier.name"
              :value="Number(supplier.id)"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="账户类型" required>
          <el-select v-model="form.adapterCode" :disabled="Boolean(editingId)" style="width: 100%" placeholder="选择账户类型">
            <el-option
              v-for="adapter in compatibleAdapters"
              :key="adapter.code"
              :label="adapter.displayName"
              :value="adapter.code"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="账户编码" required>
          <el-input v-model="form.code" :disabled="Boolean(editingId)" placeholder="例如 deepseek-backup" />
        </el-form-item>
        <el-form-item label="账户名称" required>
          <el-input v-model="form.name" maxlength="100" show-word-limit placeholder="用于后台识别的账户名称" />
        </el-form-item>
        <el-form-item label="参与路由">
          <el-switch v-model="form.routingEnabled" active-text="启用" inactive-text="停用" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveAccount">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import api from '@/api'

const router = useRouter()
const loading = ref(false)
const rows = ref<any[]>([])
const suppliers = ref<any[]>([])
const adapters = ref<any[]>([])
const dialogVisible = ref(false)
const editingId = ref<number | null>(null)
const saving = ref(false)
const form = reactive({
  supplierId: null as number | null,
  adapterCode: 'manual',
  code: '',
  name: '',
  routingEnabled: true,
})
const selectableSuppliers = computed(() => suppliers.value.filter((supplier) =>
  supplier.code !== 'cctq' && Number(supplier.status) === 1,
))
const compatibleAdapters = computed(() => {
  const supplier = suppliers.value.find((item) => Number(item.id) === Number(form.supplierId))
  const managed = adapters.value.filter((adapter) =>
    adapter.supplierCode === supplier?.code &&
    adapter.capabilities?.configuration === true &&
    adapter.capabilities?.balanceSync === true,
  )
  return [
    { code: 'manual', displayName: '手动维护（不自动同步余额）' },
    ...managed,
  ]
})

const statusLabels: Record<string, string> = {
  healthy: '正常',
  stale: '数据过期',
  credential_invalid: '凭据失效',
  unconfigured: '未配置',
  manual: '手动维护',
  disabled: '已停用',
}

function displayQuota(state: any) {
  if (state?.quotaAvailableRaw === null || state?.quotaAvailableRaw === undefined || state?.quotaAvailableRaw === '') {
    return '-'
  }
  const num = Number(state?.quotaAvailableRaw)
  const base = Number(state?.quotaPerUnit) || 500000
  return Number.isFinite(num) ? `${(num / base).toFixed(2)} ${state?.quotaDisplayType || 'CNY'}` : '-'
}

function formatDate(value: unknown) {
  if (!value) return '-'
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('zh-CN', { hour12: false })
}

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/admin/supplier-accounts')
    rows.value = (data?.list || []).map((item: any) => ({
      id: Number(item.id),
      supplierCode: item.supplierCode,
      supplierId: Number(item.supplierId),
      code: item.code,
      adapterCode: item.adapterCode,
      supportsDetail: Boolean(item.supportsDetail),
      name: item.supplierName,
      shortName: String(item.supplierCode || '').slice(0, 2).toUpperCase(),
      kind: item.supplierKind === 'official' ? '官方供应商' : '第三方供应商',
      configuredName: item.name,
      accountName: item.accountName,
      routingEnabled: Boolean(item.routingEnabled),
      statusLabel: statusLabels[String(item.status)] || '异常',
      statusType: item.status === 'healthy' ? 'success' : item.status === 'unconfigured' ? 'info' : 'warning',
      quota: displayQuota(item),
      modelCount: Number(item.modelCount) || 0,
      lastSync: formatDate(item.lastSyncAt),
    }))
  } finally {
    loading.value = false
  }
}

async function loadMetadata() {
  const { data } = await api.get('/admin/routing-metadata')
  suppliers.value = data?.suppliers || []
  adapters.value = data?.supplierAccountAdapters || []
}

function onSupplierChange() {
  if (editingId.value) return
  const preferred = compatibleAdapters.value.find((adapter) => adapter.code !== 'manual')
  form.adapterCode = preferred?.code || 'manual'
}

function openAccount(row: any) {
  if (row.supportsDetail) {
    if (row.adapterCode === 'cctq' || row.adapterCode === 'cctq-api-key') {
      router.push({ name: 'admin-supplier-account-detail', params: { supplier: row.supplierCode } })
      return
    }
    router.push({
      name: 'admin-generic-supplier-account-detail',
      params: { supplier: row.supplierCode, accountId: String(row.id) },
    })
    return
  }
  router.push({ name: 'admin-channels', query: { supplierAccountId: String(row.id) } })
}

function openChannels(row: any) {
  router.push({ name: 'admin-channels', query: { supplierAccountId: String(row.id) } })
}

function resetForm() {
  Object.assign(form, {
    supplierId: null,
    adapterCode: 'manual',
    code: '',
    name: '',
    routingEnabled: true,
  })
}

function openCreate() {
  editingId.value = null
  resetForm()
  dialogVisible.value = true
}

function openEdit(row: any) {
  editingId.value = row.id
  Object.assign(form, {
    supplierId: row.supplierId,
    adapterCode: row.adapterCode,
    code: row.code,
    name: row.configuredName,
    routingEnabled: row.routingEnabled,
  })
  dialogVisible.value = true
}

async function saveAccount() {
  if (!form.supplierId || !form.adapterCode || !form.code.trim() || !form.name.trim()) {
    ElMessage.warning('请填写供应商、账户类型、账户编码和账户名称')
    return
  }
  saving.value = true
  try {
    if (editingId.value) {
      await api.put(`/admin/supplier-accounts/${editingId.value}`, {
        name: form.name.trim(),
        routingEnabled: form.routingEnabled,
      })
    } else {
      await api.post('/admin/supplier-accounts', {
        supplierId: form.supplierId,
        code: form.code.trim(),
        name: form.name.trim(),
        adapterCode: form.adapterCode,
        routingEnabled: form.routingEnabled,
      })
    }
    ElMessage.success(editingId.value ? '账户已更新' : '账户已创建')
    dialogVisible.value = false
    await load()
  } catch (error: any) {
    ElMessage.error(error?.message || '保存供应商账户失败')
  } finally {
    saving.value = false
  }
}

async function confirmRoutingChange(row: any) {
  if (!row.routingEnabled) return true
  try {
    await ElMessageBox.confirm(
      `停用后，账户「${row.accountName}」关联的渠道将立即退出路由池。`,
      '停用账户路由',
      { type: 'warning', confirmButtonText: '停用', cancelButtonText: '取消' },
    )
    return true
  } catch {
    return false
  }
}

async function updateRouting(row: any, value: string | number | boolean) {
  row._routing = true
  try {
    await api.put(`/admin/supplier-accounts/${row.id}`, {
      routingEnabled: Boolean(value),
    })
    ElMessage.success(Boolean(value) ? '账户已加入路由池' : '账户已退出路由池')
    await load()
  } catch (error: any) {
    row.routingEnabled = !Boolean(value)
    ElMessage.error(error?.message || '更新账户路由状态失败')
  } finally {
    row._routing = false
  }
}

onMounted(() => {
  load()
  loadMetadata()
})
</script>

<style scoped>
.supplier-list-card { overflow: hidden; }
.supplier-name { display: flex; align-items: center; gap: 10px; min-width: 0; }
.supplier-mark { display: grid; place-items: center; width: 34px; height: 34px; flex: 0 0 34px; border-radius: 8px; background: #e8f1ff; color: #1d4ed8; font-size: 12px; font-weight: 700; }
.supplier-name strong { display: block; color: var(--ink); font-size: 14px; }
.supplier-kind { display: block; margin-top: 3px; color: var(--ink-3); font-size: 12px; }
@media (max-width: 760px) {
  .supplier-list-card { overflow-x: auto; }
  .supplier-list-card :deep(.el-table) { min-width: 820px; }
}
</style>
