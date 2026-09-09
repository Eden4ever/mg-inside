<template>
  <section class="code-example" :aria-label="title">
    <div class="code-example__bar">
      <div class="code-example__tabs" role="tablist" :aria-label="title">
        <button
          v-for="(snippet, index) in snippets"
          :id="tabId(index)"
          :key="snippet.label"
          class="code-example__tab"
          :class="{ 'is-active': active === snippet.label }"
          type="button"
          role="tab"
          :aria-controls="panelId(index)"
          :aria-selected="active === snippet.label"
          :tabindex="active === snippet.label ? 0 : -1"
          @click="active = snippet.label"
          @keydown="onTabKeydown($event, index)"
        >{{ snippet.label }}</button>
      </div>
      <el-button text size="small" :icon="CopyDocument" @click="copy">复制</el-button>
    </div>
    <pre
      v-if="current"
      :id="panelId(activeIndex)"
      role="tabpanel"
      :aria-labelledby="tabId(activeIndex)"
      tabindex="0"
    ><code>{{ current.code }}</code></pre>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { CopyDocument } from '@element-plus/icons-vue'

const props = defineProps<{ title: string; snippets: { label: string; code: string }[] }>()
const active = ref(props.snippets[0]?.label || '')
const current = computed(() => props.snippets.find((item) => item.label === active.value) || props.snippets[0])
const activeIndex = computed(() => Math.max(0, props.snippets.findIndex((item) => item.label === active.value)))
const instanceId = `code-example-${Math.random().toString(36).slice(2, 9)}`

function tabId(index: number) {
  return `${instanceId}-tab-${index}`
}

function panelId(index: number) {
  return `${instanceId}-panel-${index}`
}

function onTabKeydown(event: KeyboardEvent, index: number) {
  const lastIndex = props.snippets.length - 1
  let nextIndex: number | null = null
  if (event.key === 'ArrowRight') nextIndex = index === lastIndex ? 0 : index + 1
  if (event.key === 'ArrowLeft') nextIndex = index === 0 ? lastIndex : index - 1
  if (event.key === 'Home') nextIndex = 0
  if (event.key === 'End') nextIndex = lastIndex
  if (nextIndex === null) return
  event.preventDefault()
  active.value = props.snippets[nextIndex].label
  requestAnimationFrame(() => document.getElementById(tabId(nextIndex!))?.focus())
}

async function copy() {
  if (!current.value) return
  try {
    await navigator.clipboard.writeText(current.value.code)
    ElMessage.success('代码已复制')
  } catch {
    ElMessage.warning('复制失败，请手动复制')
  }
}
</script>

<style scoped>
.code-example { overflow: hidden; border: 1px solid #dfe3e8; border-radius: 8px; background: #171c24; }
.code-example__bar { display: flex; align-items: center; justify-content: space-between; min-height: 44px; padding: 0 10px 0 4px; border-bottom: 1px solid #2d3440; }
.code-example__tabs { display: flex; align-self: stretch; }
.code-example__tab { border: 0; border-bottom: 2px solid transparent; background: transparent; color: #aeb8c7; cursor: pointer; font-size: 13px; padding: 0 12px; }
.code-example__tab.is-active { border-bottom-color: #6aa7ff; color: #fff; }
pre { margin: 0; padding: 18px; overflow-x: auto; color: #dce8fb; font: 13px/1.7 Consolas, 'SFMono-Regular', monospace; white-space: pre; }
</style>
