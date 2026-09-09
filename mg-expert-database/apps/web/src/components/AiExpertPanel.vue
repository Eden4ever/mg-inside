<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ChatDotRound, CircleCheck, Close, Help, Loading, MagicStick, Promotion } from '@element-plus/icons-vue';
import type { AiSuggestion, ModuleDefinition, ResearchModuleKey, ResearchWorkspace } from '@/types/domain';

const props = defineProps<{
  workspace: ResearchWorkspace;
  selectedModuleKey: ResearchModuleKey;
  collapsed: boolean;
  readonly?: boolean;
  unavailable?: boolean;
  suggestions: AiSuggestion[];
  loading?: boolean;
  streaming?: boolean;
  streamText?: string;
  streamError?: string;
}>();

const emit = defineEmits<{
  toggle: [];
  accept: [suggestion: AiSuggestion];
  reject: [suggestion: AiSuggestion];
  generate: [prompt: string, modelProcessingConfirmed: boolean];
}>();

const prompt = ref('');
const modelProcessingConfirmed = ref(false);
const selectedDefinition = computed<ModuleDefinition | undefined>(() => props.workspace.moduleDefinitions.find((item) => item.moduleKey === props.selectedModuleKey));
const suggestions = computed(() => [
  `梳理“${selectedDefinition.value?.name || '当前模块'}”的研究要点`,
  '检查当前字段是否缺少依据',
  '识别需要人工核验的内容',
]);
const moduleSuggestions = computed(() => props.suggestions.filter((item) => item.targetType === 'module' && item.moduleKey === props.selectedModuleKey));
const summarySuggestions = computed(() => props.suggestions.filter((item) => item.targetType === 'summary'));
const confidenceLabel: Record<string, string> = { supported: '有依据', inference: '推断', needs_verification: '待核验' };

watch(() => [props.workspace.indicator.id, props.selectedModuleKey], () => { modelProcessingConfirmed.value = false; });

function submitPrompt() {
  const value = prompt.value.trim();
  if (!value || !modelProcessingConfirmed.value || props.streaming || props.unavailable || props.readonly) return;
  prompt.value = '';
  emit('generate', value, true);
  modelProcessingConfirmed.value = false;
}
</script>

