<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus, Refresh, RefreshRight } from '@element-plus/icons-vue';
import { api } from '@/api/client';
import { identityEndpoint } from '@/api/identity';
import type { ManagedUser, UserRole, WeComSyncStatus } from '@/types/domain';

const props = defineProps<{ currentUserId: string }>();
const emit = defineEmits<{ expired: [] }>();
const users = ref<ManagedUser[]>([]);
const loading = ref(false);
const identityManaged = ref(true);
const dialogVisible = ref(false);
const editing = ref<ManagedUser | null>(null);
const saving = ref(false);
const syncing = ref(false);
const syncStatus = ref<WeComSyncStatus | null>(null);
const form = reactive<{ username: string; displayName: string; departmentName: string; password: string; role: UserRole }>({ username: '', displayName: '', departmentName: '', password: '', role: 'reader' });
const roles: Array<{ value: UserRole; label: string }> = [
  { value: 'system_admin', label: '系统管理员' }, { value: 'catalog_manager', label: '指标管理员' }, { value: 'researcher', label: '研究员' },
  { value: 'reviewer', label: '审核员' }, { value: 'publisher', label: '发布员' }, { value: 'reader', label: '普通用户' },
];
const roleLabel = (role: string) => roles.find((item) => item.value === role)?.label || role;
const dateText = (value: string | null) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '从未登录';

async function load() { loading.value = true; try { users.value = await api.listUsers(); } catch (error) { ElMessage.error(error instanceof Error ? error.message : '加载用户失败'); } finally { loading.value = false; } }
async function loadSyncStatus() { try { syncStatus.value = await api.getWeComSyncStatus(); } catch { syncStatus.value = null; } }
async function syncWeCom() {
  try {
    await ElMessageBox.confirm('从企业微信应用可见范围同步成员？新成员将以普通用户创建，现有角色和启停状态不会被覆盖。', '同步企业微信成员', { type: 'info', confirmButtonText: '开始同步' });
    syncing.value = true;
    const result = await api.syncWeComUsers();
    await Promise.all([load(), loadSyncStatus()]);
    ElMessage.success(`同步完成：读取 ${result.total} 人，新增 ${result.created}，更新 ${result.updated}，绑定 ${result.bound}${result.conflicts ? `，跳过冲突 ${result.conflicts}` : ''}`);
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '企业微信同步失败');
  } finally {
    syncing.value = false;
  }
}
function openCreate() { editing.value = null; Object.assign(form, { username: '', displayName: '', departmentName: '', password: '', role: 'reader' }); dialogVisible.value = true; }
function openEdit(user: ManagedUser) { editing.value = user; Object.assign(form, { username: user.username || '', displayName: user.displayName, departmentName: user.departmentName || '', password: '', role: user.role }); dialogVisible.value = true; }
async function save() {
  if (!form.displayName.trim() || (!editing.value && (!form.username.trim() || form.password.length < 10))) return ElMessage.warning('请完整填写账号、姓名和不少于 10 位的初始密码');
  saving.value = true;
  try {
    if (editing.value) await api.updateUser(editing.value.id, identityManaged.value ? { role: form.role } : { displayName: form.displayName, departmentName: form.departmentName, role: form.role });
    else await api.createUser({ ...form });
    dialogVisible.value = false; await load(); ElMessage.success(editing.value ? '用户信息已更新' : '用户已创建');
  } catch (error) { ElMessage.error(error instanceof Error ? error.message : '保存用户失败'); } finally { saving.value = false; }
}
async function toggleStatus(user: ManagedUser) {
  const target = user.status === 'active' ? 'disabled' : 'active';
  try { await ElMessageBox.confirm(target === 'disabled' ? `停用“${user.displayName}”并注销其全部会话？` : `启用“${user.displayName}”？`, '账号状态', { type: 'warning' }); await api.updateUser(user.id, { status: target }); await load(); ElMessage.success(target === 'disabled' ? '账号已停用' : '账号已启用'); } catch (error) { if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '操作失败'); }
}
async function resetPassword(user: ManagedUser) {
  try { const result = await ElMessageBox.prompt('请输入不少于 10 位的新密码。重置后该用户全部会话将失效。', `重置 ${user.displayName} 的密码`, { inputType: 'password', inputValidator: (value) => value.length >= 10 || '密码至少 10 位' }); await api.resetPassword(user.id, result.value); ElMessage.success('密码已重置'); if (user.id === props.currentUserId) emit('expired'); } catch (error) { if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '重置失败'); }
}
async function bindWeCom(user: ManagedUser) {
  try { const result = await ElMessageBox.prompt('请输入企业微信管理后台中的成员 UserID。', `绑定 ${user.displayName} 的企业微信`, { inputValidator: (value) => Boolean(value.trim()) || 'UserID 不能为空' }); await api.bindWeCom(user.id, result.value); await load(); ElMessage.success('企业微信身份已绑定'); } catch (error) { if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '绑定失败'); }
}
async function unbindWeCom(user: ManagedUser) {
  const identity = user.wecomIdentities[0]; if (!identity) return;
  try { await ElMessageBox.confirm(`解除企业微信 UserID“${identity.externalUserId}”的绑定？该用户现有会话将全部失效。`, '解除绑定', { type: 'warning' }); await api.unbindWeCom(user.id, identity.id); await load(); ElMessage.success('企业微信身份已解绑'); } catch (error) { if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '解绑失败'); }
}
onMounted(async () => {
  try { const response = await fetch(identityEndpoint('status')); if (response.ok) identityManaged.value = (await response.json()).enabled === true; } catch {}
  await load(); if (!identityManaged.value) await loadSyncStatus();
});
</script>

