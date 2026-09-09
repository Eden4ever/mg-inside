<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h2>调用日志</h2>
        <p class="sub">每一次 /v1 请求的详细记录，含调用人、令牌、来源 IP、token 用量与延迟</p>
      </div>
    </div>

    <div class="page-card filter-bar">
      <el-input v-model="filters.model" placeholder="模型" :prefix-icon="Search" clearable style="width: 180px" @keyup.enter="search" />
      <el-select v-model="filters.protocol" placeholder="协议" clearable style="width: 140px">
        <el-option label="Chat Completions" value="chat" />
        <el-option label="Responses" value="responses" />
        <el-option label="Anthropic" value="anthropic" />
      </el-select>
      <el-input v-model="filters.userId" placeholder="用户ID" clearable style="width: 120px" @keyup.enter="search" />
      <el-select v-model="filters.status" placeholder="状态" clearable style="width: 120px">
        <el-option label="成功" value="1" />
        <el-option label="失败" value="0" />
      </el-select>
      <el-button type="primary" :icon="Search" @click="search">查询</el-button>
      <el-button :icon="RefreshLeft" @click="reset">重置</el-button>
    </div>

    <div class="table-card">
      <el-table :data="rows" v-loading="loading" stripe style="width: 100%">
        <el-table-column prop="id" label="ID" width="70" />
        <el-table-column prop="model" label="模型" min-width="150" show-overflow-tooltip>
          <template #default="{ row }"><span style="font-weight:600">{{ row.model }}</span></template>
        </el-table-column>
        <el-table-column label="调用人" width="160" show-overflow-tooltip>
          <template #default="{ row }">
            <template v-if="row.caller">
              <div class="log-primary">{{ row.caller.displayName || row.caller.username }}</div>
              <div class="log-secondary">@{{ row.caller.username }} · 用户 ID {{ row.caller.id }}</div>
            </template>
            <span v-else>用户 #{{ row.userId || '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="协议" width="130">
          <template #default="{ row }">
            <el-tag effect="plain" :type="protocolTagType(row.protocol)">
              {{ protocolLabel(row.protocol) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="令牌" width="180" show-overflow-tooltip>
          <template #default="{ row }">
            <template v-if="row.token">
              <div class="log-primary">{{ row.token.name }}</div>
              <div class="log-secondary">{{ row.token.keyPrefix }}</div>
            </template>
            <span v-else>令牌 #{{ row.tokenId || '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="clientIp" label="IP" width="150" show-overflow-tooltip>
          <template #default="{ row }">{{ row.clientIp || '—' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'danger'" effect="light" round>
              {{ row.status === 1 ? '成功' : '失败' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="promptTokens" label="输入" width="90" align="right" />
        <el-table-column prop="cachedTokens" label="缓存命中" width="100" align="right">
          <template #default="{ row }">{{ Number(row.cachedTokens || 0).toLocaleString() }}</template>
        </el-table-column>
        <el-table-column prop="completionTokens" label="输出" width="90" align="right" />
        <el-table-column label="计价档" width="90" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.pricingTier === 'peak'" size="small" type="warning" effect="plain">高峰</el-tag>
            <el-tag v-else-if="row.pricingTier === 'off_peak'" size="small" type="success" effect="plain">低谷</el-tag>
            <span v-else class="tip">固定</span>
          </template>
        </el-table-column>
        <el-table-column label="额度(元)" width="110" align="right"><template #default="{ row }">¥{{ Number(row.quotaCost || 0).toFixed(6) }}</template></el-table-column>
        <el-table-column label="延迟" width="110" align="right">
          <template #default="{ row }">
            <span :style="{ color: row.latencyMs > 5000 ? '#f53f3f' : 'inherit' }">
              {{ row.latencyMs }} ms
            </span>
          </template>
        </el-table-column>
        <el-table-column label="首token" width="100" align="right">
          <template #default="{ row }">{{ row.firstTokenMs ? row.firstTokenMs + ' ms' : '—' }}</template>
        </el-table-column>
        <el-table-column prop="createdAt" label="时间" width="180">
          <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
        </el-table-column>
        <template #empty>
          <el-empty description="暂无日志" />
        </template>
      </el-table>
      <div class="table-pager">
        <el-pagination
          background
          layout="total, prev, pager, next, sizes"
          :total="total"
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :page-sizes="[10, 20, 50, 100]"
          @current-change="load"
          @size-change="load"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { Search, RefreshLeft } from '@element-plus/icons-vue'
import api from '@/api'

const rows = ref<any[]>([])
const total = ref(0)
const loading = ref(false)
const page = ref(1)
const pageSize = ref(20)
const filters = reactive({ model: '', protocol: '', userId: '', status: '' })

function formatTime(t: any) {
  if (!t) return '—'
  const d = new Date(t)
  return isNaN(d.getTime()) ? String(t) : d.toLocaleString('zh-CN')
}

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/admin/logs', {
      params: {
        page: page.value, pageSize: pageSize.value,
        model: filters.model || undefined,
        protocol: filters.protocol || undefined,
        userId: filters.userId || undefined,
        status: filters.status === '' ? undefined : filters.status,
      },
    })
    rows.value = data.list
    total.value = data.total
  } finally {
    loading.value = false
  }
}

function search() {
  page.value = 1
  load()
}
function reset() {
  filters.model = ''
  filters.protocol = ''
  filters.userId = ''
  filters.status = ''
  page.value = 1
  load()
}

function protocolLabel(protocol: string | undefined) {
  if (protocol === 'responses') return 'Responses'
  if (protocol === 'anthropic') return 'Anthropic'
  return 'Chat Completions'
}

function protocolTagType(protocol: string | undefined) {
  if (protocol === 'responses') return 'warning'
  if (protocol === 'anthropic') return 'success'
  return 'info'
}

onMounted(load)
</script>

<style scoped>
.filter-bar {
  display: flex;
  gap: 10px;
  margin-bottom: 14px;
  flex-wrap: wrap;
  align-items: center;
}

.log-primary { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.log-secondary { margin-top: 2px; color: var(--ink-3); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
