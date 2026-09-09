<template>
  <MgPage>
    <template #header><PageHeading title="令牌与用量" description="令牌用于访问网关；新建后的明文仅显示一次。"><template #actions><el-button type="primary" :icon="Plus" @click="openCreate">新建令牌</el-button></template></PageHeading></template>
    <el-alert v-if="error" type="error" :title="error" show-icon :closable="false" style="margin-bottom: 16px" />
    <MonthlyQuotaCard :monthly="my.monthly" v-loading="loading" />
    <div class="table-card" style="margin-bottom: 16px">
      <el-table :data="tokens" v-loading="loading" stripe style="width: 100%">
        <el-table-column prop="name" label="名称" min-width="150" show-overflow-tooltip />
        <el-table-column label="密钥前缀" width="150"><template #default="{ row }"><code class="prefix">sk-{{ row.keyPrefix }}…</code></template></el-table-column>
        <el-table-column prop="groupTag" label="授权分组" width="120"><template #default="{ row }"><el-tag v-if="row.groupTag" size="small" effect="plain">{{ row.groupTag }}</el-tag><span v-else class="muted">跟随账号</span></template></el-table-column>
        <el-table-column label="额度" width="150"><template #default><span class="muted">共享个人月度额度</span></template></el-table-column>
        <el-table-column label="状态" width="90" align="center"><template #default="{ row }"><el-tag :type="row.status === 1 ? 'success' : 'info'" effect="light">{{ row.status === 1 ? '启用' : '禁用' }}</el-tag></template></el-table-column>
        <el-table-column prop="createdAt" label="创建时间" width="180"><template #default="{ row }">{{ formatTime(row.createdAt) }}</template></el-table-column>
        <el-table-column label="操作" width="100" fixed="right"><template #default="{ row }"><el-button size="small" text type="danger" @click="remove(row)">删除</el-button></template></el-table-column>
        <template #empty><el-empty description="还没有令牌，创建后即可在调试页发起首次调用。" /></template>
      </el-table>
    </div>
    <div class="stat-grid" v-loading="loading"><div class="stat-card"><div class="label">今日请求</div><div class="num">{{ my.today.requests }}</div></div><div class="stat-card"><div class="label">输入 Token</div><div class="num">{{ my.today.prompt }}</div></div><div class="stat-card"><div class="label">输出 Token</div><div class="num">{{ my.today.completion }}</div></div><div class="stat-card"><div class="label">今日消费</div><div class="num">¥{{ money(my.today.quota) }}</div></div></div>
    <el-dialog v-model="visible" title="新建令牌" width="440px" destroy-on-close><el-form :model="form" label-width="80px"><el-form-item label="名称" required><el-input v-model="form.name" placeholder="例如：本地开发" /></el-form-item></el-form><template #footer><el-button @click="visible = false">取消</el-button><el-button type="primary" :loading="saving" @click="save">创建</el-button></template></el-dialog>
    <el-dialog v-model="keyVisible" title="令牌已生成" width="540px" :close-on-click-modal="false"><el-alert type="warning" :closable="false" show-icon title="请立即复制保存，关闭后无法再次查看明文。" /><div class="key-box">{{ createdKey }}</div><template #footer><el-button type="primary" :icon="CopyDocument" @click="copyKey">复制</el-button><el-button @click="keyVisible = false">关闭</el-button></template></el-dialog>
  </MgPage>
</template>

<script setup lang="ts">
import { PageHeading } from '@mg-inside/frontend'
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { CopyDocument, Plus } from '@element-plus/icons-vue'
import api from '@/api'
import MonthlyQuotaCard from '@/components/MonthlyQuotaCard.vue'
const tokens = ref<any[]>([]); const loading = ref(false); const saving = ref(false); const visible = ref(false); const keyVisible = ref(false); const createdKey = ref(''); const error = ref('')
const form = reactive({ name: '' })
const my = reactive({ today: { requests: 0, quota: 0, prompt: 0, completion: 0 }, monthly: { period: '', quota: 0, used: 0, remaining: 0, groupQuota: 0, fixedQuota: 0, temporaryQuota: 0, appliedGroups: [] as string[], isUnlimited: false } })
function money(value: unknown) { return Number(value || 0).toFixed(2) }
function formatTime(value: unknown) { const date = new Date(String(value)); return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN') }
async function load() { loading.value = true; error.value = ''; try { const [tokenResult, stats] = await Promise.all([api.get('/portal/tokens'), api.get('/portal/stats/my')]); tokens.value = tokenResult.data.list || []; my.today = stats.data.today; my.monthly = stats.data.monthly } catch (e: any) { error.value = e?.message || '令牌与用量加载失败' } finally { loading.value = false } }
function openCreate() { form.name = ''; visible.value = true }
async function save() { if (!form.name.trim()) { ElMessage.warning('请填写令牌名称'); return } saving.value = true; try { const { data } = await api.post('/portal/tokens', { name: form.name.trim() }); createdKey.value = data.key; visible.value = false; keyVisible.value = true; await load() } catch (e: any) { ElMessage.error(e?.message || '创建失败') } finally { saving.value = false } }
async function remove(row: any) { try { await ElMessageBox.confirm(`确认删除令牌「${row.name}」？`, '删除确认', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消', confirmButtonClass: 'el-button--danger' }); await api.delete(`/portal/tokens/${row.id}`); ElMessage.success('已删除'); await load() } catch (e: any) { if (e !== 'cancel' && e !== 'close') ElMessage.error(e?.message || '删除失败') } }
async function copyKey() { await navigator.clipboard?.writeText(createdKey.value); ElMessage.success('令牌已复制') }
onMounted(load)
</script>

<style scoped>
.muted { color: var(--ink-3); }.prefix { background: #f2f3f5; padding: 2px 6px; border-radius: 4px; font-size: 12px; }
</style>
