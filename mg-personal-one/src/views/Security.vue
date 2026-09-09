<script setup lang="ts">
import { applicationPage } from '../application';
const pageConfig = applicationPage('security');
import { reactive, ref, watch, onUnmounted } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import { ElMessage } from 'element-plus';
import { PageFrame, PageHeading, ContentPanel } from '@mg-inside/frontend';
import AccountSecurity from '../components/AccountSecurity.vue';
import { api } from '../api/client';
import { desktop, setLeaveGuard, canLeave } from '../desktop';
const password = reactive({ current: '', next: '', confirm: '' }), busy = ref(false);
const dirty = () => Boolean(password.current || password.next || password.confirm);
watch(password, () => desktop.setState({ dirty: dirty(), busy: busy.value }));
watch(busy, () => desktop.setState({ dirty: dirty(), busy: busy.value }));
const clearLeaveGuard = setLeaveGuard(() => !busy.value && (!dirty() || window.confirm('密码尚未提交，离开将清空已输入内容。确定离开吗？')), () => busy.value || dirty());
onBeforeRouteLeave(canLeave);
onUnmounted(clearLeaveGuard);
async function save() {
  if (busy.value) return;
  if (password.next.length < 15) return ElMessage.warning('新密码至少 15 位');
  if (password.next !== password.confirm) return ElMessage.warning('两次新密码不一致');
  busy.value = true;
  try { await api.changePassword(password.current, password.next); ElMessage.success('密码已更新，其他设备的登录会话已撤销'); }
  catch (error) { ElMessage.error((error as Error).message); }
  finally { password.current = ''; password.next = ''; password.confirm = ''; busy.value = false; }
}
</script>
<template><PageFrame><template #header><PageHeading :title="pageConfig.title" :description="pageConfig.description" /></template><ContentPanel title="登录密码"><el-form label-position="top" class="password-form" @submit.prevent="save"><el-form-item label="当前密码"><el-input v-model="password.current" type="password" show-password autocomplete="current-password" maxlength="128" :disabled="busy" /></el-form-item><div class="form-grid"><el-form-item label="新密码"><el-input v-model="password.next" type="password" show-password autocomplete="new-password" placeholder="至少 15 位字符" maxlength="128" :disabled="busy" /></el-form-item><el-form-item label="确认新密码"><el-input v-model="password.confirm" type="password" show-password autocomplete="new-password" maxlength="128" :disabled="busy" /></el-form-item></div><el-button type="primary" native-type="submit" :loading="busy" :disabled="!password.current || !password.next">更新密码</el-button></el-form></ContentPanel><AccountSecurity /></PageFrame></template>
