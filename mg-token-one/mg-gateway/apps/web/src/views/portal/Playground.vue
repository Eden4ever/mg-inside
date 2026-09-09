<template>
  <div class="page">
    <div class="page-head"><div><h2>API 调试</h2><p class="sub">使用临时粘贴的 sk- 令牌完成一次 Chat Completions 流式调用。</p></div></div>
    <el-alert v-if="loadError" type="error" :title="loadError" show-icon :closable="false" style="margin-bottom: 16px"><template #default><el-button link type="primary" @click="load">重新加载</el-button></template></el-alert>
    <el-alert v-else-if="!loadingModels && !models.length" type="warning" title="当前账号没有可调用模型，请联系管理员分配模型分组。" show-icon :closable="false" style="margin-bottom: 16px" />
    <MonthlyQuotaCard v-if="!loadError" :monthly="monthly" v-loading="loadingModels" />
    <div class="page-card">
      <el-form label-position="top">
        <el-row :gutter="14"><el-col :xs="24" :md="10"><el-form-item label="sk- 令牌"><el-input v-model="token" placeholder="sk-..." show-password type="password" :prefix-icon="Key" autocomplete="off" /></el-form-item></el-col><el-col :xs="24" :md="8"><el-form-item label="模型"><el-select v-model="model" :loading="loadingModels" :disabled="loadingModels || !models.length" style="width: 100%" placeholder="选择可用模型"><el-option v-for="item in models" :key="item.name" :label="item.name" :value="item.name"><span>{{ item.name }}</span><small v-if="item.remark" class="model-note">{{ item.remark }}</small></el-option></el-select></el-form-item></el-col><el-col :xs="24" :md="6"><el-form-item label="消息"><el-input v-model="prompt" placeholder="问点什么…" @keyup.enter="send" /></el-form-item></el-col></el-row>
        <div class="templates"><span>常用提示词</span><el-button v-for="item in templates" :key="item.label" size="small" @click="prompt = item.value">{{ item.label }}</el-button></div>
        <el-button type="primary" :icon="Promotion" :loading="running" :disabled="loadingModels || !models.length" @click="send">{{ running ? '请求中' : '发送' }}</el-button>
        <el-button v-if="running" @click="stop">停止生成</el-button>
      </el-form>
    </div>
    <div class="page-card chat-card"><div class="panel-title">对话 <span class="muted">{{ statusText }}</span></div><div v-if="userMsg" class="msg user"><div class="bubble user-bubble">{{ userMsg }}</div></div><div class="msg ai"><div class="bubble ai-bubble"><span class="out">{{ output }}<span v-if="running" class="caret">▌</span></span><div v-if="!output && !running && !error" class="placeholder">回答将显示在这里。</div></div></div><el-alert v-if="error" :title="error" type="error" show-icon :closable="false" style="margin-top: 10px" /></div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, reactive, ref } from 'vue'
