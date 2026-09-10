<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Refresh, Search } from '@element-plus/icons-vue';
import { api, type Application, type ApplicationAccess, type ManagedRole, type ManagedUser } from '../api/client';
const route = useRoute(), router = useRouter();
const mode = ref<'user' | 'role'>('user'), users = ref<ManagedUser[]>([]), roles = ref<ManagedRole[]>([]), apps = ref<Application[]>([]);
const selected = ref(''), loading = ref(false), saving = ref(false), error = ref(''), query = ref(''), accesses = ref<ApplicationAccess[]>([]);
const roleDialog = ref(false), chosenRoles = ref<string[]>([]);
const initialized = ref(false);
const currentUser = computed(() => users.value.find(u => u.id === selected.value));
const currentRole = computed(() => roles.value.find(r => r.id === selected.value));
const choices = computed(() => mode.value === 'user' ? users.value.map(u => ({ id: u.id, label: `${u.displayName}${u.status === 'active' ? '' : '（已停用）'}` })) : roles.value.map(r => ({ id: r.id, label: r.name })));
const rows = computed<ApplicationAccess[]>(() => (mode.value === 'user' ? accesses.value : apps.value.map(app => ({ clientId: app.clientId, name: app.name, enabled: app.enabled, foundation: app.foundation, direct: Boolean(currentRole.value?.applications.some(a => a.clientId === app.clientId && a.enabled)), sources: [], effective: false, localUserId: null })))
  .filter(app => !app.foundation && `${app.name} ${app.clientId}`.toLowerCase().includes(query.value.toLowerCase())));
let requestId = 0;
async function loadAccess() { const id = ++requestId, subject = selected.value; accesses.value = []; if (mode.value === 'user' && subject) { const result = await api.userApplications(subject); if (id === requestId) accesses.value = result; } }
async function load() {
  loading.value = true; error.value = '';
  try { [users.value, roles.value, apps.value] = await Promise.all([api.users(), api.roles(), api.applications()]);
    if (!choices.value.some(c => c.id === selected.value)) selected.value = choices.value[0]?.id || '';
    initialized.value = true;
    await loadAccess();
  } catch (e) { error.value = (e as Error).message; } finally { loading.value = false; }
}
watch([mode, selected], async () => { if (!initialized.value) return; if (!choices.value.some(c => c.id === selected.value)) selected.value = choices.value[0]?.id || ''; try { await loadAccess(); } catch (e) { error.value = (e as Error).message; } });
async function toggle(row: ApplicationAccess) {
  if (saving.value) return;
  const subject = selected.value, perspective = mode.value;
  try {
    if (row.direct) await ElMessageBox.confirm(`撤销对“${row.name}”的${perspective === 'user' ? '用户直接' : '角色'}授权？其他授权来源仍会继续生效。`, '撤销授权', { type: 'warning' });
    saving.value = true;
    if (perspective === 'user') await api.grant(row.clientId, subject, row.localUserId, !row.direct);
    else await api.roleGrant(subject, row.clientId, !row.direct);
    await load(); ElMessage.success('授权已更新，后续访问校验立即生效');
  } catch (e) { if (e !== 'cancel' && e !== 'close') ElMessage.error((e as Error).message); } finally { saving.value = false; }
}
function editRoles() { chosenRoles.value = roles.value.filter(r => r.members.some(m => m.userId === selected.value)).map(r => r.id); roleDialog.value = true; }
async function saveRoles() { if (saving.value) return; saving.value = true; try { await api.userRoles(selected.value, chosenRoles.value); roleDialog.value = false; await load(); ElMessage.success('用户角色已更新'); } catch (e) { ElMessage.error((e as Error).message); } finally { saving.value = false; } }
onMounted(async () => { if (typeof route.query.role === 'string') { mode.value = 'role'; selected.value = route.query.role; } else if (typeof route.query.user === 'string') selected.value = route.query.user; await load(); });
</script>

