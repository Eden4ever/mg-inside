<template>
  <article class="doc-page">
    <nav class="doc-breadcrumb" aria-label="页面路径">文档 / 接入与支持 / Claude Code</nav>
    <h1>Claude Code CLI / Desktop</h1>
    <p class="doc-lead">Claude Code 使用 Anthropic Messages 原生协议。Token One 会保留 system、tools、thinking、content blocks 与 SSE 事件，不转换成 Chat Completions 或 Responses。</p>

    <section id="endpoint">
      <h2>协议与地址</h2>
      <div class="doc-table-wrap"><table><colgroup><col style="width: 30%" /><col /></colgroup><thead><tr><th scope="col">项目</th><th scope="col">配置</th></tr></thead><tbody>
        <tr><th scope="row">协议</th><td>Anthropic Messages</td></tr>
        <tr><th scope="row">Base URL</th><td><code>{{ gatewayBase }}</code>（Claude Code 会自行追加 <code>/v1/messages</code>）</td></tr>
        <tr><th scope="row">API Key</th><td>Token One 员工门户生成的 <code>sk-...</code> 令牌</td></tr>
        <tr><th scope="row">模型</th><td>使用模型目录中已启用且标记为 Anthropic 的模型，例如 <code>claude-sonnet-4-6</code></td></tr>
      </tbody></table></div>
      <div class="compatibility-note" role="note"><strong>模型必须先由管理员启用。</strong><span>当前生产 CCTQ-Claude 模型已登记并标记为 Anthropic，但因供应商 Provider 配置未完成而保持停用；在模型目录显示为启用前，CLI/Desktop 请求会返回模型不可用错误。</span></div>
      <div class="compatibility-note" role="note"><strong>不要把 Base URL 填成 <code>{{ messagesEndpoint }}</code>。</strong><span>客户端会追加路径；只有直接用 curl/SDK 调接口时才填写完整的 <code>/v1/messages</code>。</span></div>
    </section>

    <section id="cli">
      <h2>Claude Code CLI</h2>
      <p>在启动 Claude Code 的同一个终端设置环境变量。PowerShell 示例：</p>
      <DocsCodeExample title="Windows PowerShell" :snippets="cliPowerShell" />
      <p>macOS / Linux 示例：</p>
      <DocsCodeExample title="Shell" :snippets="cliShell" />
      <ol class="doc-list"><li>将示例中的令牌替换为自己的 <code>sk-...</code>，不要提交到脚本或代码仓库。</li><li>模型名必须是 Token One 已启用并授权给当前令牌的模型。</li><li>启动后先发送一条短消息；遇到 <code>401</code> 检查令牌，遇到 <code>403</code> 检查分组权限，遇到 <code>529</code> 检查 Anthropic 渠道可用性。</li></ol>
    </section>

    <section id="desktop">
      <h2>Claude Code Desktop</h2>
      <p>如果桌面版本提供自定义 Provider / API Base URL 字段，使用与 CLI 相同的三项配置：根地址、<code>sk-...</code> 令牌和模型名。保存后重新启动桌面会话，使环境变量和 Provider 配置生效。Provider 类型必须是 Anthropic，不要选择 OpenAI 兼容模式。</p>
      <div class="compatibility-note" role="note"><strong>桌面版配置项因版本和发行渠道而异。</strong><span>标准 Claude Desktop（聊天应用）不一定开放自定义 API Base URL；不要把 MCP Server 配置文件当作 Anthropic API 配置。若界面没有 Provider/Base URL 入口，请使用 Claude Code CLI 或 CC Switch 的 Claude Code 配置，不要伪造 OpenAI 配置。</span></div>
    </section>

    <section id="request">
      <h2>直接验证 Messages</h2>
      <DocsCodeExample title="curl" :snippets="curlExample" />
      <p>请求头使用 <code>x-api-key</code> 与 <code>anthropic-version</code>。上游渠道密钥由 Token One 管理，网关不会把客户端令牌原样转发给上游。</p>
    </section>

    <section id="cc-switch">
      <h2>通过 CC Switch</h2>
      <ol class="doc-list"><li>新增 Claude Code Provider，而不是 OpenAI Provider。</li><li>API Base URL 填 <code>{{ gatewayBase }}</code>，API Key 填 Token One 令牌。</li><li>协议选择 Anthropic Messages；不要选择 Chat Completions 或 Responses。</li><li>模型选择目录中 <code>supportsAnthropic=true</code> 且已启用的模型。</li><li>保存后先用短消息测试，再启用自动切换。</li></ol>
    </section>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import DocsCodeExample from './DocsCodeExample.vue'

const gatewayBase = computed(() => location.origin)
const messagesEndpoint = computed(() => `${location.origin}/v1/messages`)
const cliPowerShell = computed(() => [{ label: 'PowerShell', code: `$env:ANTHROPIC_BASE_URL = "${gatewayBase.value}"\n$env:ANTHROPIC_API_KEY = "sk-your-token"\n$env:ANTHROPIC_MODEL = "claude-sonnet-4-6"\nclaude` }])
const cliShell = computed(() => [{ label: 'bash/zsh', code: `export ANTHROPIC_BASE_URL="${gatewayBase.value}"\nexport ANTHROPIC_API_KEY="sk-your-token"\nexport ANTHROPIC_MODEL="claude-sonnet-4-6"\nclaude` }])
const curlExample = computed(() => [{ label: 'curl', code: `curl ${messagesEndpoint.value} \\\n  -H "x-api-key: sk-your-token" \\\n  -H "anthropic-version: 2023-06-01" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"claude-sonnet-4-6","max_tokens":128,"messages":[{"role":"user","content":"你好"}]}'` }])
</script>

<style scoped>
.compatibility-note { display: grid; gap: 5px; border: 1px solid #f1cf9b; border-left: 3px solid #c97814; border-radius: 6px; background: #fff9ed; color: #5b3b09; padding: 14px 16px; }
.compatibility-note strong { font-size: 14px; }
</style>
