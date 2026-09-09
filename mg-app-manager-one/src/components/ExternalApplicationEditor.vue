<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { ElMessageBox } from 'element-plus';
import type { ApplicationDialogController } from '@mg-inside/frontend';
import { request, normalizeExternalUrl, type ApplicationInput, type ManagedApplication } from '../api';
const props = defineProps<{ params: Record<string, unknown>; controller: ApplicationDialogController }>();
const applicationId = typeof props.params.applicationId === 'string' ? props.params.applicationId : '';
const form = reactive<ApplicationInput>({ name: '', url: '', description: '', icon: 'knowledge' });
const baseline = ref(JSON.stringify(form)), loading = ref(Boolean(applicationId)), saving = ref(false), finished = ref(false), loadError = ref(''), formError = ref('');
const dirty = computed(() => !loading.value && JSON.stringify(form) !== baseline.value);
const readController = new AbortController(); let disposed = false, prompt: Promise<boolean> | undefined;
props.controller.setTitle(applicationId ? '编辑外链应用' : '添加外链应用');
watch([dirty, saving], () => props.controller.setState({ dirty: dirty.value, busy: saving.value }), { immediate: true });
const clearGuard = props.controller.onBeforeClose(async () => {
  if (saving.value) return false;
  if (!dirty.value) return true;
  if (!prompt) prompt = ElMessageBox.confirm('外链应用的修改尚未保存，确定放弃吗？', '放弃修改', { confirmButtonText: '放弃修改', cancelButtonText: '继续编辑', type: 'warning' }).then(() => true).catch(() => false).finally(() => { prompt = undefined; });
  return prompt;
});
async function load() {
  if (!applicationId) return;
  loading.value = true; loadError.value = '';
  try {
    const data = await request<{ items: ManagedApplication[] }>('/api/applications', { signal: AbortSignal.any([readController.signal, AbortSignal.timeout(30000)]) });
    if (disposed) return;
    const item = data.items.find(value => value.id === applicationId);
    if (!item || item.kind !== 'external' || !item.editable) throw new Error('此应用不可编辑，可能已被移除');
    Object.assign(form, { name: item.name, url: item.entryUrl, description: item.description, icon: item.icon }); baseline.value = JSON.stringify(form);
  } catch (error) { if (!disposed) loadError.value = (error as Error).message; }
  finally { if (!disposed) loading.value = false; }
}
async function save() {
  if (saving.value || loading.value || loadError.value || finished.value) return;
  formError.value = ''; let input: ApplicationInput;
  try {
    const name = form.name.trim();
    if (!name || name.length > 80) throw new Error('应用名称不能为空，最多 80 个字符');
    if (form.description.trim().length > 200) throw new Error('说明最多 200 个字符');
    input = { name, description: form.description.trim(), url: normalizeExternalUrl(form.url), icon: form.icon };
  } catch (error) { formError.value = (error as Error).message; return; }
  saving.value = true;
  try {
    const item = await request<ManagedApplication>(applicationId ? `/api/applications/${encodeURIComponent(applicationId)}` : '/api/applications', { method: applicationId ? 'PUT' : 'POST', body: JSON.stringify(input) });
    baseline.value = JSON.stringify(form); saving.value = false; finished.value = true;
    props.controller.setState({ dirty: false, busy: false }); props.controller.complete({ applicationId: item.id });
  } catch (error) { formError.value = (error as Error).message; saving.value = false; }
}
onMounted(load);
onUnmounted(() => { disposed = true; readController.abort(); clearGuard(); });
</script>
<template>
  <div class="external-application-editor">
    <div v-if="loading" class="editor-state" role="status">正在读取外链应用…</div>
    <div v-else-if="loadError" class="editor-state"><el-alert :title="loadError" type="error" :closable="false" show-icon /><el-button @click="load">重试</el-button></div>
    <el-form v-else label-position="top" :disabled="saving || finished" @submit.prevent="save"><el-form-item label="应用名称" required><el-input v-model="form.name" maxlength="80" placeholder="例如：团队文档" aria-label="应用名称" /></el-form-item><el-form-item label="网页地址" required><el-input v-model="form.url" maxlength="2048" placeholder="https://example.com" aria-label="网页地址" /></el-form-item><el-form-item label="说明"><el-input v-model="form.description" type="textarea" :rows="3" maxlength="200" show-word-limit aria-label="应用说明" /></el-form-item></el-form>
    <el-alert v-if="formError" :title="formError" type="error" :closable="false" show-icon />
    <p class="editor-note">部分网站不允许在桌面窗口内显示，需要在浏览器中打开；添加外链不会改变该网站的安全限制。</p>
    <footer class="editor-actions"><el-button :disabled="saving || finished" @click="controller.cancel()">取消</el-button><el-button type="primary" :loading="saving" :disabled="loading || Boolean(loadError) || finished" @click="save">{{ applicationId ? '保存修改' : '添加应用' }}</el-button></footer>
  </div>
</template>
<style scoped>
.external-application-editor { min-width:0; }
.editor-state { display:flex; flex-direction:column; align-items:center; gap:16px; padding:24px 0; color:var(--el-text-color-secondary); }
.editor-note { margin:20px 0; color:var(--el-text-color-secondary); font-size:12px; line-height:1.7; }
.editor-actions { display:flex; justify-content:flex-end; align-items:center; gap:8px; margin-top:24px; }.editor-actions .el-button + .el-button { margin-left:0; }
</style>