<template><div class="primary-page users-page" v-loading="loading">
  <div class="primary-page-heading"><div><h1>应用授权</h1><p>按用户或角色分配访问权限。有效授权包含用户、角色和管理范围授权。</p></div><el-button :icon="Refresh" @click="load">刷新</el-button></div>
  <el-alert v-if="error" :title="error" type="error" :closable="false" />
  <div class="authorization-subject"><el-radio-group v-model="mode" aria-label="授权管理视角" :disabled="saving"><el-radio-button value="user">用户</el-radio-button><el-radio-button value="role">角色</el-radio-button></el-radio-group>
    <el-select v-model="selected" filterable :disabled="saving" :aria-label="mode === 'user' ? '选择用户' : '选择角色'" :placeholder="mode === 'user' ? '选择用户' : '选择角色'"><el-option v-for="choice in choices" :key="choice.id" :value="choice.id" :label="choice.label" /></el-select>
    <el-button v-if="mode === 'user' && currentUser" @click="editRoles">分配角色</el-button><el-button v-if="mode === 'role'" @click="router.push('/roles')">管理角色和成员</el-button>
  </div>
  <p v-if="mode === 'user' && currentUser" class="authorization-summary">{{ currentUser.displayName }} 的角色：{{ currentUser.roles?.map(r => r.name+(r.key === 'platform-admin'?'（内置）':'')).join('、') || '未分配' }}。</p>
  <p v-else-if="currentRole" class="authorization-summary">{{ currentRole.name }} · {{ currentRole.members.length }} 位成员。{{ currentRole.key === 'platform-admin' ? '内置平台管理角色，应用访问仍需明确授权。' : '角色提供应用访问授权。' }}</p>
  <section v-if="selected" class="table-wrap table-panel"><div class="users-list-toolbar table-toolbar"><el-input v-model="query" :prefix-icon="Search" clearable placeholder="搜索应用" aria-label="搜索应用" /><span class="count">{{ rows.length }} 个应用</span></div>
    <el-table :data="rows" height="100%"><el-table-column label="应用" min-width="160"><template #default="{row}"><strong>{{ row.name }}</strong><small class="subtext">{{ row.clientId }}</small></template></el-table-column>
      <el-table-column :label="mode === 'user' ? '用户直接授权' : '角色授权'" width="145"><template #default="{row}"><el-switch :model-value="row.direct" :disabled="saving || !row.enabled || (mode==='role'&&['division-admin','organization-admin'].includes(currentRole?.key||''))" :aria-label="`${row.name}${mode === 'user' ? '直接授权' : '角色授权'}`" @change="toggle(row)" /></template></el-table-column>
      <el-table-column v-if="mode === 'user'" label="有效来源" min-width="230"><template #default="{row}"><div class="authorization-sources"><el-tag v-for="source in row.sources" :key="source.scopeId || source.roleId || 'user'" size="small" effect="plain">{{ source.type === 'user' ? '用户直接授权' : `${source.type==='scope'?'管理范围':'角色'}：${source.name}` }}</el-tag><span v-if="!row.sources.length">无授权来源</span></div></template></el-table-column>
      <el-table-column label="访问状态" width="130"><template #default="{row}"><el-tag :type="(mode === 'user' ? row.effective : row.direct && row.enabled) ? 'success' : 'info'" effect="plain">{{ !row.enabled ? '应用已停用' : mode === 'user' ? (row.effective ? '允许访问' : '无有效授权') : row.direct ? '已授予角色' : '未授权' }}</el-tag></template></el-table-column>
      <el-table-column v-if="mode === 'user'" label="历史账号映射" min-width="150"><template #default="{row}"><span :title="row.localUserId || '新用户由业务应用自动建立身份'">{{ row.localUserId || '中心自动同步' }}</span></template></el-table-column>
    </el-table>
  </section><el-empty v-else :description="mode === 'role' ? '请先创建角色' : '暂无用户'" />
  <p class="authorization-summary">个人中心和文件为默认应用，登录后可用，无需分配。应用管理等系统应用与内部应用均需明确授权；桌面仅承载登录和应用入口。</p>
  <el-dialog v-model="roleDialog" title="分配用户角色" width="520px" :close-on-click-modal="false"><p>一个用户可以属于多个角色；平台管理能力与应用访问授权统一通过角色维护。</p><el-select v-model="chosenRoles" multiple filterable class="full-width" aria-label="用户角色"><el-option v-for="role in roles" :key="role.id" :value="role.id" :label="role.name+(role.key==='platform-admin'?'（内置）':'')" /></el-select><template #footer><el-button @click="roleDialog=false">取消</el-button><el-button type="primary" :loading="saving" @click="saveRoles">保存角色</el-button></template></el-dialog>
</div></template>
<style scoped>.authorization-subject{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.authorization-subject .el-select{width:260px}.authorization-summary{color:var(--text-secondary,#66758a);font-size:13px;margin:14px 0;line-height:1.7}.authorization-sources{display:flex;gap:6px;flex-wrap:wrap}</style>
