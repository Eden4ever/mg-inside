<template>
  <article class="doc-page">
    <nav class="doc-breadcrumb" aria-label="页面路径">文档 / 快速开始 / 模型目录</nav>
    <h1>模型目录</h1>
    <p class="doc-lead">模型名称由网关统一管理。下面的公开目录只展示已启用模型的能力元数据，不包含渠道、价格或上游模型信息。</p>
    <section id="model-catalog">
      <h2>可用模型</h2>
      <div v-if="loading" class="doc-state">正在读取模型目录…</div>
      <div v-else-if="error" class="doc-state doc-state--error" role="alert"><span>{{ error }}</span><el-button size="small" @click="load">重试</el-button></div>
      <div v-else-if="!models.length" class="doc-state">暂无公开模型</div>
      <div v-else class="model-catalog"><div v-for="model in models" :key="model.name" class="model-catalog__item"><div class="model-catalog__name"><code>{{ model.name }}</code><span v-if="model.supportsAnthropic" class="model-badge model-badge--anthropic">Anthropic</span><span v-if="model.supportsResponses" class="model-badge">Responses</span><span v-if="model.supportsReasoning" class="model-badge">推理</span><span v-if="model.supportsVision" class="model-badge">视觉</span><span v-if="model.supportsTools" class="model-badge">工具</span></div><dl><div><dt>上下文</dt><dd>{{ formatTokens(model.contextLength) }}</dd></div><div><dt>最大输出</dt><dd>{{ formatTokens(model.maxOutputTokens) }}</dd></div><div><dt>输入</dt><dd>{{ model.inputModalities.join(' / ') }}</dd></div><div><dt>输出</dt><dd>{{ model.outputModalities.join(' / ') }}</dd></div></dl></div></div>
    </section>
    <section id="availability">
      <h2>权限说明</h2>
      <p>公开目录反映网关的全局模型能力。员工实际能否调用某个模型，还取决于账号所属分组和令牌分组；调用被拒绝时会返回 <code>403</code>。</p>
      <p><router-link to="/docs/chat-completions">查看请求格式</router-link>，或登录员工门户创建自己的令牌。</p>
    </section>
  </article>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import api from '@/api'

interface PublicModel { name: string; contextLength: number; maxOutputTokens: number; supportsVision: boolean; supportsTools: boolean; supportsReasoning: boolean; supportsResponses: boolean; supportsAnthropic: boolean; inputModalities: string[]; outputModalities: string[] }
const models = ref<PublicModel[]>([])
const loading = ref(false)
const error = ref('')

function formatTokens(value: number) {
  if (!value) return '未标注'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(0)}M tokens`
  if (value >= 1000) return `${(value / 1000).toFixed(0)}K tokens`
  return `${value} tokens`
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const { data } = await api.get('/public/models')
    models.value = (data.list || []).map((item: PublicModel) => ({ ...item, inputModalities: item.inputModalities || ['text'], outputModalities: item.outputModalities || ['text'] }))
  } catch {
    error.value = '模型目录暂时不可用，请稍后重试。'
  } finally { loading.value = false }
}
onMounted(load)
</script>

<style scoped>
.model-catalog { display: grid; gap: 10px; }
.model-catalog__item { border: 1px solid #e1e6ec; border-radius: 8px; padding: 16px; }
.model-catalog__name { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; }
.model-catalog__name code { color: #1f2937; font-size: 15px; font-weight: 700; }
.model-badge { border: 1px solid #bfdbfe; border-radius: 4px; color: #1d5fbe; font-size: 11px; padding: 2px 6px; }
.model-badge--anthropic { border-color: #f1c99d; color: #9a4f13; }
.model-catalog dl { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 14px 0 0; }
.model-catalog dl div { display: grid; gap: 3px; }
.model-catalog dt { color: #8490a0; font-size: 12px; }
.model-catalog dd { margin: 0; color: #394554; font-size: 13px; }
@media (max-width: 640px) { .model-catalog dl { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
