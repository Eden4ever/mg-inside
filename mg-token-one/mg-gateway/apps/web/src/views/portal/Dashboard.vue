<template>
  <MgPage>
    <template #header><PageHeading :title="'你好，' + (auth.user?.displayName || auth.user?.username)" description="从创建令牌到完成首次调用，都可以在这里完成。"><template #actions><el-button type="primary" :icon="Promotion" :disabled="!models.length" @click="go('playground')">开始调试</el-button></template></PageHeading></template>

    <el-alert v-if="error" type="error" :title="error" show-icon :closable="false" style="margin-bottom: 16px">
      <template #default><el-button link type="primary" @click="load">重新加载</el-button></template>
    </el-alert>

    <div class="stat-grid" v-loading="loading">
      <div class="stat-card"><div class="label">今日请求</div><div class="num">{{ my.today.requests }}</div></div>
      <div class="stat-card"><div class="label">今日消费</div><div class="num">¥{{ money(my.today.quota) }}</div></div>
      <div class="stat-card"><div class="label">启用令牌</div><div class="num">{{ activeTokenCount }}</div></div>
      <div class="stat-card"><div class="label">可用模型</div><div class="num">{{ models.length }}</div></div>
    </div>

    <MonthlyQuotaCard :monthly="my.monthly" v-loading="loading" />

    <ContentPanel title="开始使用" v-loading="loading">
      <template v-if="!tokens.length">
        <p class="hint">你还没有令牌。创建后仅会显示一次明文，请立即保存。</p>
        <el-button type="primary" :icon="Key" @click="go('my-usage')">新建令牌</el-button>
      </template>
      <template v-else-if="!models.length"><p class="hint">当前账号没有可调用模型，请联系管理员分配模型分组。</p></template>
      <template v-else>
        <el-steps :active="3" finish-status="success" simple class="steps"><el-step title="创建令牌" /><el-step title="选择模型" /><el-step title="发送请求" /></el-steps>
        <div class="code-head"><span>首次调用</span><el-button text type="primary" :icon="CopyDocument" @click="copySnippet">复制</el-button></div>
        <pre class="code-block">{{ snippet }}</pre>
        <div class="quick"><el-button :icon="Key" @click="go('my-usage')">令牌与用量</el-button><el-button type="primary" :icon="Promotion" @click="go('playground')">去调试</el-button></div>
      </template>
    </ContentPanel>
  </MgPage>
</template>

<script setup lang="ts">
import { PageHeading, ContentPanel } from '@mg-inside/frontend'
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { CopyDocument, Key, Promotion } from '@element-plus/icons-vue'
import { useAuthStore } from '@/store/auth'
import api from '@/api'
import MonthlyQuotaCard from '@/components/MonthlyQuotaCard.vue'

const auth = useAuthStore()
const router = useRouter()
const loading = ref(false)
const error = ref('')
const tokens = ref<any[]>([])
const models = ref<any[]>([])
const my = reactive({ today: { requests: 0, quota: 0 }, monthly: { period: '', quota: 0, used: 0, remaining: 0, groupQuota: 0, fixedQuota: 0, temporaryQuota: 0, appliedGroups: [] as string[], isUnlimited: false } })
const activeTokenCount = computed(() => tokens.value.filter((token) => token.status === 1).length)
const snippet = computed(() => `curl ${location.origin}/v1/chat/completions \\
  -H "Authorization: Bearer sk-你的令牌" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"${models.value[0]?.name || ''}","messages":[{"role":"user","content":"你好"}]}'`)
function money(value: unknown) { return Number(value || 0).toFixed(2) }
function go(name: string) { router.push(`/${name}`) }
async function copySnippet() { await navigator.clipboard?.writeText(snippet.value); ElMessage.success('调用示例已复制') }
async function load() {
  loading.value = true; error.value = ''
  try {
    const [stats, tokenResult, modelResult] = await Promise.all([api.get('/portal/stats/my'), api.get('/portal/tokens'), api.get('/portal/models')])
    my.today = stats.data.today; my.monthly = stats.data.monthly; tokens.value = tokenResult.data.list || []; models.value = modelResult.data.list || []
  } catch (e: any) { error.value = e?.message || '员工门户数据加载失败' } finally { loading.value = false }
}
onMounted(load)
</script>

<style scoped>
.panel-title { font-size: 15px; font-weight: 600; }.hint { margin: 8px 0 16px; color: var(--ink-2); line-height: 1.6; }.steps { margin: 4px 0 18px; }.code-head { display: flex; justify-content: space-between; align-items: center; font-size: 14px; font-weight: 600; }.code-block { margin: 0; white-space: pre-wrap; word-break: break-word; }.quick { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px; }
@media (max-width: 640px) {
  .steps :deep(.el-step__title) { min-width: 48px; flex: 0 0 auto; font-size: 12px; white-space: nowrap; }
  .steps :deep(.el-step__head) { padding-right: 4px; }
}
</style>
