<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Check, Refresh, Key, Close } from '@element-plus/icons-vue';
import type { ApplicationDialogController } from '@mg-inside/frontend';
import { request } from '../api';
import { desktop } from '../desktop';
import RuntimeFields, { type RuntimeConfiguration } from './RuntimeFields.vue';
import ClientCredentials from './ClientCredentials.vue';
const props = defineProps<{ params: Record<string, unknown>; controller: ApplicationDialogController }>();
const id = String(props.params.applicationId || '');
const runtime = ref<RuntimeConfiguration>(), state = ref(''), sso = ref<any>(), redirect = ref(''), secret = ref(''), issuer = ref(''), error = ref(''), busy = ref(false), baseline = ref('');
const signature = () => JSON.stringify([runtime.value, redirect.value]);
const dirty = computed(() => !!baseline.value && baseline.value !== signature());
watch([busy, dirty], () => props.controller.setState({ busy: busy.value, dirty: dirty.value }));
const clear = props.controller.onBeforeClose(async () => {
  if (busy.value) return false; if (!dirty.value && !secret.value) return true;
  return ElMessageBox.confirm(secret.value ? '密钥关闭后不可再次查看，确定关闭吗？' : '配置尚未保存，确定关闭吗？', '关闭配置', { confirmButtonText: '关闭', cancelButtonText: '继续配置' }).then(() => true).catch(() => false);
});
onUnmounted(() => { secret.value = ''; clear(); });
async function load() {
  busy.value = true; error.value = '';
  try { const data = await request<any>(`/api/application-registrations/${id}`); runtime.value = data.runtime; state.value = data.state; issuer.value = data.issuer;
    sso.value = await request<any>(`/api/application-registrations/${id}/sso`, { method: 'POST', body: JSON.stringify({ action: 'status' }) });
    redirect.value = sso.value.redirectUris.join('\n'); baseline.value = signature();
  } catch (e) { error.value = (e as Error).message; } finally { busy.value = false; }
}
async function saveRuntime() {
  busy.value = true; error.value = '';
  try { await request(`/api/application-registry/${id}/runtime`, { method: 'PUT', body: JSON.stringify(runtime.value) }); desktop.applicationsChanged(); await load(); ElMessage.success('入口已更新'); }
  catch (e) { error.value = (e as Error).message; } finally { busy.value = false; }
}
async function credentials(rotate = false) {
  if (rotate) { try { await ElMessageBox.confirm('轮换后旧密钥及该客户端已签发的凭据将失效，确定继续吗？', '轮换客户端密钥', { confirmButtonText: '轮换', cancelButtonText: '取消', type: 'warning' }); } catch { return; } }
  busy.value = true; error.value = ''; secret.value = '';
  try { const data = await request<any>(`/api/application-registrations/${id}/sso`, { method: 'POST', body: JSON.stringify({ action: rotate ? 'rotate' : sso.value?.configured ? 'update' : 'create', requestId: crypto.randomUUID(), expectedRevision: sso.value?.revision, redirectUris: redirect.value.split('\n').map(s => s.trim()).filter(Boolean) }) });
    secret.value = data.clientSecret || ''; await load(); ElMessage.success('单点登录配置已保存');
  } catch (e) { error.value = (e as Error).message; } finally { busy.value = false; }
}
async function retry() {
  busy.value = true; error.value = '';
  try { const data = await request<any>(`/api/application-registrations/${id}/retry`, { method: 'POST', body: '{}' }); secret.value = data.credentials?.clientSecret || ''; issuer.value = data.issuer || ''; desktop.applicationsChanged(); await load(); }
  catch (e) { error.value = (e as Error).message; } finally { busy.value = false; }
}
onMounted(load);
</script>
<template>
  <el-alert v-if="error" :title="error" type="error" :closable="false" />
  <el-button v-if="!runtime" :icon="Refresh" :loading="busy" @click="load">重新加载</el-button>
  <template v-else>
    <ClientCredentials v-if="secret" :client-id="id" :issuer="issuer" :redirect-uri="redirect.split('\n')[0] || ''" :secret="secret" />
    <el-alert v-if="['pending','failed'].includes(state)" title="接入尚未完成，应用未开放。" type="warning" :closable="false" />
    <el-button v-if="['pending','failed'].includes(state)" :icon="Refresh" :loading="busy" @click="retry">重试接入</el-button>
    <el-tabs v-else>
      <el-tab-pane label="运行入口"><el-form label-position="top" :disabled="busy"><RuntimeFields :value="runtime" /></el-form><el-button type="primary" :icon="Check" :loading="busy" @click="saveRuntime">保存入口</el-button></el-tab-pane>
      <el-tab-pane label="单点登录"><el-form label-position="top" :disabled="busy"><el-form-item label="Client ID"><el-input :model-value="id" readonly /></el-form-item><el-form-item label="回调地址"><el-input v-model="redirect" type="textarea" :rows="4" aria-label="回调地址" /></el-form-item></el-form><el-button type="primary" :icon="Check" :loading="busy" @click="credentials()">{{ sso?.configured ? '保存回调' : '配置单点登录' }}</el-button><el-button v-if="sso?.configured" :icon="Key" :disabled="busy" @click="credentials(true)">轮换密钥</el-button></el-tab-pane>
    </el-tabs>
  </template>
  <footer><el-button :icon="Close" :disabled="busy" @click="controller.cancel()">关闭</el-button></footer>
</template>
<style scoped>footer{display:flex;justify-content:flex-end;margin-top:16px}:deep(.el-alert){margin-bottom:16px}:deep(.el-tabs){margin-top:16px}</style>
