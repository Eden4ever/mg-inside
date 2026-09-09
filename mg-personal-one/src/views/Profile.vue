<script setup lang="ts">
import { applicationPage } from '../application';
const pageConfig = applicationPage('profile');
import { PageFrame, PageHeading, ContentPanel } from '@mg-inside/frontend';
import { user } from '../session';
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import { desktop, platformSession } from '../desktop';
import { request } from '../api/client';
const exiting = ref(false);
async function logout() {
  if (exiting.value || !window.confirm('退出当前账号的统一登录会话？所有接入应用都需要重新登录。')) return;
  if (desktop.enabled) { desktop.requestLogout(); return; }
  exiting.value = true;
  try { await request('/auth/logout', { method: 'POST', body: '{}' }, desktop.origin); platformSession.clear(); desktop.login('/profile'); }
  catch (error) { ElMessage.error((error as Error).message); }
  finally { exiting.value = false; }
}
</script>
<template><PageFrame><template #header><PageHeading :title="pageConfig.title" :description="pageConfig.description"><template #actions><el-button type="danger" plain :loading="exiting" @click="logout">退出登录</el-button></template></PageHeading></template><ContentPanel><div class="profile-summary"><el-avatar :src="user?.avatarUrl || undefined" :alt="user?.name || '头像'" :size="64">{{ user?.name?.slice(0, 1) }}</el-avatar><div><h2>{{ user?.name }}</h2><p>{{ user?.username || '未设置账号' }}</p></div><el-tag type="success" effect="plain">已登录</el-tag></div><dl class="profile-details"><div><dt>姓名</dt><dd>{{ user?.name || '—' }}</dd></div><div><dt>账号</dt><dd>{{ user?.username || '—' }}</dd></div><div><dt>部门</dt><dd>{{ user?.departmentName || '—' }}</dd></div><div><dt>平台角色</dt><dd>{{ user?.role === 'system_admin' ? '平台管理员' : '普通用户' }}</dd></div><div><dt>认证方式</dt><dd>统一认证</dd></div></dl></ContentPanel><ContentPanel title="资料管理"><p class="muted">姓名、账号和部门由统一身份中心管理。需要调整时，请联系身份管理员。</p><p class="muted">各业务应用中的角色和数据访问范围，仍由对应业务应用管理。</p></ContentPanel></PageFrame></template>