<template>
  <aside v-if="!collapsed" class="ai-panel">
    <div class="ai-heading">
      <div class="ai-identity"><div class="ai-avatar"><MagicStick /></div><div><strong>AI指标专家</strong><span>横向辅助研究能力</span></div></div>
      <el-button text :icon="Close" aria-label="收起 AI 指标专家" @click="emit('toggle')" />
    </div>
    <div class="ai-context"><el-tag size="small" type="primary" effect="plain">当前上下文</el-tag><p>{{ workspace.indicator.name }}</p><span>{{ selectedDefinition?.name }} · {{ selectedDefinition?.researchQuestion }}</span></div>
    <el-alert v-if="readonly" type="info" :closable="false" show-icon class="ai-notice"><template #title>当前为只读访问</template>你可以查看已有候选建议，但不能生成、采纳或拒绝建议。</el-alert>
    <el-alert v-else-if="unavailable" type="info" :closable="false" show-icon class="ai-notice"><template #title>M4 AI 服务未配置</template>当前仅展示上下文和已有建议；配置服务端模型后才会生成候选内容。</el-alert>
    <el-alert v-else-if="streamError" type="error" :closable="false" show-icon class="ai-notice"><template #title>AI 生成失败</template>{{ streamError }}</el-alert>
    <div class="ai-body">
      <div v-loading="loading" class="suggestion-section">
        <div class="section-title"><strong>候选建议</strong><el-tag size="small" type="info">{{ moduleSuggestions.length }}</el-tag></div>
        <el-empty v-if="!loading && !moduleSuggestions.length" description="当前模块暂无候选建议" :image-size="52" />
        <article v-for="item in moduleSuggestions" :key="item.id" class="suggestion-item">
          <div class="suggestion-meta"><el-tag size="small" type="warning" effect="plain">{{ confidenceLabel[item.confidence || 'needs_verification'] }}</el-tag><span>{{ item.fieldKey || '模块级建议' }}</span></div>
          <p>{{ item.content }}</p>
          <small>{{ item.rationale }}</small>
          <div v-if="item.evidenceIds.length || item.verificationItems.length" class="suggestion-trace">
            <el-tag v-if="item.evidenceIds.length" size="small" type="success" effect="plain">{{ item.evidenceIds.length }} 条依据</el-tag>
            <span v-if="item.verificationItems.length">待核验：{{ item.verificationItems.join('；') }}</span>
          </div>
          <small class="suggestion-source">{{ item.modelId }} · 提示词 {{ item.promptVersion }}</small>
          <div v-if="item.status === 'pending' && !readonly" class="suggestion-actions"><el-button size="small" :icon="Close" @click="emit('reject', item)">拒绝</el-button><el-button size="small" type="primary" :icon="CircleCheck" @click="emit('accept', item)">采纳并生成修订</el-button></div>
          <el-tag v-else-if="item.status === 'pending'" size="small" type="warning">待研究员处理</el-tag>
          <el-tag v-else size="small" :type="item.status === 'accepted' ? 'success' : 'info'">{{ item.status === 'accepted' ? '已采纳' : '已拒绝' }}</el-tag>
        </article>
      </div>
      <div v-if="summarySuggestions.length" class="suggestion-section summary-suggestion-section">
        <div class="section-title"><strong>研究摘要候选</strong><el-tag size="small" type="info">{{ summarySuggestions.length }}</el-tag></div>
        <article v-for="item in summarySuggestions" :key="item.id" class="suggestion-item">
          <div class="suggestion-meta"><el-tag size="small" type="warning" effect="plain">{{ confidenceLabel[item.confidence || 'needs_verification'] }}</el-tag><span>八模块研究摘要</span></div>
          <p>{{ item.content }}</p>
          <small>{{ item.rationale }}</small>
          <div v-if="item.evidenceIds.length || item.verificationItems.length" class="suggestion-trace">
            <el-tag v-if="item.evidenceIds.length" size="small" type="success" effect="plain">{{ item.evidenceIds.length }} 条依据</el-tag>
            <span v-if="item.verificationItems.length">待核验：{{ item.verificationItems.join('；') }}</span>
          </div>
          <div v-if="item.status === 'pending' && !readonly" class="suggestion-actions"><el-button size="small" :icon="Close" @click="emit('reject', item)">拒绝</el-button><el-button size="small" type="primary" :icon="CircleCheck" @click="emit('accept', item)">采纳为正式摘要</el-button></div>
          <el-tag v-else-if="item.status === 'pending'" size="small" type="warning">待研究员处理</el-tag>
          <el-tag v-else size="small" :type="item.status === 'accepted' ? 'success' : 'info'">{{ item.status === 'accepted' ? '已采纳' : '已拒绝' }}</el-tag>
        </article>
      </div>
      <div class="ai-welcome"><el-icon><ChatDotRound /></el-icon><strong>我可以协助你研究当前指标</strong><span>生成的建议必须经人工核验、采纳后才会进入正式研究内容。</span></div>
      <article v-if="streaming || streamText" class="stream-draft"><div class="suggestion-meta"><el-tag size="small" type="primary" effect="plain">{{ streaming ? '正在生成' : '候选草稿' }}</el-tag><span>仅供人工核验</span></div><p>{{ streamText || '正在连接模型…' }}<el-icon v-if="streaming" class="is-loading"><Loading /></el-icon></p></article>
      <div v-if="!readonly" class="prompt-list"><el-button v-for="item in suggestions" :key="item" plain class="prompt-button" :disabled="unavailable || streaming" @click="prompt = item">{{ item }}<el-icon><Promotion /></el-icon></el-button></div>
    </div>
    <form v-if="!readonly" class="ai-composer" @submit.prevent="submitPrompt">
      <div class="composer-row"><el-input v-model="prompt" :disabled="unavailable || streaming" placeholder="输入研究问题" :prefix-icon="Help" /><el-button type="primary" native-type="submit" :loading="streaming" :disabled="unavailable || streaming || !prompt.trim() || !modelProcessingConfirmed" :icon="Promotion" aria-label="发送" /></div>
      <el-checkbox v-model="modelProcessingConfirmed" :disabled="unavailable || streaming" class="model-confirmation">我确认当前模块资料可发送至模型服务处理</el-checkbox>
    </form>
    <div class="ai-boundary"><el-icon><Help /></el-icon><span>AI 建议经人工采纳后写入记录。</span></div>
  </aside>
  <button v-else class="ai-collapsed-button" type="button" @click="emit('toggle')"><el-icon><ChatDotRound /></el-icon><span>AI指标专家</span></button>
</template>

