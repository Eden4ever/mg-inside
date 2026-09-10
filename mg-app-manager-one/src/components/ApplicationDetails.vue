<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { ElMessageBox } from 'element-plus';
import { Edit, Check, Close } from '@element-plus/icons-vue';
import { ApplicationIcon, type ApplicationDialogController } from '@mg-inside/frontend';
import { request, type ManagedApplication } from '../api';
const props = defineProps<{ params: Record<string, unknown>; controller: ApplicationDialogController }>();
const id = typeof props.params.applicationId === 'string' ? props.params.applicationId : '';
const item = ref<ManagedApplication>(), loading = ref(true), saving = ref(false), error = ref('');
const editing = ref(props.params.edit === true), changed = ref(false);
const form = reactive({ name: '', description: '', developer: '', registeredVersion: '', icon: '', minWidth: 760, minHeight: 480, defaultMaximized: false });
const baseline = ref(''), dirty = computed(() => !loading.value && editing.value && JSON.stringify(form) !== baseline.value);
const labels = { system: '系统应用', default: '默认应用', internal: '内部应用', external: '外部应用' };
const abort = new AbortController(); let disposed = false;
props.controller.setTitle('应用详情');
watch([dirty, saving], () => props.controller.setState({ dirty: dirty.value, busy: saving.value }), { immediate: true });
const clearGuard = props.controller.onBeforeClose(async () => {
  if (saving.value) return false;
  if (!dirty.value) return true;
  return ElMessageBox.confirm('应用信息的修改尚未保存，确定放弃吗？', '放弃修改', { confirmButtonText: '放弃修改', cancelButtonText: '继续编辑', type: 'warning' }).then(() => true).catch(() => false);
});
function fill(value: ManagedApplication) {
  item.value = value;
  Object.assign(form, { name: value.name, description: value.description, developer: value.developer || '', registeredVersion: value.registeredVersion || '', icon: value.icon,
    minWidth: value.minWidth, minHeight: value.minHeight, defaultMaximized: value.defaultMaximized === true });
  baseline.value = JSON.stringify(form);
  if (!value.editable || value.kind === 'external') editing.value = false;
}
async function load() {
  loading.value = true; error.value = '';
  try { const value = await request<ManagedApplication>(`/api/applications/${encodeURIComponent(id)}`, { signal: abort.signal }); if (!disposed) fill(value); }
  catch (e) { if (!disposed) error.value = (e as Error).message; }
  finally { if (!disposed) loading.value = false; }
}
async function save() {
  if (!item.value?.editable || item.value.kind === 'external' || saving.value) return;
  error.value = '';
  if (!form.name.trim()) { error.value = '请输入应用名称'; return; }
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(form.icon)) { error.value = '应用图标资源键无效'; return; }
  saving.value = true;
  try {
    const value = await request<ManagedApplication>(`/api/applications/${encodeURIComponent(id)}`, { method: 'PATCH',
      body: JSON.stringify({ ...form, name: form.name.trim(), description: form.description.trim(), developer: form.developer.trim(), expectedRevision: item.value.revision }) });
    fill(value); editing.value = false; changed.value = true;
    props.controller.setState({ dirty: false, busy: false }); props.controller.complete({ applicationId: id, changed: true });
  } catch (e) { error.value = (e as Error).message; }
  finally { saving.value = false; }
}
function close() { if (changed.value) props.controller.complete({ applicationId: id, changed: true }); else props.controller.cancel(); }
onMounted(load); onUnmounted(() => { disposed = true; abort.abort(); clearGuard(); });
</script>
<template>
  <div class="application-details">
    <div v-if="loading" role="status">正在读取应用详情…</div>
    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
    <el-button v-if="!item && !loading" @click="load">重试</el-button>
    <template v-if="item && !loading">
      <div class="details-heading"><ApplicationIcon :app="item" class="details-icon" /><div><h2>{{ item.name }}</h2><el-tag size="small">{{ labels[item.kind] }}</el-tag></div></div>
      <el-form v-if="editing" label-position="top" :disabled="saving" @submit.prevent="save">
        <el-form-item label="应用名称" required><el-input v-model="form.name" maxlength="80" aria-label="应用名称" /></el-form-item>
        <el-form-item label="开发者"><el-input v-model="form.developer" maxlength="120" aria-label="开发者" /></el-form-item>
        <el-form-item label="当前版本"><el-input v-model="form.registeredVersion" maxlength="64" aria-label="当前版本" clearable /></el-form-item>
        <el-form-item label="说明"><el-input v-model="form.description" type="textarea" :rows="3" maxlength="200" show-word-limit aria-label="应用说明" /></el-form-item>
        <el-form-item label="图标资源键" required><el-input v-model="form.icon" maxlength="64" aria-label="图标资源键" /></el-form-item>
        <div class="window-fields"><el-form-item label="最小宽度"><el-input-number v-model="form.minWidth" :min="320" :max="4000" :precision="0" aria-label="最小宽度" /></el-form-item><el-form-item label="最小高度"><el-input-number v-model="form.minHeight" :min="240" :max="4000" :precision="0" aria-label="最小高度" /></el-form-item></div>
        <el-form-item label="默认最大化"><el-switch v-model="form.defaultMaximized" aria-label="默认最大化" /></el-form-item>
      </el-form>
      <el-descriptions v-else :column="1" border>
        <el-descriptions-item label="应用标识">{{ item.id }}</el-descriptions-item>
        <el-descriptions-item label="开发者">{{ item.developer || '未填写' }}</el-descriptions-item>
        <el-descriptions-item label="说明">{{ item.description || '未填写' }}</el-descriptions-item>
        <el-descriptions-item label="版本">{{ item.kind === 'external' ? '外部网站' : item.version || '未登记' }}</el-descriptions-item>
        <el-descriptions-item label="状态">{{ item.enabled === false ? '已关闭' : '已开启' }}</el-descriptions-item>
        <el-descriptions-item label="入口地址">{{ item.entryUrl }}</el-descriptions-item>
        <el-descriptions-item label="默认路径">{{ item.defaultPath }}</el-descriptions-item>
        <el-descriptions-item v-if="item.allowedPaths" label="允许路径">{{ item.allowedPaths.join('、') }}</el-descriptions-item>
        <el-descriptions-item label="图标">{{ item.icon }}</el-descriptions-item>
        <el-descriptions-item label="最小窗口">{{ item.minWidth }} × {{ item.minHeight }}</el-descriptions-item>
        <el-descriptions-item label="默认最大化">{{ item.defaultMaximized ? '是' : '否' }}</el-descriptions-item>
        <el-descriptions-item v-if="item.updatedAt" label="更新时间">{{ new Date(item.updatedAt).toLocaleString('zh-CN') }}</el-descriptions-item>
      </el-descriptions>
    </template>
    <footer><el-button :icon="Close" :disabled="saving" @click="close">{{ editing ? '取消' : '关闭' }}</el-button><el-button v-if="editing && item" type="primary" :icon="Check" :loading="saving" @click="save">保存修改</el-button><el-button v-else-if="item?.editable && item.kind !== 'external'" type="primary" :icon="Edit" @click="editing = true">编辑元数据</el-button></footer>
  </div>
</template>
<style scoped>
.application-details { min-width:0; overflow-wrap:anywhere; }
.details-heading { display:flex; align-items:center; gap:12px; margin:0 0 20px; }.details-heading > div { min-width:0; }.details-heading h2 { margin:0 0 8px; font-size:18px; }.details-icon { width:44px; height:44px; flex-shrink:0; }
.window-fields { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; }.window-fields .el-input-number { width:100%; }
footer { display:flex; justify-content:flex-end; gap:8px; margin-top:24px; }footer .el-button + .el-button { margin-left:0; }
:deep(.el-descriptions__table) { table-layout:fixed; }:deep(.el-descriptions__label) { width:104px; }:deep(.el-alert) { margin-bottom:16px; }
</style>
