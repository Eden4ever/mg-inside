<template>
  <article class="doc-page">
    <nav class="doc-breadcrumb" aria-label="页面路径">文档 / 接入与支持 / CC Switch 与 Codex</nav>
    <h1>CC Switch 与 Codex</h1>
    <p class="doc-lead">通过 CC Switch 或 Codex Desktop 将 Codex 接入 Token One 时，使用网关的 <code>/v1</code> 地址，并将上游格式设为原生 Responses。Responses 请求始终走独立的原生协议链路，不会转换为 Chat Completions。</p>

    <section id="compatibility">
      <h2>配置项</h2>
      <div class="doc-table-wrap">
        <table>
          <colgroup><col style="width: 34%" /><col /></colgroup>
          <thead><tr><th scope="col">项目</th><th scope="col">当前情况</th></tr></thead>
          <tbody>
            <tr><th scope="row">API 请求地址</th><td><code>{{ baseUrl }}</code></td></tr>
            <tr><th scope="row">默认模型</th><td><code>gpt-5.6-terra</code>。可按 CC Switch 的模型映射规则调整。</td></tr>
            <tr><th scope="row">上游格式</th><td>选择 <strong>Responses（原生）</strong>，不要选择 Chat Completions 或 Anthropic Messages。</td></tr>
            <tr><th scope="row">API Key</th><td>填写在 Token One 员工门户创建的 <code>sk-...</code> 令牌。</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section id="why">
      <h2>接入步骤</h2>
      <ol class="doc-list">
        <li>在 Token One 员工门户创建或确认一个可用令牌，并复制完整的 <code>sk-...</code> 值。</li>
        <li>在 CC Switch 中新建或编辑 Codex 提供商，将 API 请求地址填写为 <code>{{ baseUrl }}</code>。</li>
        <li>填写默认模型 <code>gpt-5.6-terra</code>，并在高级选项中将上游格式选为 <strong>Responses（原生）</strong>。</li>
        <li>保存后执行 CC Switch 的连通性测试，再启用该提供商。若设置了模型映射，默认模型使用映射列表的第一项。</li>
      </ol>
      <p>CC Switch 的字段名称可能随版本略有不同，按语义对应：<strong>Provider 类型选择 OpenAI/Codex</strong>，API Base URL 填网关根地址加 <code>/v1</code>，请求格式或 Endpoint 选择 <strong>Responses</strong>，鉴权方式使用 Bearer Token。</p>
      <DocsCodeExample title="Responses 直连验证（可选）" :snippets="responsesExample" />
    </section>

    <section id="next-steps">
      <h2>使用提示</h2>
      <div class="compatibility-note" role="note">
        <strong>Codex 地址只填写到 <code>/v1</code>。</strong>
        <span>CC Switch 会按已选的 Responses 模式补全请求路径。请勿在截图、日志或共享配置中泄露完整 <code>sk-</code> 令牌。</span>
      </div>
      <p>模型是否可用仍受 Token One 账号分组和令牌分组控制。遇到 <code>403</code> 时，请先检查该令牌是否有对应模型权限；其他状态码可参考 <router-link to="/docs/errors">错误排查</router-link>。</p>
      <p>CC Switch 的模型列表应来自 Token One 的 <code>GET /v1/models</code>；其中 <code>supportsResponses=true</code> 的模型才可用于 Codex 原生 Responses。生产环境已配置 <code>gpt-6-astra</code>，其上游为 CCTQ 的 Codex 渠道。不要把仅标记为 Chat 或 Anthropic 的模型映射到 Codex Provider。</p>
    </section>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import DocsCodeExample from './DocsCodeExample.vue'
const baseUrl = computed(() => `${location.origin}/v1`)
const responsesExample = computed(() => [{ label: 'curl', code: `curl ${baseUrl.value}/responses \\\n+  -H "Authorization: Bearer sk-your-token" \\\n+  -H "Content-Type: application/json" \\\n+  -d '{"model":"gpt-5.6-terra","input":"Reply with OK.","stream":false}'` }])
</script>

<style scoped>
.compatibility-note { display: grid; gap: 5px; border: 1px solid #f1cf9b; border-left: 3px solid #c97814; border-radius: 6px; background: #fff9ed; color: #5b3b09; padding: 14px 16px; }
.compatibility-note strong { font-size: 14px; }
</style>