<style scoped>
.ai-panel { border-left: 1px solid var(--el-border-color-lighter); height: 100%; min-width: 0; min-height: 0; display: flex; flex-direction: column; background: #fff; }
.ai-heading { min-height: 62px; display: flex; align-items: center; justify-content: space-between; padding: 11px 13px; border-bottom: 1px solid var(--el-border-color-lighter); }
.ai-identity { display: flex; align-items: center; gap: 9px; min-width: 0; }
.ai-avatar { width: 32px; height: 32px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; background: var(--el-color-primary); color: #fff; }
.ai-identity strong, .ai-identity span { display: block; }
.ai-identity strong { font-size: 14px; }
.ai-identity span { color: var(--el-text-color-secondary); font-size: 11px; margin-top: 2px; }
.ai-context { padding: 12px 13px; border-bottom: 1px solid var(--el-border-color-lighter); background: var(--el-color-primary-light-9); }
.ai-context p { margin: 8px 0 1px; color: var(--el-text-color-primary); font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ai-context span { color: var(--el-text-color-secondary); font-size: 11px; }
.ai-notice { margin: 10px; font-size: 12px; }
.ai-body { flex: 1; min-height: 0; padding: 16px 13px; overflow: auto; }
.suggestion-section { min-height: 82px; }
.section-title { display: flex; align-items: center; justify-content: space-between; margin-bottom: 9px; font-size: 12px; }
.suggestion-item { padding: 10px 0; border-top: 1px solid var(--el-border-color-lighter); }
.suggestion-meta { display: flex; align-items: center; gap: 7px; color: var(--el-text-color-secondary); font-size: 11px; }
.suggestion-item p { margin: 8px 0 5px; line-height: 1.55; font-size: 12px; }
.suggestion-item small { display: block; color: var(--el-text-color-secondary); line-height: 1.5; }
.suggestion-trace { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 7px; color: var(--el-text-color-secondary); font-size: 11px; line-height: 1.5; }
.suggestion-source { margin-top: 5px; color: var(--el-text-color-placeholder) !important; font-size: 10px; }
.suggestion-actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 9px; }
.stream-draft { margin: 14px 0; padding: 10px; border: 1px solid var(--el-color-primary-light-7); background: var(--el-color-primary-light-9); border-radius: 4px; }
.stream-draft p { margin: 8px 0 0; white-space: pre-wrap; line-height: 1.6; font-size: 12px; }
.stream-draft .el-icon { margin-left: 5px; vertical-align: middle; }
.ai-welcome { display: flex; flex-direction: column; align-items: center; text-align: center; padding: 22px 8px; color: var(--el-text-color-secondary); gap: 8px; }
.ai-welcome .el-icon { color: var(--el-color-primary); font-size: 28px; }
.ai-welcome strong { color: var(--el-text-color-primary); font-size: 13px; }
.ai-welcome span { font-size: 11px; line-height: 1.6; }
.prompt-list { display: flex; flex-direction: column; gap: 8px; }
.prompt-button { justify-content: space-between; text-align: left; white-space: normal; height: auto; min-height: 34px; line-height: 1.4; }
.ai-composer { display: flex; flex-direction: column; gap: 7px; padding: 10px; border-top: 1px solid var(--el-border-color-lighter); }
.composer-row { display: flex; gap: 6px; min-width: 0; }
.ai-composer .el-input { min-width: 0; }
.ai-composer .el-button { flex: 0 0 auto; }
.model-confirmation { height: auto; margin-right: 0; white-space: normal; line-height: 1.45; font-size: 11px; }
.ai-boundary { padding: 9px 12px 12px; color: var(--el-text-color-placeholder); font-size: 11px; line-height: 1.5; display: flex; gap: 5px; align-items: flex-start; }
.ai-collapsed-button { width: 40px; height: 132px; border: 1px solid var(--el-border-color); background: #fff; color: var(--el-color-primary); writing-mode: vertical-rl; display: flex; align-items: center; justify-content: center; gap: 7px; cursor: pointer; border-radius: 4px 0 0 4px; }
.ai-collapsed-button .el-icon { writing-mode: horizontal-tb; }

@media (max-width: 1100px) {
  .ai-panel { position: fixed; z-index: 30; right: 0; top: 58px; bottom: 0; width: min(360px, 92vw); box-shadow: -5px 0 18px rgba(0, 0, 0, .12); }
  .ai-collapsed-button { position: fixed; z-index: 25; right: 0; top: 42%; }
}
</style>