<template>
  <main class="users-page primary-page">
    <div class="users-content primary-page-layout">
      <div class="users-toolbar primary-page-heading">
        <div class="users-title"><h1>用户管理</h1></div>
        <div class="toolbar-actions primary-page-actions"><el-button :icon="Refresh" aria-label="刷新用户列表" title="刷新用户列表" @click="load">刷新</el-button><el-button v-if="!identityManaged" :icon="RefreshRight" :loading="syncing || syncStatus?.running" @click="syncWeCom">同步企业微信</el-button><el-button v-if="!identityManaged" type="primary" :icon="Plus" @click="openCreate">新建用户</el-button></div>
      </div>
      <p v-if="identityManaged">账号资料和访问状态由统一认证中心同步，每分钟更新。<a href="https://identity.meta-gravity.com/admin" target="_blank" rel="noopener">管理统一身份与应用授权</a></p>
      <div class="table-wrap" tabindex="0" role="region" aria-label="用户列表">
        <div class="users-list-toolbar"><span>共 {{ users.length }} 位用户</span><span v-if="syncStatus?.enabled">企业微信每 {{ syncStatus.intervalMinutes }} 分钟自动同步</span></div>
        <el-table v-loading="loading" :data="users" height="100%" row-key="id" empty-text="暂无用户">
          <el-table-column label="用户" min-width="180"><template #default="{ row }"><strong>{{ row.displayName }}</strong><div class="subtext">{{ row.username || '仅企业微信' }}<span v-if="row.departmentName"> · {{ row.departmentName }}</span></div></template></el-table-column>
          <el-table-column label="平台角色" width="120"><template #default="{ row }">{{ roleLabel(row.role) }}</template></el-table-column>
          <el-table-column label="状态" width="90"><template #default="{ row }"><el-tag :type="row.status === 'active' ? 'success' : 'info'" effect="plain">{{ row.status === 'active' ? '启用' : '停用' }}</el-tag></template></el-table-column>
          <el-table-column v-if="!identityManaged" label="企业微信" min-width="170"><template #default="{ row }"><span v-if="row.wecomIdentities.length">{{ row.wecomIdentities[0].externalUserId }}</span><span v-else class="subtext">未绑定</span></template></el-table-column>
          <el-table-column label="最近登录" min-width="170"><template #default="{ row }">{{ dateText(row.lastLoginAt) }}</template></el-table-column>
          <el-table-column label="操作" width="300"><template #default="{ row }"><el-button link type="primary" @click="openEdit(row)">编辑</el-button><el-button v-if="!identityManaged" link type="primary" @click="resetPassword(row)">重置密码</el-button><el-button v-if="!identityManaged" link type="primary" @click="row.wecomBound ? unbindWeCom(row) : bindWeCom(row)">{{ row.wecomBound ? '解绑企业微信' : '绑定企业微信' }}</el-button><el-button v-if="!identityManaged" link :type="row.status === 'active' ? 'danger' : 'success'" @click="toggleStatus(row)">{{ row.status === 'active' ? '停用' : '启用' }}</el-button></template></el-table-column>
        </el-table>
      </div>
    </div>
    <el-dialog v-model="dialogVisible" :title="editing ? '编辑用户' : '新建用户'" width="480px">
      <el-form label-position="top">
        <el-form-item label="登录账号"><el-input v-model="form.username" :disabled="Boolean(editing)" placeholder="字母、数字及 ._-" /></el-form-item>
        <el-form-item label="姓名"><el-input v-model="form.displayName" :disabled="identityManaged" /></el-form-item>
        <el-form-item label="部门"><el-input v-model="form.departmentName" :disabled="identityManaged" /></el-form-item>
        <el-form-item label="平台角色"><el-select v-model="form.role" class="full-width"><el-option v-for="role in roles" :key="role.value" :label="role.label" :value="role.value" /></el-select></el-form-item>
        <el-form-item v-if="!editing" label="初始密码"><el-input v-model="form.password" type="password" show-password autocomplete="new-password" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="dialogVisible = false">取消</el-button><el-button type="primary" :loading="saving" @click="save">保存</el-button></template>
    </el-dialog>
  </main>
</template>

<style scoped>
.users-page { height: 100%; min-height: 0; padding: var(--app-space-5); overflow-y: auto; background: var(--el-fill-color-lighter); }
.users-content { width: 100%; max-width: 1400px; margin: 0 auto; display: flex; flex-direction: column; gap: var(--app-space-4); }
.users-toolbar { display: flex; justify-content: space-between; align-items: flex-end; gap: var(--app-space-5); }
.users-title { display: flex; flex-direction: column; gap: var(--app-space-1); }
.users-title h1 { margin: 0; padding-top: var(--app-space-2); font-size: 20px; letter-spacing: 0; }
.users-title p { margin: 0; color: var(--el-text-color-secondary); }
.toolbar-actions { display: flex; gap: var(--app-space-2); }
.table-wrap { border: 1px solid var(--el-border-color-lighter); background: var(--el-bg-color); overflow-x: auto; }
.table-wrap:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
.subtext { color: var(--el-text-color-secondary); font-size: 12px; padding-top: var(--app-space-1); }
.full-width { width: 100%; }
@media (max-width: 760px) { .users-page { padding: var(--app-space-3); }.users-toolbar { align-items: flex-start; flex-direction: column; }.toolbar-actions { width: 100%; justify-content: flex-end; } }
</style>
