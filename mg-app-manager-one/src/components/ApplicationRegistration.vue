<script setup lang="ts">
import { computed, onUnmounted, reactive, ref, watch } from 'vue';
import { ElMessageBox } from 'element-plus';
import { Check, Close, Upload } from '@element-plus/icons-vue';
import type { ApplicationDialogController } from '@mg-inside/frontend';
import { request } from '../api';
import { desktop } from '../desktop';
import RuntimeFields, { type RuntimeConfiguration } from './RuntimeFields.vue';
import ClientCredentials from './ClientCredentials.vue';
const props = defineProps<{ params: Record<string, unknown>; controller: ApplicationDialogController }>();
const metadata = reactive({ id: '', name: '', description: '', developer: '郑州元引信息科技有限公司', registeredVersion: '' });
const runtime = reactive<RuntimeConfiguration>({ entryUrl: '', upstream: '', defaultPath: '/', allowedPaths: ['/'], allowedApiPaths: [], icon: 'knowledge', kind: 'internal', minWidth: 760, minHeight: 480, defaultMaximized: false, runtimePolicy: { apiMode: 'registered', launchMode: 'tab' } });
const redirect = ref(''), iconData = ref(''), tab = ref('basic'), saving = ref(false), error = ref(''), result = ref<any>(), submitted = ref(false);
const requestId = crypto.randomUUID(), upload = ref<HTMLInputElement>();
const dirty = computed(() => !result.value && Boolean(metadata.id || metadata.name || runtime.entryUrl || redirect.value || iconData.value));
watch([dirty, saving], () => props.controller.setState({ dirty: dirty.value, busy: saving.value }), { immediate: true });
const clear = props.controller.onBeforeClose(async () => {
  if (saving.value) return false;
  if (!dirty.value && !result.value?.credentials?.clientSecret) return true;
  return ElMessageBox.confirm(result.value ? '密钥关闭后不可再次查看，确定关闭吗？' : '注册信息尚未完成，确定关闭吗？', '关闭注册', { confirmButtonText: '关闭', cancelButtonText: '继续配置' }).then(() => true).catch(() => false);
});
onUnmounted(() => { clear(); result.value = undefined; });
async function selectIcon(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return;
  try {
    if (!['image/png', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) throw new Error('请选择小于 2MB 的 PNG 或 WebP 图片');
    const bitmap = await createImageBitmap(file);
    try { if (bitmap.width > 4096 || bitmap.height > 4096) throw new Error('原图尺寸不可超过 4096 像素');
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256; const scale = Math.min(256 / bitmap.width, 256 / bitmap.height);
      canvas.getContext('2d')!.drawImage(bitmap, (256 - bitmap.width * scale) / 2, (256 - bitmap.height * scale) / 2, bitmap.width * scale, bitmap.height * scale);
      iconData.value = canvas.toDataURL('image/png');
    } finally { bitmap.close(); }
    error.value = '';
  } catch (e) { error.value = (e as Error).message; }
}
async function save() {
  if (saving.value) return;
  error.value = ''; saving.value = true;
  try {
    if (submitted.value) result.value = await request(`/api/application-registrations/${encodeURIComponent(metadata.id)}/retry`, { method: 'POST', body: '{}' });
    else {
      if (!metadata.id || !metadata.name.trim() || !runtime.entryUrl || !redirect.value.trim()) throw new Error('请填写应用标识、名称、入口和 SSO 回调地址');
      const body = { requestId, metadata, runtime: { ...runtime, upstream: runtime.upstream || runtime.entryUrl }, redirectUris: redirect.value.split('\n').map(s => s.trim()).filter(Boolean), iconData: iconData.value };
      try { result.value = await request('/api/application-registrations', { method: 'POST', body: JSON.stringify(body) }); }
      catch (e) { try { const state = await request<any>(`/api/application-registrations/${encodeURIComponent(metadata.id)}`); if (['failed', 'pending'].includes(state.state)) submitted.value = true; } catch {} throw e; }
    }
    desktop.applicationsChanged();
  } catch (e) { error.value = (e as Error).message; } finally { saving.value = false; }
}
function finish() { props.controller.complete({ changed: true, applicationId: metadata.id }); }
</script>
<template>
  <el-alert v-if="error" :title="error" type="error" :closable="false" />
  <template v-if="result">
    <el-result icon="success" title="应用接入配置已完成" />
    <ClientCredentials v-if="result.credentials?.clientSecret" :client-id="metadata.id" :issuer="result.issuer" :redirect-uri="redirect.split('\n')[0] || ''" :secret="result.credentials.clientSecret" />
    <el-alert v-else title="密钥已签发，可在接入配置中轮换。" type="warning" :closable="false" />
    <footer><el-button type="primary" :icon="Check" @click="finish">完成</el-button></footer>
  </template>
  <template v-else>
    <el-form label-position="top" :disabled="saving || submitted" @submit.prevent="save">
      <el-tabs v-model="tab">
        <el-tab-pane label="基本资料" name="basic">
          <el-form-item label="应用标识" required><el-input v-model="metadata.id" maxlength="64" aria-label="应用标识" /></el-form-item>
          <el-form-item label="应用名称" required><el-input v-model="metadata.name" maxlength="80" aria-label="应用名称" /></el-form-item>
          <el-form-item label="开发者"><el-input v-model="metadata.developer" maxlength="120" aria-label="开发者" /></el-form-item>
          <el-form-item label="当前版本"><el-input v-model="metadata.registeredVersion" maxlength="64" aria-label="当前版本" /></el-form-item>
          <el-form-item label="说明"><el-input v-model="metadata.description" type="textarea" maxlength="200" aria-label="说明" /></el-form-item>
          <el-form-item label="应用图标"><img v-if="iconData" :src="iconData" alt="应用图标" width="64" height="64" /><input ref="upload" type="file" accept="image/png,image/webp" hidden @change="selectIcon" /><el-button :icon="Upload" @click="upload?.click()">上传图标</el-button></el-form-item>
          <el-form-item label="初始访问权限"><el-tag>仅注册管理员</el-tag></el-form-item>
        </el-tab-pane>
        <el-tab-pane label="运行入口" name="runtime"><RuntimeFields :value="runtime" /></el-tab-pane>
        <el-tab-pane label="单点登录" name="sso">
          <el-form-item label="认证协议"><el-tag>OIDC / Authorization Code + PKCE</el-tag></el-form-item>
          <el-form-item label="回调地址" required><el-input v-model="redirect" type="textarea" :rows="4" aria-label="回调地址" placeholder="https://app.example.com/auth/callback" /></el-form-item>
          <el-form-item label="客户端类型"><el-tag>服务端 Web</el-tag></el-form-item>
        </el-tab-pane>
      </el-tabs>
    </el-form>
    <footer><el-button :icon="Close" :disabled="saving" @click="controller.cancel()">取消</el-button><el-button :icon="Check" type="primary" :loading="saving" @click="save">{{ submitted ? '重试接入' : '注册并接入' }}</el-button></footer>
  </template>
</template>
<style scoped>footer{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}img{object-fit:contain;margin-right:16px}:deep(.el-alert){margin-bottom:16px}</style>
