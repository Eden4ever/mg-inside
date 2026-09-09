<script setup lang="ts">
import { computed, ref } from 'vue';

const props = defineProps<{ item: { title: string; sourceType?: string; sourceUrl?: string; excerpt?: string } }>();
const expanded = ref(false);
const sourceLink = computed(() => {
  try {
    const url = new URL(props.item.sourceUrl || '');
    return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined;
  } catch { return undefined; }
});
</script>

<template>
  <article class="evidence-content">
    <button class="evidence-summary" type="button" :aria-expanded="expanded" @click="expanded = !expanded">
      <span class="evidence-summary-text"><strong>{{ item.title }}</strong><span class="evidence-preview"> · {{ item.excerpt || '暂无内容摘录' }}</span></span>
      <span class="evidence-toggle">{{ expanded ? '收起' : '详情' }}</span>
    </button>
    <div v-if="expanded" class="evidence-details">
      <div class="evidence-content-heading"><strong>{{ item.title }}</strong><span v-if="item.sourceType">{{ item.sourceType }}</span></div>
      <p class="evidence-excerpt">{{ item.excerpt || '暂无内容摘录' }}</p>
      <slot name="actions" />
      <a v-if="sourceLink" :href="sourceLink" target="_blank" rel="noopener noreferrer">查看原文 / 附件</a>
    </div>
  </article>
</template>

<style scoped>
.evidence-content { background: #f8fafc; border-radius: 4px; min-width: 0; }
.evidence-summary { display: flex; align-items: center; gap: 12px; width: 100%; min-width: 0; padding: 8px 12px; border: 0; background: transparent; text-align: left; cursor: pointer; font: inherit; font-size: 13px; line-height: 22px; color: var(--el-text-color-primary); }
.evidence-summary-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.evidence-summary-text strong { font-weight: 500; }
.evidence-preview { color: var(--el-text-color-secondary); }
.evidence-toggle { flex-shrink: 0; color: var(--el-color-primary); }
.evidence-summary:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: -2px; }
.evidence-details { padding: 12px; border-top: 1px solid var(--el-border-color-lighter); }
.evidence-content-heading { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px; }
.evidence-content-heading strong { font-size: 13px; font-weight: 500; overflow-wrap: anywhere; }
.evidence-content-heading span { font-size: 12px; color: var(--el-text-color-secondary); }
.evidence-excerpt { margin: 8px 0; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.7; color: var(--el-text-color-regular); }
a { font-size: 13px; color: var(--el-color-primary); text-decoration: none; }
a:hover { text-decoration: underline; }
</style>
