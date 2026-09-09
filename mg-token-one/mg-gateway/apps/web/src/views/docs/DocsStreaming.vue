<template>
  <article class="doc-page">
    <nav class="doc-breadcrumb" aria-label="页面路径">文档 / API 指南 / 流式响应</nav>
    <h1>流式响应</h1>
    <p class="doc-lead">将 <code>stream</code> 设为 <code>true</code> 后，网关以 Server-Sent Events 逐段返回内容。反向代理需要关闭响应缓冲，客户端应持续读取到 <code>[DONE]</code>。</p>
    <section id="sse"><h2>SSE 响应</h2><DocsCodeExample title="流式调用" :snippets="snippets" /></section>
    <section id="usage"><h2>用量信息</h2><p>网关会在可获取时记录上游返回的 token 用量；当上游流未带用量时，系统可能按本地估算补充统计。流式连接中断后，已发送内容不会重放，请由客户端决定是否重试。</p><p>长请求应使用足够的读取超时，且不要在收到第一个数据块后关闭响应流。</p></section>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import DocsCodeExample from './DocsCodeExample.vue'
const endpoint = computed(() => `${location.origin}/v1/chat/completions`)
const snippets = computed(() => [
  { label: 'curl', code: `curl -N ${endpoint.value} \\
  -H "Authorization: Bearer sk-your-token" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"your-model","stream":true,"messages":[{"role":"user","content":"写一首短诗"}]}'` },
  { label: 'Python', code: `stream = client.chat.completions.create(\n    model="your-model",\n    stream=True,\n    messages=[{"role": "user", "content": "写一首短诗"}],\n)\nfor chunk in stream:\n    delta = chunk.choices[0].delta.content or ""\n    print(delta, end="", flush=True)` },
  { label: 'Node.js', code: `const stream = await client.chat.completions.create({\n  model: 'your-model',\n  stream: true,\n  messages: [{ role: 'user', content: '写一首短诗' }],\n})\nfor await (const chunk of stream) {\n  process.stdout.write(chunk.choices[0]?.delta?.content || '')\n}` },
])
</script>
