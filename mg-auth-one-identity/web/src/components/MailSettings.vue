<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api, type MailSettings } from '@/api/client';
import { useCloseProtection } from '../use-close-protection';
const form = ref<MailSettings>({ enabled: false, host: '', port: 465, security: 'tls', username: '', fromAddress: '', fromName: '元引统一认证', revision: 0, hasPassword: false });
const password = ref(''); const recipient = ref(''); const loaded = ref(false); const busy = ref(false); const error = ref(''); const result = ref(''); const saved = ref('');
const dirty = computed(() => Boolean(password.value) || JSON.stringify(form.value) !== saved.value);
useCloseProtection(computed(() => loaded.value && dirty.value), busy);
const canTest = computed(() => loaded.value && !busy.value && form.value.enabled && !dirty.value && Boolean(recipient.value.trim()));
async function load() {
  try { form.value = await api.mailSettings(); saved.value = JSON.stringify(form.value); loaded.value = true; }
  catch (e) { error.value = e instanceof Error ? e.message : '读取失败'; }
}
async function save() {
  if (!loaded.value || busy.value) return;
  busy.value = true; error.value = ''; result.value = '';
  try { const { hasPassword, ...input } = form.value; form.value = await api.saveMailSettings({ ...input, ...(password.value ? { password: password.value } : {}) }); password.value = ''; saved.value = JSON.stringify(form.value); ElMessage.success('邮件配置已保存'); }
  catch (e) { error.value = e instanceof Error ? e.message : '保存失败'; }
  finally { busy.value = false; }
}
async function test() {
  if (!canTest.value) return;
  busy.value = true; error.value = ''; result.value = '';
  try { result.value = (await api.testMailSettings(recipient.value.trim())).message; }
  catch (e) { error.value = e instanceof Error ? e.message : '发送失败'; }
  finally { busy.value = false; }
}
onMounted(load);
</script>
<template>
  <div class="mail-settings">
    <div class="primary-page-scroll mail-body">
      <el-alert v-if="error" :title="error" type="error" :closable="false" />
      <el-card shadow="never">
        <template #header>SMTP 发信服务</template>
        <el-form label-width="110px" :disabled="!loaded || busy" @submit.prevent="save">
          <el-form-item label="启用"><el-switch v-model="form.enabled" /></el-form-item>
          <el-form-item label="服务器"><el-input v-model="form.host" placeholder="smtp.example.com" maxlength="253" /></el-form-item>
          <el-form-item label="传输加密"><el-select v-model="form.security" @change="form.port = form.security === 'tls' ? 465 : 587"><el-option label="TLS" value="tls" /><el-option label="STARTTLS" value="starttls" /></el-select></el-form-item>
          <el-form-item label="端口"><el-select v-model="form.port"><el-option v-for="port in form.security === 'tls' ? [465] : [587, 25]" :key="port" :label="String(port)" :value="port" /></el-select></el-form-item>
          <el-form-item label="SMTP 账号"><el-input v-model="form.username" autocomplete="off" maxlength="254" /></el-form-item>
          <el-form-item label="密码 / 授权码"><el-input v-model="password" type="password" show-password autocomplete="new-password" maxlength="2048" :placeholder="form.hasPassword ? '已配置，留空保留原密码' : '请输入密码或授权码'" /></el-form-item>
          <el-form-item label="发件邮箱"><el-input v-model="form.fromAddress" type="email" maxlength="254" /></el-form-item>
          <el-form-item label="发件人名称"><el-input v-model="form.fromName" maxlength="100" /></el-form-item>
          <el-form-item><el-button type="primary" :loading="busy" @click="save">保存配置</el-button></el-form-item>
        </el-form>
      </el-card>
      <el-card shadow="never">
        <template #header>测试发送</template>
        <el-form label-width="110px" @submit.prevent="test">
          <el-form-item label="收件邮箱"><el-input v-model="recipient" type="email" maxlength="254" placeholder="填写测试收件邮箱" /></el-form-item>
          <el-form-item><el-button :loading="busy" :disabled="!canTest" @click="test">发送测试邮件</el-button></el-form-item>
        </el-form>
        <el-alert v-if="result" :title="result" type="success" :closable="false" />
        <p class="hint">修改后请先保存。每分钟可测试一次，邮件不包含账号凭据。</p>
      </el-card>
    </div>
  </div>
</template>
<style scoped>
.mail-body { display: flex; flex-direction: column; gap: 16px; }
.mail-body > .el-card { flex-shrink: 0; width: 100%; }
.hint { color: var(--el-text-color-secondary); font-size: 13px; }
.el-select { width: 100%; }
</style>