import { Key, Promotion } from '@element-plus/icons-vue'
import api from '@/api'
import { onBeforeRouteLeave } from 'vue-router'
import { desktop } from '../../desktop'
import MonthlyQuotaCard from '@/components/MonthlyQuotaCard.vue'
const token = ref(''); const model = ref(''); const prompt = ref('你好，介绍一下你自己'); const models = ref<any[]>([]); const loadingModels = ref(false); const loadError = ref(''); const userMsg = ref(''); const output = ref(''); const running = ref(false); const error = ref(''); const completed = ref(false)
const monthly = reactive({ period: '', quota: 0, used: 0, remaining: 0, groupQuota: 0, fixedQuota: 0, temporaryQuota: 0, appliedGroups: [] as string[], isUnlimited: false })
const templates = [{ label: '解释概念', value: '请用简洁的语言解释这个概念，并给出一个例子。' }, { label: '总结文本', value: '请将下面的内容总结为三个要点：' }, { label: '审查代码', value: '请审查下面的代码，指出潜在问题并给出改进建议：' }]
const stopped = ref(false)
let controller: AbortController | undefined
const statusText = computed(() => running.value ? '正在接收流式响应' : stopped.value ? '已停止' : completed.value ? '调用完成' : '等待发送')
function stop() { controller?.abort() }
onBeforeRouteLeave(stop)
onBeforeUnmount(stop)
async function load() { loadingModels.value = true; loadError.value = ''; try { const [modelResult, stats] = await Promise.all([api.get('/portal/models'), api.get('/portal/stats/my')]); models.value = modelResult.data.list || []; model.value = models.value[0]?.name || ''; Object.assign(monthly, stats.data.monthly) } catch (e: any) { loadError.value = e?.message || '可用模型加载失败' } finally { loadingModels.value = false } }
function relayError(status: number, detail: string) { if (status === 401) return '令牌无效、已禁用或已过期，请检查 sk- 令牌。'; if (status === 403) return '当前令牌没有访问该模型的权限，请联系管理员。'; if (status === 429) return '本月额度已用尽，将在下个自然月恢复后继续可用。'; return `HTTP ${status}${detail ? `：${detail.slice(0, 180)}` : ''}` }
async function send() {
  if (running.value || loadingModels.value) return
  error.value = ''; completed.value = false; stopped.value = false
  if (!token.value.trim()) { error.value = '请输入 sk- 令牌'; return }
  if (!model.value) { error.value = '请选择可用模型'; return }
  userMsg.value = prompt.value.trim() || '你好'; output.value = ''; running.value = true
  const requestController = new AbortController()
  controller = requestController
  const endRequest = desktop.beginRequest()
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    const resp = await fetch(`${import.meta.env.VITE_RELAY_BASE || '/v1'}/chat/completions`, {
      method: 'POST', signal: requestController.signal,
      headers: { Authorization: `Bearer ${token.value.trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: model.value, stream: true, messages: [{ role: 'user', content: userMsg.value }] }),
    })
    if (!resp.ok) { error.value = relayError(resp.status, await resp.text()); return }
    if (!resp.body) { error.value = '服务未返回可读取的响应流'; return }
    reader = resp.body.getReader()
    const decoder = new TextDecoder(); let buffer = ''; let streamDone = false
    function consume(line: string) {
      if (!line.startsWith('data:')) return
      const payload = line.slice(5).trim()
      if (payload === '[DONE]') { streamDone = true; return }
      if (!payload) return
      try { const delta = JSON.parse(payload).choices?.[0]?.delta?.content; if (typeof delta === 'string') output.value += delta } catch { /* 忽略上游非 JSON 心跳 */ }
    }
    while (!streamDone) {
      const { done, value } = await reader.read()
      if (done) { consume(buffer + decoder.decode()); break }
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n'); buffer = lines.pop() || ''
      for (const line of lines) { consume(line); if (streamDone) break }
    }
    if (!requestController.signal.aborted) completed.value = true
  } catch (e: any) {
    if (requestController.signal.aborted) stopped.value = true
    else error.value = e?.message || '网络请求失败'
  } finally {
    try { await reader?.cancel() } catch { /* 已中断的响应无需再次取消 */ }
    reader?.releaseLock()
    controller = undefined; running.value = false; endRequest()
  }
}
onMounted(load)
</script>

<style scoped>
.muted { color: var(--ink-3); font-size: 13px; font-weight: 400; }.templates { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: -2px 0 16px; color: var(--ink-2); font-size: 13px; }.model-note { display: block; color: var(--ink-3); }.chat-card { margin-top: 16px; min-height: 240px; }.panel-title { font-size: 15px; font-weight: 600; margin-bottom: 14px; }.msg { margin-bottom: 14px; }.msg.user { display: flex; justify-content: flex-end; }.bubble { max-width: 78%; padding: 12px 16px; border-radius: 8px; line-height: 1.7; white-space: pre-wrap; word-break: break-word; }.user-bubble { background: var(--brand); color: #fff; }.ai-bubble { background: #f4f6fb; border: 1px solid #eceff5; min-width: 120px; }.placeholder { color: var(--ink-3); font-size: 13px; }.caret { animation: blink 1s steps(1) infinite; color: var(--brand); }@keyframes blink { 50% { opacity: 0; } }
</style>
