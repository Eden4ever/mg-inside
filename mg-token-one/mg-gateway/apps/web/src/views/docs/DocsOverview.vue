<template>
  <article class="doc-page">
    <nav class="doc-breadcrumb" aria-label="页面路径">文档 / 快速开始 / 首次调用 API</nav>
    <h1>首次调用 API</h1>
    <p class="doc-lead">Token One 原生提供 Chat Completions、Responses 与 Anthropic Messages 三种协议。创建令牌后，按客户端协议设置网关地址、API Key 和模型名即可接入。</p>

    <section id="authentication">
      <h2>认证与地址</h2>
      <div class="doc-table-wrap"><table><colgroup><col style="width: 28%" /><col /></colgroup><thead><tr><th scope="col">参数</th><th scope="col">值</th></tr></thead><tbody><tr><th scope="row">Base URL</th><td><code>{{ baseUrl }}</code></td></tr><tr><th scope="row">API Key</th><td>在员工门户的“我的令牌”中创建，格式为 <code>sk-...</code></td></tr><tr><th scope="row">模型</th><td>使用“模型目录”中已启用的模型名</td></tr></tbody></table></div>
    </section>

    <section id="quick-request">
      <h2>发送首个请求</h2>
      <p>将下方的占位令牌和模型名替换为你的实际值。需要流式输出时，将 <code>stream</code> 设为 <code>true</code>。</p>
      <DocsCodeExample title="首次调用" :snippets="snippets" />
    </section>

    <section>
      <h2>下一步</h2>
      <ul class="doc-list"><li><router-link to="/docs/models">查看模型目录与能力</router-link></li><li><router-link to="/docs/chat-completions">阅读 Chat Completions 参数说明</router-link></li><li><router-link to="/docs/gpt6-astra">现已支持 GPT-6</router-link></li><li><router-link to="/docs/cc-switch-codex">配置 CC Switch 与 Codex</router-link></li><li><router-link to="/docs/claude-code">配置 Claude Code CLI / Desktop</router-link></li></ul>
    </section>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import DocsCodeExample from './DocsCodeExample.vue'

const baseUrl = computed(() => `${location.origin}/v1`)
const snippets = computed(() => [
  { label: 'curl', code: `curl ${baseUrl.value}/chat/completions \\
  -H "Authorization: Bearer sk-your-token" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"your-model","messages":[{"role":"user","content":"你好"}]}'` },
  { label: 'Python', code: `from openai import OpenAI\n\nclient = OpenAI(base_url="${baseUrl.value}", api_key="sk-your-token")\nresponse = client.chat.completions.create(\n    model="your-model",\n    messages=[{"role": "user", "content": "你好"}],\n)\nprint(response.choices[0].message.content)` },
  { label: 'Node.js', code: `import OpenAI from 'openai'\n\nconst client = new OpenAI({ baseURL: '${baseUrl.value}', apiKey: 'sk-your-token' })\nconst response = await client.chat.completions.create({\n  model: 'your-model',\n  messages: [{ role: 'user', content: '你好' }],\n})\nconsole.log(response.choices[0].message.content)` },
])
</script>
