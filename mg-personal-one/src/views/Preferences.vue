<script setup lang="ts">
import { applicationPage } from '../application';
const pageConfig = applicationPage('preferences');
import { onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import { ElMessage } from 'element-plus';
import { PageFrame, PageHeading, ContentPanel } from '@mg-inside/frontend';
import { desktop, setLeaveGuard, canLeave } from '../desktop';
import { request } from '../api/client';
interface Preferences { theme: 'system' | 'light' | 'dark'; wallpaper: 'dawn' | 'dusk' | 'custom'; wallpaperVersion?: string; restore: boolean; pinned?: string[]; [key: string]: unknown }
const values = reactive<Preferences>({ theme: 'system', wallpaper: 'dawn', restore: true });
const loading = ref(true), saving = ref(false), error = ref(''), dirty = ref(false);
const WALLPAPER_TYPES = ['image/jpeg', 'image/png', 'image/webp'], WALLPAPER_LIMIT = 8 * 1024 * 1024;
const customVersion = ref(''), customPreview = ref(''), uploading = ref(false);
const fileInput = ref<HTMLInputElement>();
// 壁纸走桌面后端的本人接口，跨端口预览拿不到 Cookie，统一用 fetch 取回再转本地地址。
async function showCustom(version: string) {
  customVersion.value = version;
  if (customPreview.value) { URL.revokeObjectURL(customPreview.value); customPreview.value = ''; }
  if (!version) return;
  try {
    const response = await fetch(`${desktop.origin}/api/preferences/wallpaper?v=${encodeURIComponent(version)}`, { credentials: 'include' });
    if (response.ok) customPreview.value = URL.createObjectURL(await response.blob());
  } catch { /* 预览失败不影响壁纸本身，仍可重新上传。 */ }
}
async function chooseWallpaper(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0];
  input.value = '';
  if (!file) return;
  error.value = '';
  if (!WALLPAPER_TYPES.includes(file.type)) { error.value = '壁纸仅支持 JPEG、PNG 或 WebP 图片'; return; }
  if (file.size > WALLPAPER_LIMIT) { error.value = '壁纸不能超过 8 MB'; return; }
  uploading.value = true;
  try {
    const result = await request<{ version: string }>('/api/preferences/wallpaper', { method: 'PUT', body: file }, desktop.origin);
    values.wallpaper = 'custom'; values.wallpaperVersion = result.version;
    await showCustom(result.version); desktop.preferencesChanged(); ElMessage.success('壁纸已上传并应用');
  } catch (e) { error.value = (e as Error).message; } finally { uploading.value = false; }
}
async function removeWallpaper() {
  if (!window.confirm('移除自定义壁纸并恢复默认壁纸？')) return;
  uploading.value = true; error.value = '';
  try {
    await request('/api/preferences/wallpaper', { method: 'DELETE' }, desktop.origin);
    values.wallpaper = 'dawn'; values.wallpaperVersion = '';
    await showCustom(''); desktop.preferencesChanged(); ElMessage.success('已恢复默认壁纸');
  } catch (e) { error.value = (e as Error).message; } finally { uploading.value = false; }
}
watch(values, () => { if (!loading.value) { dirty.value = true; desktop.setState({ dirty: true }); } }, { deep: true });
onMounted(async () => { try { const current = await request<Partial<Preferences>>('/api/preferences', {}, desktop.origin); Object.assign(values, current); await showCustom(current.wallpaperVersion || ''); } catch (e) { error.value = (e as Error).message; } finally { await Promise.resolve(); loading.value = false; } });
const clearLeaveGuard = setLeaveGuard(() => !saving.value && (!dirty.value || window.confirm('桌面偏好尚未保存，确定离开吗？')), () => saving.value || dirty.value);
onBeforeRouteLeave(canLeave);
onUnmounted(() => { clearLeaveGuard(); if (customPreview.value) URL.revokeObjectURL(customPreview.value); });
async function save() {
  saving.value = true; error.value = '';
  try {
    const current = await request<Partial<Preferences>>('/api/preferences', {}, desktop.origin);
    await request('/api/preferences', { method: 'PUT', body: JSON.stringify({ ...current, theme: values.theme, wallpaper: values.wallpaper, restore: values.restore }) }, desktop.origin);
    dirty.value = false; desktop.setState({ dirty: false }); desktop.preferencesChanged(); ElMessage.success('桌面偏好已保存');
  } catch (e) { error.value = (e as Error).message; } finally { saving.value = false; }
}
</script>
<template><PageFrame><template #header><PageHeading :title="pageConfig.title" :description="pageConfig.description"><template #actions><el-button type="primary" :loading="saving" :disabled="loading || !dirty" @click="save">保存设置</el-button></template></PageHeading></template><el-alert v-if="error" :title="error" type="error" :closable="false" /><ContentPanel title="外观与窗口"><el-form label-position="top" class="preference-form" :disabled="loading || saving"><el-form-item label="桌面外观"><el-radio-group v-model="values.theme"><el-radio-button value="system">跟随系统</el-radio-button><el-radio-button value="light">浅色</el-radio-button><el-radio-button value="dark">深色</el-radio-button></el-radio-group></el-form-item><el-form-item label="桌面壁纸"><el-radio-group v-model="values.wallpaper"><el-radio-button value="dawn">蓝色晨光</el-radio-button><el-radio-button value="dusk">紫色暮光</el-radio-button><el-radio-button value="custom" :disabled="!customVersion">我的壁纸</el-radio-button></el-radio-group></el-form-item><el-form-item label="我的壁纸"><div class="wallpaper-upload"><img v-if="customPreview" class="wallpaper-preview" :src="customPreview" alt="自定义壁纸预览"><div v-else class="wallpaper-preview wallpaper-empty">尚未上传</div><div class="wallpaper-actions"><div><el-button :loading="uploading" @click="fileInput?.click()">{{ customVersion ? '更换图片' : '上传图片' }}</el-button><el-button v-if="customVersion" link :disabled="uploading" @click="removeWallpaper">移除</el-button></div><input ref="fileInput" type="file" accept="image/jpeg,image/png,image/webp" hidden @change="chooseWallpaper"><p class="muted">每位用户保存一张，支持 JPEG、PNG、WebP，不超过 8 MB。上传后立即应用到桌面，并缓存在浏览器中。</p></div></div></el-form-item><el-form-item label="窗口恢复"><el-switch v-model="values.restore" active-text="恢复上次窗口布局" /></el-form-item></el-form><p class="muted">会保留已打开的应用和业务页面，多个窗口恢复时错开排列。编辑中的内容仍需在应用内保存。</p></ContentPanel></PageFrame></template>
