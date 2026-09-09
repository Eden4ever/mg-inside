<template>
  <section class="page-card quota-card" aria-label="本月额度">
    <div class="quota-heading">
      <div class="panel-title">本月额度</div>
      <p v-if="monthly.isUnlimited" class="quota-copy">管理员账号不受月度额度限制</p>
      <p v-else class="quota-copy">
        {{ monthly.period }} · 适用群组：{{ monthly.appliedGroups.join('、') || 'default' }}
      </p>
    </div>

    <div v-if="!monthly.isUnlimited" class="quota-value">
      <strong>¥{{ money(monthly.remaining) }}</strong>
      <span v-if="quotaTotal > 0">剩余 / ¥{{ money(quotaTotal) }}</span>
      <span v-else>未分配额度</span>
    </div>

    <template v-if="!monthly.isUnlimited && quotaTotal > 0">
      <div class="quota-progress-copy">
        <span>已用 ¥{{ money(monthly.used) }}</span>
        <strong>{{ quotaPercent }}%</strong>
      </div>
      <el-progress
        :percentage="quotaPercent"
        :stroke-width="8"
        :show-text="false"
        :status="quotaStatus"
      />
      <div class="quota-parts" aria-label="额度组成">
        <span>群组额度 ¥{{ money(monthly.groupQuota) }}</span>
        <span v-if="fixedQuota > 0">固定月包 +¥{{ money(fixedQuota) }}</span>
        <span v-if="temporaryQuota > 0">本月临时包 +¥{{ money(temporaryQuota) }}</span>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface MonthlyQuota {
  period: string
  quota: number | string | null
  used: number | string | null
  remaining: number | string | null
  groupQuota: number | string | null
  fixedQuota: number | string | null
  temporaryQuota: number | string | null
  appliedGroups: string[]
  isUnlimited: boolean
}

const props = defineProps<{ monthly: MonthlyQuota }>()

function numeric(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
}

function money(value: unknown) {
  return numeric(value).toFixed(2)
}

const quotaTotal = computed(() => numeric(props.monthly.quota))
const fixedQuota = computed(() => numeric(props.monthly.fixedQuota))
const temporaryQuota = computed(() => numeric(props.monthly.temporaryQuota))
const quotaPercent = computed(() => quotaTotal.value > 0
  ? Math.min(100, Math.round((numeric(props.monthly.used) / quotaTotal.value) * 100))
  : 0)
const quotaStatus = computed<'' | 'warning' | 'exception'>(() => {
  if (quotaPercent.value >= 100) return 'exception'
  if (quotaPercent.value >= 80) return 'warning'
  return ''
})
</script>

<style scoped>
.quota-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px 24px;
  align-items: center;
  margin-bottom: 16px;
}
.quota-copy { margin: 8px 0 0; color: var(--ink-2); line-height: 1.6; }
.quota-value { display: grid; gap: 4px; text-align: right; }
.quota-value strong { font-size: 24px; font-variant-numeric: tabular-nums; }
.quota-value span, .quota-progress-copy, .quota-parts { color: var(--ink-3); font-size: 12px; }
.quota-progress-copy { grid-column: 1 / -1; display: flex; justify-content: space-between; gap: 12px; font-variant-numeric: tabular-nums; }
.quota-progress-copy strong { color: var(--ink); }
.quota-card :deep(.el-progress), .quota-parts { grid-column: 1 / -1; }
.quota-parts { display: flex; flex-wrap: wrap; gap: 6px 16px; }
@media (max-width: 560px) {
  .quota-card { grid-template-columns: 1fr; }
  .quota-value { text-align: left; }
}
</style>
