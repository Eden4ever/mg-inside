<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h2>统计分析</h2>
        <p class="sub">全局请求量、成本与维度分布</p>
      </div>
      <div class="stats-period">
        <el-radio-group v-model="periodType" @change="load">
          <el-radio-button value="week">按周</el-radio-button>
          <el-radio-button value="month">按月</el-radio-button>
          <el-radio-button value="year">按年</el-radio-button>
          <el-radio-button value="custom">自定义</el-radio-button>
        </el-radio-group>
        <el-date-picker v-if="periodType === 'week'" v-model="selectedDate" type="date" placeholder="选择所在周" @change="load" />
        <el-date-picker v-else-if="periodType === 'month'" v-model="selectedDate" type="month" placeholder="选择月份" @change="load" />
        <el-date-picker v-else-if="periodType === 'year'" v-model="selectedDate" type="year" placeholder="选择年份" @change="load" />
        <el-date-picker v-else v-model="customRange" type="daterange" range-separator="至" start-placeholder="开始日期" end-placeholder="结束日期" @change="load" />
      </div>
    </div>

    <div class="stat-grid">
      <div class="stat-card">
        <div class="label">周期请求</div>
        <div class="num">{{ overview.period.requests }}</div>
      </div>
      <div class="stat-card">
        <div class="label">周期失败</div>
        <div class="num danger">{{ overview.period.fails }}</div>
      </div>
      <div class="stat-card">
        <div class="label">周期额度(元)</div>
        <div class="num">¥{{ Number(overview.period.quota || 0).toFixed(4) }}</div>
      </div>
      <div class="stat-card">
        <div class="label">周期成本</div>
        <div class="num">¥{{ Number(overview.period.cost || 0).toFixed(2) }}</div>
      </div>
    </div>

    <div class="page-card" style="margin-bottom: 16px">
      <div class="panel-title">请求趋势</div>
      <div class="trend" v-if="trend.length">
        <el-tooltip
          v-for="d in trend" :key="d.date" placement="top"
          :content="`${d.date} · ${d.requests} 次`"
        >
          <div class="bar-col">
            <div class="bar-track">
              <div class="bar" :style="{ height: barHeight(d.requests) + '%' }" />
            </div>
            <div class="bar-label">{{ (d.date || '').slice(5) }}</div>
          </div>
        </el-tooltip>
      </div>
      <el-empty v-else description="暂无趋势数据" :image-size="60" />
    </div>

    <el-row :gutter="16">
      <el-col :xs="24" :md="12">
        <div class="page-card">
          <div class="panel-title">按模型</div>
          <el-table :data="sortedByModel" :default-sort="sorts.model" size="default" style="width: 100%" @sort-change="onModelSort">
            <el-table-column prop="dimension" label="模型" sortable="custom" show-overflow-tooltip />
            <el-table-column prop="requests" label="请求" width="90" align="right" sortable="custom" />
            <el-table-column prop="quota" label="额度(元)" width="100" align="right" sortable="custom"><template #default="{ row }">¥{{ Number(row.quota || 0).toFixed(4) }}</template></el-table-column>
            <el-table-column prop="fails" label="失败" width="80" align="right" sortable="custom" />
          </el-table>
        </div>
      </el-col>
      <el-col :xs="24" :md="12">
        <div class="page-card">
          <div class="panel-title">按部门</div>
          <el-table :data="sortedByDept" :default-sort="sorts.department" size="default" style="width: 100%" @sort-change="onDepartmentSort">
            <el-table-column prop="dimension" label="部门" sortable="custom" show-overflow-tooltip />
            <el-table-column prop="requests" label="请求" width="90" align="right" sortable="custom" />
            <el-table-column prop="quota" label="额度(元)" width="100" align="right" sortable="custom"><template #default="{ row }">¥{{ Number(row.quota || 0).toFixed(4) }}</template></el-table-column>
            <el-table-column prop="fails" label="失败" width="80" align="right" sortable="custom" />
          </el-table>
        </div>
      </el-col>
    </el-row>

    <div class="page-card" style="margin-top: 16px">
      <div class="panel-title">按用户</div>
      <el-table :data="sortedByUser" :default-sort="sorts.user" style="width: 100%" @sort-change="onUserSort">
        <el-table-column prop="dimension" label="用户" sortable="custom" show-overflow-tooltip />
        <el-table-column prop="requests" label="请求" width="120" align="right" sortable="custom" />
        <el-table-column prop="quota" label="额度(元)" width="130" align="right" sortable="custom"><template #default="{ row }">¥{{ Number(row.quota || 0).toFixed(4) }}</template></el-table-column>
        <el-table-column prop="fails" label="失败" width="100" align="right" sortable="custom" />
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, reactive, onMounted } from 'vue'
import api from '@/api'

