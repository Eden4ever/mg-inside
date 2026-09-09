<template>
  <MgPage>
    <template #header><div class="page-head">
      <div>
        <h2>用户管理</h2>
        <p class="sub">管理系统用户、角色、分组及个人固定和临时额度包</p>
      </div>
      <a v-if="identityManaged" href="https://identity.meta-gravity.com/admin" target="_blank" rel="noopener">管理统一身份与应用授权</a>
      <el-button v-else type="primary" :icon="Plus" @click="openCreate">新建用户</el-button>
    </div></template>

    <div class="table-card">
      <el-table :data="rows" v-loading="loading" stripe style="width: 100%">
        <el-table-column prop="id" label="ID" width="64" />
        <el-table-column label="用户" min-width="170">
          <template #default="{ row }">
            <div style="display: flex; align-items: center; gap: 10px">
              <div class="u-avatar">{{ (row.displayName || row.username).slice(0,1).toUpperCase() }}</div>
              <div>
                <div style="font-weight: 600">{{ row.displayName || row.username }}</div>
                <div style="font-size: 12px; color: var(--ink-3)">@{{ row.username }}</div>
                <div class="mobile-quota">
                  <template v-if="row.isQuotaUnlimited">
                    <span class="mobile-quota-state">无限额</span>
                  </template>
                  <template v-else-if="quotaTotal(row) <= 0 && quotaUsed(row) <= 0">
                    <span class="mobile-quota-state">未分配额度</span>
                  </template>
                  <template v-else>
                    <div class="mobile-quota-meta">
                      <span>¥{{ money(quotaUsed(row)) }} / ¥{{ money(quotaTotal(row)) }}</span>
                      <strong>{{ quotaPercent(row) }}%</strong>
                    </div>
                    <el-progress
                      :percentage="quotaPercent(row)"
                      :stroke-width="5"
                      :show-text="false"
                      :status="quotaStatus(row)"
                    />
                  </template>
                </div>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="department" label="部门" width="130" show-overflow-tooltip>
          <template #default="{ row }">{{ row.department || '—' }}</template>
        </el-table-column>
        <el-table-column label="角色" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="row.role === 'admin' ? 'danger' : 'info'" effect="light" round>
              {{ row.role === 'admin' ? '管理员' : '普通用户' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="分组" min-width="140">
          <template #default="{ row }">
            <template v-if="row.groupNames && row.groupNames.length">
              <el-tag v-for="g in row.groupNames" :key="g" size="small" effect="plain" style="margin-right:4px">{{ g }}</el-tag>
            </template>
            <el-tag v-else size="small" effect="plain">default</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="本月额度使用" min-width="220">
          <template #default="{ row }">
            <div v-if="row.isQuotaUnlimited" class="quota-unlimited">
              <span>无限额</span>
              <small>管理员账号</small>
            </div>
            <div v-else-if="quotaTotal(row) <= 0 && quotaUsed(row) <= 0" class="quota-empty">
              <span>未分配额度</span>
              <small>{{ row.monthlyQuotaPeriod || '本月' }}</small>
            </div>
            <div v-else class="quota-usage">
              <div class="quota-meta">
                <span>¥{{ money(quotaUsed(row)) }} / ¥{{ money(quotaTotal(row)) }}</span>
                <strong>{{ quotaPercent(row) }}%</strong>
              </div>
              <el-progress
                :percentage="quotaPercent(row)"
                :stroke-width="7"
                :show-text="false"
                :status="quotaStatus(row)"
              />
              <small v-if="quotaTotal(row) <= 0">{{ quotaUsed(row) > 0 ? '已超出额度' : '当前额度已用完' }}</small>
              <small v-else>剩余 ¥{{ money(row.monthlyQuotaRemaining) }} · {{ quotaBreakdown(row) }}</small>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="来源" width="100" align="center">
          <template #default="{ row }">
            <el-tag size="small" effect="plain" :type="row.syncSource === 'wecom' ? 'success' : 'info'">
              {{ row.identitySubject ? '统一认证' : row.syncSource === 'wecom' ? '企微' : '待迁移' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'info'" effect="light" round>
              {{ row.status === 1 ? '启用' : '禁用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="190" fixed="right">
          <template #default="{ row }">
            <el-button size="small" text type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button size="small" text @click="openQuotaHistory(row)">额度记录</el-button>
            <el-button v-if="!identityManaged" size="small" text type="danger" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="暂无用户" />
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

    <el-dialog v-model="visible" :title="editing ? '编辑用户' : '新建用户'" width="min(540px, calc(100vw - 24px))" destroy-on-close>
      <el-form :model="form" label-width="96px">
        <el-form-item label="用户名" required>
          <el-input v-model="form.username" :disabled="editing" placeholder="登录用户名" />
        </el-form-item>
        <el-form-item label="显示名">
          <el-input v-model="form.displayName" :disabled="identityManaged" placeholder="展示名称" />
        </el-form-item>
        <el-form-item v-if="!identityManaged" :label="editing ? '重置密码' : '密码'" :required="!editing">
          <el-input
            v-model="form.password"
            type="password"
            show-password
            :placeholder="editing ? '留空则不修改' : '登录密码'"
          />
        </el-form-item>
        <el-form-item label="部门">
          <el-input v-model="form.department" :disabled="identityManaged" placeholder="可选" />
        </el-form-item>
        <el-form-item label="角色">
          <el-radio-group v-model="form.role">
            <el-radio value="user">普通用户</el-radio>
            <el-radio value="admin">管理员</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="分组">
          <el-select v-model="form.groupNames" multiple collapse-tags collapse-tags-tooltip style="width: 100%" placeholder="选择分组（可多选）">
            <el-option v-for="g in allGroups" :key="g.name" :label="g.name" :value="g.name" />
          </el-select>
          <div class="form-tip">用户可访问的模型 = 所属全部分组下模型的并集；留空默认 default</div>
        </el-form-item>
        <el-form-item label="固定月包">
          <el-input-number
            v-model="form.fixedMonthlyQuota"
            :min="0"
            :max="99999999.99"
            :precision="2"
            :step="10"
            controls-position="right"
            :disabled="form.role === 'admin'"
            style="width: 100%"
          />
          <div class="form-tip">{{ form.role === 'admin' ? '管理员账号不受额度限制。' : '每个自然月自动叠加到群组额度，单位为人民币元。' }}</div>
        </el-form-item>
        <el-form-item label="本月临时包">
          <el-input-number
            v-model="form.temporaryMonthlyQuota"
            :min="0"
            :max="99999999.99"
            :precision="2"
            :step="10"
            controls-position="right"
            :disabled="form.role === 'admin'"
            style="width: 100%"
          />
          <div class="form-tip">{{ form.role === 'admin' ? '管理员账号不受额度限制。' : `仅在 ${currentPeriod} 生效，下个自然月自动归零。` }}</div>
        </el-form-item>
        <el-form-item v-if="quotaChanged" label="调整原因" required>
          <el-input
            v-model="form.quotaAdjustmentReason"
            type="textarea"
            :rows="2"
            maxlength="255"
            show-word-limit
            placeholder="例如：项目临时扩容、岗位额度调整"
          />
          <div class="form-tip">额度变化将记录调整前后值、操作人和原因。</div>
        </el-form-item>
        <el-form-item label="状态">
          <el-switch v-model="form.statusOn" :disabled="identityManaged" active-text="启用" inactive-text="禁用" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <el-drawer
      v-model="historyVisible"
      title="额度调整记录"
      direction="rtl"
      size="min(760px, 100vw)"
      destroy-on-close
    >
      <div class="history-heading">
        <strong>{{ historyUser?.displayName || historyUser?.username }}</strong>
        <span>@{{ historyUser?.username }}</span>
      </div>
      <el-table :data="historyRows" v-loading="historyLoading" stripe style="width: 100%">
        <el-table-column label="调整时间" width="170">
          <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column prop="period" label="账期" width="90" />
        <el-table-column label="固定月包" min-width="160">
          <template #default="{ row }">{{ quotaChangeText(row.fixedQuotaBefore, row.fixedQuotaAfter) }}</template>
        </el-table-column>
        <el-table-column label="本月临时包" min-width="160">
          <template #default="{ row }">{{ quotaChangeText(row.temporaryQuotaBefore, row.temporaryQuotaAfter) }}</template>
        </el-table-column>
        <el-table-column prop="operatorUsername" label="操作人" width="120" />
        <el-table-column prop="reason" label="调整原因" min-width="180" show-overflow-tooltip />
        <template #empty><el-empty description="暂无额度调整记录" /></template>
      </el-table>
      <div class="history-pager">
        <el-pagination
          background
          layout="total, prev, pager, next"
          :total="historyTotal"
          v-model:current-page="historyPage"
          :page-size="20"
          @current-change="loadQuotaHistory"
        />
      </div>
    </el-drawer>
  </MgPage>
</template>

<script setup lang="ts">
import { computed, ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import api from '@/api'

interface UserRow {
  effectiveMonthlyQuota: number | string | null
  monthlyQuotaUsed: number | string | null
  monthlyQuotaRemaining: number | string | null
}

const rows = ref<any[]>([])
const total = ref(0)
const identityManaged = ref(true)
const loading = ref(false)
const page = ref(1)
const pageSize = ref(10)

const visible = ref(false)
const editing = ref(false)
const saving = ref(false)
const editingId = ref<number | null>(null)
const allGroups = ref<any[]>([])
const originalQuota = reactive({ fixed: 0, temporary: 0 })
const historyVisible = ref(false)
const historyLoading = ref(false)
const historyRows = ref<any[]>([])
const historyTotal = ref(0)
const historyPage = ref(1)
const historyUser = ref<any>(null)
const form = reactive({
  username: '', displayName: '', password: '', department: '',
  role: 'user', statusOn: true, groupNames: [] as string[],
  fixedMonthlyQuota: 0, temporaryMonthlyQuota: 0,
  quotaAdjustmentReason: '',
})

const currentPeriod = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit',
}).format(new Date()).slice(0, 7)
const quotaChanged = computed(() =>
  numeric(form.fixedMonthlyQuota) !== originalQuota.fixed
  || numeric(form.temporaryMonthlyQuota) !== originalQuota.temporary,
)

function numeric(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function money(value: unknown) {
  return numeric(value).toFixed(2)
}

function quotaTotal(row: UserRow) {
  return Math.max(0, numeric(row.effectiveMonthlyQuota))
}

function quotaUsed(row: UserRow) {
  return Math.max(0, numeric(row.monthlyQuotaUsed))
}

function quotaPercent(row: UserRow) {
  const total = quotaTotal(row)
  if (total <= 0) return quotaUsed(row) > 0 ? 100 : 0
  return Math.min(100, Math.round((quotaUsed(row) / total) * 100))
}

function quotaStatus(row: UserRow): '' | 'warning' | 'exception' {
  const percent = quotaPercent(row)
  if (percent >= 100) return 'exception'
  if (percent >= 80) return 'warning'
  return ''
}

function quotaBreakdown(row: any) {
  const parts = [`群组 ¥${money(row.groupMonthlyQuota)}`]
  if (numeric(row.fixedMonthlyQuota) > 0) parts.push(`固定 +¥${money(row.fixedMonthlyQuota)}`)
  if (numeric(row.temporaryMonthlyQuota) > 0) parts.push(`临时 +¥${money(row.temporaryMonthlyQuota)}`)
  return parts.join(' · ')
}

function quotaChangeText(before: unknown, after: unknown) {
  const previous = numeric(before)
  const next = numeric(after)
  return previous === next ? '未调整' : `¥${money(previous)} → ¥${money(next)}`
}

function formatTime(value: unknown) {
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN')
}

async function loadGroups() {
  try {
    const { data } = await api.get('/admin/groups')
    allGroups.value = data
  } catch { /* ignore */ }
}

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/admin/users', {
      params: { page: page.value, pageSize: pageSize.value },
    })
    rows.value = data.list
    total.value = data.total
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editing.value = false
  editingId.value = null
  Object.assign(form, {
    username: '', displayName: '', password: '', department: '',
    role: 'user', statusOn: true, groupNames: ['default'],
    fixedMonthlyQuota: 0, temporaryMonthlyQuota: 0,
    quotaAdjustmentReason: '',
  })
  Object.assign(originalQuota, { fixed: 0, temporary: 0 })
  visible.value = true
}

function openEdit(row: any) {
  editing.value = true
  editingId.value = row.id
  Object.assign(form, {
    username: row.username, displayName: row.displayName || '', password: '',
    department: row.department || '', role: row.role,
    statusOn: row.status === 1,
    groupNames: Array.isArray(row.groupNames) && row.groupNames.length ? row.groupNames : ['default'],
    fixedMonthlyQuota: numeric(row.fixedMonthlyQuota),
    temporaryMonthlyQuota: numeric(row.temporaryMonthlyQuota),
    quotaAdjustmentReason: '',
  })
  Object.assign(originalQuota, {
    fixed: numeric(row.fixedMonthlyQuota),
    temporary: numeric(row.temporaryMonthlyQuota),
  })
  visible.value = true
}

async function openQuotaHistory(row: any) {
  historyUser.value = row
  historyPage.value = 1
  historyVisible.value = true
  await loadQuotaHistory()
}

async function loadQuotaHistory() {
  if (!historyUser.value) return
  historyLoading.value = true
  try {
    const { data } = await api.get(`/admin/users/${historyUser.value.id}/quota-adjustments`, {
      params: { page: historyPage.value, pageSize: 20 },
    })
    historyRows.value = data.list || []
    historyTotal.value = data.total || 0
  } finally {
    historyLoading.value = false
  }
}

async function save() {
  if (!editing.value && !form.username) {
    ElMessage.warning('请填写用户名')
    return
  }
  if (!editing.value && !form.password) {
    ElMessage.warning('请填写密码')
    return
  }
  if (quotaChanged.value && form.quotaAdjustmentReason.trim().length < 2) {
    ElMessage.warning('请填写至少 2 个字符的额度调整原因')
    return
  }
  saving.value = true
  try {
    const payload: any = {
      displayName: form.displayName || undefined, department: form.department || undefined,
      role: form.role, status: form.statusOn ? 1 : 0,
      groupNames: form.groupNames && form.groupNames.length ? form.groupNames : ['default'],
      fixedMonthlyQuota: form.fixedMonthlyQuota,
      temporaryMonthlyQuota: form.temporaryMonthlyQuota,
      quotaAdjustmentReason: quotaChanged.value ? form.quotaAdjustmentReason.trim() : undefined,
    }
    if (identityManaged.value) { delete payload.displayName; delete payload.department; delete payload.status }
    if (!identityManaged.value && form.password) payload.password = form.password
    if (!editing.value) payload.username = form.username
    if (editing.value) await api.put(`/admin/users/${editingId.value}`, payload)
    else await api.post('/admin/users', payload)
    ElMessage.success('保存成功')
    visible.value = false
    await load()
  } catch (e: any) {
    ElMessage.error(e?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function remove(row: any) {
  try {
    await ElMessageBox.confirm(`确认删除用户「${row.username}」？`, '删除确认', {
      type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消',
      confirmButtonClass: 'el-button--danger',
    })
  } catch { return }
  await api.delete(`/admin/users/${row.id}`)
  ElMessage.success('已删除')
  load()
}

onMounted(async () => {
  try { const { data } = await api.get('/auth/sso/status'); identityManaged.value = data.enabled === true } catch {}
  load()
  loadGroups()
})
</script>

<style scoped>
.u-avatar {
  width: 34px; height: 34px; border-radius: 50%;
  background: linear-gradient(135deg, var(--brand), var(--brand-2));
  color: #fff; display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 600; flex-shrink: 0;
}
.form-tip { font-size: 12px; color: var(--ink-3); margin-top: 4px; }
.quota-usage { display: grid; gap: 6px; min-width: 180px; }
.quota-meta { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; color: var(--ink-2); font-size: 12px; font-variant-numeric: tabular-nums; }
.quota-meta strong { color: var(--ink); font-size: 12px; }
.quota-usage small, .quota-unlimited small, .quota-empty small { color: var(--ink-3); font-size: 11px; line-height: 1.4; }
.quota-unlimited, .quota-empty { display: grid; gap: 2px; }
.quota-unlimited span { color: #33734d; font-weight: 600; }
.quota-empty span { color: var(--ink-2); }
.history-heading { display: flex; align-items: baseline; gap: 8px; margin-bottom: 16px; }
.history-heading span { color: var(--ink-3); font-size: 12px; }
.history-pager { display: flex; justify-content: flex-end; padding-top: 16px; }
.mobile-quota { display: none; }
@media (max-width: 760px) {
  .mobile-quota { display: grid; gap: 4px; min-width: 116px; margin-top: 7px; }
  .mobile-quota-meta { display: flex; justify-content: space-between; gap: 8px; color: var(--ink-2); font-size: 10px; font-variant-numeric: tabular-nums; }
  .mobile-quota-meta strong { color: var(--ink); }
  .mobile-quota-state { color: var(--ink-2); font-size: 11px; }
}
</style>
