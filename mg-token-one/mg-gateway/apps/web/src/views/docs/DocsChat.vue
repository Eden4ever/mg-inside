<template>
  <article class="doc-page">
    <nav class="doc-breadcrumb" aria-label="页面路径">文档 / API 指南 / Chat Completions</nav>
    <h1>Chat Completions</h1>
    <p class="doc-lead">使用 <code>POST /v1/chat/completions</code> 发起对话。请求必须携带有效的 <code>sk-</code> 令牌，模型名必须存在且对当前令牌可见。</p>
    <section id="request"><h2>请求参数</h2><div class="doc-table-wrap"><table><colgroup><col style="width: 28%" /><col style="width: 14%" /><col /></colgroup><thead><tr><th scope="col">字段</th><th scope="col">必填</th><th scope="col">说明</th></tr></thead><tbody><tr><th scope="row"><code>model</code></th><td>是</td><td>统一模型名</td></tr><tr><th scope="row"><code>messages</code></th><td>是</td><td>OpenAI 格式消息数组</td></tr><tr><th scope="row"><code>stream</code></th><td>否</td><td>设为 <code>true</code> 时返回 SSE 数据流</td></tr><tr><th scope="row"><code>max_tokens</code></th><td>否</td><td>期望的最大输出 token 数</td></tr></tbody></table></div><DocsCodeExample title="Chat Completions 请求" :snippets="snippets" /></section>
    <section id="response"><h2>响应结构</h2><p>非流式调用会透传上游的 OpenAI 兼容响应。流式调用以 <code>data:</code> 行返回增量内容，并以 <code>[DONE]</code> 结束。</p><p>调用失败时，网关以 OpenAI 风格错误响应返回状态码和说明。详见 <router-link to="/docs/errors">错误排查</router-link>。</p></section>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import DocsCodeExample from './DocsCodeExample.vue'
const endpoint = computed(() => `${location.origin}/v1/chat/completions`)
const snippets = computed(() => [
  { label: 'curl', code: `curl ${endpoint.value} \\
  -H "Authorization: Bearer sk-your-token" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"your-model","messages":[{"role":"system","content":"你是一个专业助手"},{"role":"user","content":"介绍一下自己"}],"stream":false}'` },
  { label: 'Python', code: `response = client.chat.completions.create(\n    model="your-model",\n    messages=[\n        {"role": "system", "content": "你是一个专业助手"},\n        {"role": "user", "content": "介绍一下自己"},\n    ],\n)\nprint(response.choices[0].message.content)` },
  { label: 'Node.js', code: `const response = await client.chat.completions.create({\n  model: 'your-model',\n  messages: [\n    { role: 'system', content: '你是一个专业助手' },\n    { role: 'user', content: '介绍一下自己' },\n  ],\n})\nconsole.log(response.choices[0].message.content)` },
])
</script>
