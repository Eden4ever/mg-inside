<template>
  <article class="doc-page">
    <nav class="doc-breadcrumb" aria-label="页面路径">文档 / 接入与支持 / 工具接入</nav>
    <h1>工具接入</h1>
    <p class="doc-lead">任何支持 OpenAI 兼容接口的工具都可以接入 Token One。通用配置是 Base URL、<code>sk-</code> 令牌和可用模型名。</p>
    <section id="workbuddy"><h2>WorkBuddy</h2><ol class="doc-list"><li>在“设置 → 自定义模型”中选择 OpenAI 兼容协议。</li><li>接口地址填写完整的 <code>{{ endpoint }}</code>。</li><li>填入自己的 <code>sk-</code> 令牌和模型名后保存。</li></ol><DocsCodeExample title="WorkBuddy 配置" :snippets="workbuddy" /></section>
    <section id="cursor"><h2>Cursor</h2><ol class="doc-list"><li>打开 Settings → Models。</li><li>在 OpenAI API Key 区域填写令牌。</li><li>Override OpenAI Base URL 填写 <code>{{ baseUrl }}</code>，并在模型列表启用目标模型。</li></ol></section>
    <section id="continue"><h2>Continue</h2><p>在 Continue 的模型配置中新增 OpenAI provider，使用下方字段：</p><DocsCodeExample title="Continue 配置" :snippets="continueSnippets" /></section>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import DocsCodeExample from './DocsCodeExample.vue'
const baseUrl = computed(() => `${location.origin}/v1`)
const endpoint = computed(() => `${baseUrl.value}/chat/completions`)
const workbuddy = computed(() => [{ label: 'models.json', code: JSON.stringify({ models: [{ id: 'your-model', name: 'your-model', vendor: 'TokenOne', url: endpoint.value, apiKey: 'sk-your-token' }] }, null, 2) }])
const continueSnippets = computed(() => [{ label: 'config.json', code: JSON.stringify({ title: 'Token One', provider: 'openai', model: 'your-model', apiBase: baseUrl.value, apiKey: 'sk-your-token' }, null, 2) }])
</script>
