<script setup lang="ts">
import { computed } from 'vue';
import { Download } from '@element-plus/icons-vue';
const props = defineProps<{ clientId: string; issuer: string; redirectUri: string; secret: string }>();
const environment = computed(() => [['IDENTITY_ENABLED', 'true'], ['IDENTITY_ISSUER', props.issuer], ['IDENTITY_CLIENT_ID', props.clientId], ['IDENTITY_CLIENT_SECRET', props.secret], ['IDENTITY_REDIRECT_URI', props.redirectUri]].map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n');
function download() {
  const url = URL.createObjectURL(new Blob([environment.value], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `${props.clientId}.env`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
</script>
<template>
  <el-alert title="客户端密钥仅本次显示，关闭后不可再次查看。" type="warning" :closable="false" />
  <el-form label-position="top"><el-form-item label="Client ID"><el-input :model-value="clientId" readonly /></el-form-item><el-form-item label="Client Secret"><el-input :model-value="secret" readonly type="password" show-password aria-label="Client Secret" autocomplete="off" /></el-form-item></el-form>
  <el-button :icon="Download" @click="download">下载接入配置</el-button>
</template>
