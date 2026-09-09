<script setup lang="ts">
import { applicationPage } from '../application';
const pageConfig = applicationPage('preferences');
import { onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import { ElMessage } from 'element-plus';
import { PageFrame, PageHeading, ContentPanel } from '@mg-inside/frontend';
import { desktop, setLeaveGuard, canLeave } from '../desktop';
import { request } from '../api/client';
interface Preferences { theme: 'system' | 'light' | 'dark'; wallpaper: 'dawn' | 'dusk'; restore: boolean; pinned?: string[]; [key: string]: unknown }
const values = reactive<Preferences>({ theme: 'system', wallpaper: 'dawn', restore: true });
const loading = ref(true), saving = ref(false), error = ref(''), dirty = ref(false);
watch(values, () => { if (!loading.value) { dirty.value = true; desktop.setState({ dirty: true }); } }, { deep: true });
onMounted(async () => { try { Object.assign(values, await request<Partial<Preferences>>('/api/preferences', {}, desktop.origin)); } catch (e) { error.value = (e as Error).message; } finally { await Promise.resolve(); loading.value = false; } });
const clearLeaveGuard = setLeaveGuard(() => !saving.value && (!dirty.value || window.confirm('桌面偏好尚未保存，确定离开吗？')), () => saving.value || dirty.value);
onBeforeRouteLeave(canLeave);
onUnmounted(clearLeaveGuard);
async function save() {
  saving.value = true; error.value = '';
  try {
    const current = await request<Partial<Preferences>>('/api/preferences', {}, desktop.origin);
    await request('/api/preferences', { method: 'PUT', body: JSON.stringify({ ...current, theme: values.theme, wallpaper: values.wallpaper, restore: values.restore }) }, desktop.origin);
    dirty.value = false; desktop.setState({ dirty: false }); desktop.preferencesChanged(); ElMessage.success('桌面偏好已保存');
  } catch (e) { error.value = (e as Error).message; } finally { saving.value = false; }
}
</script>
<template><PageFrame><template #header><PageHeading :title="pageConfig.title" :description="pageConfig.description"><template #actions><el-button type="primary" :loading="saving" :disabled="loading || !dirty" @click="save">保存设置</el-button></template></PageHeading></template><el-alert v-if="error" :title="error" type="error" :closable="false" /><ContentPanel title="外观与窗口"><el-form label-position="top" class="preference-form" :disabled="loading || saving"><el-form-item label="桌面外观"><el-radio-group v-model="values.theme"><el-radio-button value="system">跟随系统</el-radio-button><el-radio-button value="light">浅色</el-radio-button><el-radio-button value="dark">深色</el-radio-button></el-radio-group></el-form-item><el-form-item label="桌面壁纸"><el-radio-group v-model="values.wallpaper"><el-radio-button value="dawn">蓝色晨光</el-radio-button><el-radio-button value="dusk">紫色暮光</el-radio-button></el-radio-group></el-form-item><el-form-item label="窗口恢复"><el-switch v-model="values.restore" active-text="恢复上次窗口布局" /></el-form-item></el-form><p class="muted">会保留已打开的应用和业务页面，多个窗口恢复时错开排列。编辑中的内容仍需在应用内保存。</p></ContentPanel></PageFrame></template>