const overview = reactive({ period: { requests: 0, fails: 0, quota: 0, cost: 0 } })
const trend = ref<any[]>([])
const byModel = ref<any[]>([])
const byDept = ref<any[]>([])
const byUser = ref<any[]>([])
type PeriodType = 'week' | 'month' | 'year' | 'custom'
const periodType = ref<PeriodType>('month')
const selectedDate = ref(new Date())
const customRange = ref<Date[]>([])
type TableKey = 'model' | 'department' | 'user'
type SortProp = 'dimension' | 'requests' | 'quota' | 'fails'
type SortOrder = 'ascending' | 'descending' | null
type SortState = { prop: SortProp; order: SortOrder }
type SortChange = { prop: string | null; order: SortOrder }

const sorts = reactive<Record<TableKey, SortState>>({
  model: { prop: 'requests', order: 'descending' },
  department: { prop: 'requests', order: 'descending' },
  user: { prop: 'requests', order: 'descending' },
})

const sortedByModel = computed(() => sortRows(byModel.value, sorts.model))
const sortedByDept = computed(() => sortRows(byDept.value, sorts.department))
const sortedByUser = computed(() => sortRows(byUser.value, sorts.user))

function barHeight(v: number) {
  const m = Math.max(1, ...trend.value.map((t) => t.requests || 0))
  return Math.round((v / m) * 100) || 2
}

function onModelSort(sort: SortChange) {
  setSort('model', sort)
}

function onDepartmentSort(sort: SortChange) {
  setSort('department', sort)
}

function onUserSort(sort: SortChange) {
  setSort('user', sort)
}

function setSort(table: TableKey, sort: SortChange) {
  if (!sort.prop || !sort.order) {
    sorts[table] = { prop: 'requests', order: null }
    return
  }
  sorts[table] = { prop: sort.prop as SortProp, order: sort.order }
}

function sortRows(rows: any[], sort: SortState) {
  if (!sort.order) return rows
  const direction = sort.order === 'ascending' ? 1 : -1
  return [...rows].sort((a, b) => {
    if (sort.prop === 'dimension') {
      return String(a.dimension || '').localeCompare(String(b.dimension || ''), 'zh-CN') * direction
    }
    return (Number(a[sort.prop] || 0) - Number(b[sort.prop] || 0)) * direction
  })
}

function toDateKey(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function startOfWeek(value: Date) {
  const result = new Date(value.getFullYear(), value.getMonth(), value.getDate())
  const offset = result.getDay() === 0 ? 6 : result.getDay() - 1
  result.setDate(result.getDate() - offset)
  return result
}

function getRange() {
  const value = selectedDate.value || new Date()
  if (periodType.value === 'week') {
    const from = startOfWeek(value)
    const to = new Date(from)
    to.setDate(to.getDate() + 6)
    return { from: toDateKey(from), to: toDateKey(to) }
  }
  if (periodType.value === 'month') {
    const from = new Date(value.getFullYear(), value.getMonth(), 1)
    const to = new Date(value.getFullYear(), value.getMonth() + 1, 0)
    return { from: toDateKey(from), to: toDateKey(to) }
  }
  if (periodType.value === 'year') {
    return {
      from: `${value.getFullYear()}-01-01`,
      to: `${value.getFullYear()}-12-31`,
    }
  }
  if (customRange.value.length === 2 && customRange.value[0] && customRange.value[1]) {
    return { from: toDateKey(customRange.value[0]), to: toDateKey(customRange.value[1]) }
  }
  const today = new Date()
  return { from: toDateKey(today), to: toDateKey(today) }
}

async function load() {
  const range = getRange()
  const [ov, bm, bd, bu, tr] = await Promise.all([
    api.get('/admin/stats/overview', { params: range }),
    api.get('/admin/stats/by-model', { params: range }),
    api.get('/admin/stats/by-department', { params: range }),
    api.get('/admin/stats/by-user', { params: range }),
    api.get('/admin/stats/trend', { params: range }),
  ])
  overview.period = ov.data.period
  byModel.value = bm.data
  byDept.value = bd.data
  byUser.value = bu.data
  trend.value = tr.data
}

onMounted(load)
</script>

<style scoped>
.panel-title { font-size: 15px; font-weight: 600; margin-bottom: 14px; }
.stats-period { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.stats-period :deep(.el-radio-button__inner) { box-sizing: border-box; display: inline-flex; align-items: center; height: 32px; }
.trend {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  height: 180px;
  overflow-x: auto;
  padding-bottom: 4px;
}
.bar-col { display: flex; flex-direction: column; align-items: center; min-width: 30px; flex: 1; }
.bar-track {
  width: 100%;
  max-width: 34px;
  height: 140px;
  display: flex;
  align-items: flex-end;
  background: #f2f3f5;
  border-radius: 6px 6px 0 0;
  overflow: hidden;
}
.bar {
  width: 100%;
  background: linear-gradient(180deg, var(--brand), var(--brand-2));
  border-radius: 6px 6px 0 0;
  transition: height 0.3s ease;
}
.bar-label { font-size: 10px; color: var(--ink-3); margin-top: 6px; white-space: nowrap; }
@media (max-width: 640px) { .stats-period { width: 100%; } .stats-period :deep(.el-date-editor) { width: 100%; } }
</style>
