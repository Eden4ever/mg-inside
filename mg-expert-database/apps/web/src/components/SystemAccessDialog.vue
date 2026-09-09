<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus, Refresh, Select } from '@element-plus/icons-vue';
import { api } from '@/api/client';
import type { IndicatorSystemSummary, SystemAccessEntry, SystemPermissions } from '@/types/domain';

const props = defineProps<{ modelValue: boolean; system: IndicatorSystemSummary | null }>();
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>();

// 平台角色标签由后端返回，前端不复制映射逻辑
type AccessEntry = SystemAccessEntry;

const loading = ref(false);
const error = ref('');
const entries = ref<AccessEntry[]>([]);
const savingUserId = ref('');
const addOpen = ref(false);
const adding = ref(false);
const addUserId = ref('');
const addRole = ref<'viewer' | 'editor' | 'manager'>('viewer');
const addError = ref('');
const members = computed(() => entries.value.filter(e => e.globalAdmin || e.isCreator || e.permissions.canView));
const candidates = computed(() => entries.value.filter(e => !e.globalAdmin && !e.isCreator && !e.permissions.canView));
function openAdd() {
  addUserId.value = ''; addRole.value = 'viewer'; addError.value = ''; addOpen.value = true;
}
async function addUser() {
  if (!props.system || adding.value) return;
  if (!addUserId.value) { addError.value = '请选择用户'; return; }
  adding.value = true; addError.value = '';
  try {
    await api.updateSystemAccess(props.system.id, addUserId.value, { systemRole: addRole.value });
    addOpen.value = false; await loadAccess(); ElMessage.success('用户已添加并授权');
  } catch (reason) {
    addError.value = reason instanceof Error ? reason.message : '添加失败';
  } finally { adding.value = false; }
}

const open = computed({ get: () => props.modelValue, set: (value) => emit('update:modelValue', value) });
const roleOptions = [{ value: 'viewer', label: '可查看' }, { value: 'editor', label: '可编辑' }, { value: 'manager', label: '可管理' }];
function roleFor(entry: AccessEntry) { return entry.systemRole || (entry.permissions.canManageCatalog ? 'manager' : entry.permissions.canResearch ? 'editor' : entry.permissions.canView ? 'viewer' : null); }

watch(() => [props.modelValue, props.system?.id], ([visible]) => {
  if (visible) void loadAccess();
}, { immediate: true });

async function loadAccess() {
  if (!props.system) return;
  loading.value = true;
  error.value = '';
  try {
    entries.value = (await api.listSystemAccess(props.system.id)).map((entry) => ({ ...entry, systemRole: roleFor(entry), permissions: { ...entry.permissions } }));
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '加载体系权限失败';
  } finally {
    loading.value = false;
  }
}

async function save(entry: SystemAccessEntry) {
  if (!props.system || entry.globalAdmin || entry.isCreator) return;
  if (!entry.systemRole) { ElMessage.warning('请选择体系权限'); return; }
  savingUserId.value = entry.userId;
  try {
    const result = await api.updateSystemAccess(props.system.id, entry.userId, { systemRole: entry.systemRole });
    entry.permissions = { ...result.permissions };
    ElMessage.success(`已保存“${entry.displayName}”的体系权限`);
  } catch (reason) {
    ElMessage.error(reason instanceof Error ? reason.message : '保存体系权限失败');
    await loadAccess();
  } finally {
    savingUserId.value = '';
  }
}

async function revoke(entry: SystemAccessEntry) {
  if (!props.system || entry.globalAdmin || entry.isCreator) return;
  try {
    await ElMessageBox.confirm(`确定移除“${entry.displayName}”对当前指标体系的全部权限？`, '移除体系权限', { type: 'warning', confirmButtonText: '移除', cancelButtonText: '取消' });
    savingUserId.value = entry.userId;
    const result = await api.deleteSystemAccess(props.system.id, entry.userId);
    entry.permissions = { ...result.permissions };
    entry.systemRole = null;
    ElMessage.success('体系权限已移除');
  } catch (reason) {
    if (reason !== 'cancel' && reason !== 'close') ElMessage.error(reason instanceof Error ? reason.message : '移除体系权限失败');
  } finally {
    savingUserId.value = '';
  }
}
</script>

<template>
  <el-dialog class="system-access-dialog" v-model="open" :title="system ? `权限管理 · ${system.name}` : '权限管理'" width="min(980px, 96vw)" destroy-on-close>
    <div class="access-intro">
      <div><strong>体系权限</strong><span>可管理包含可编辑、可查看；创建者和系统管理员可维护成员权限。</span></div>
      <div class="access-actions"><el-button :icon="Refresh" :loading="loading" @click="loadAccess">刷新</el-button><el-button type="primary" :icon="Plus" :disabled="loading || Boolean(error)" @click="openAdd">添加用户</el-button></div>
    </div>
    <el-alert v-if="error" type="error" :closable="false" show-icon class="access-error"><template #title>{{ error }}</template><el-button link type="primary" @click="loadAccess">重新加载</el-button></el-alert>
    <el-table v-loading="loading" :data="members" row-key="userId" height="100%" empty-text="暂无已授权用户">
      <el-table-column label="用户" min-width="180">
        <template #default="{ row }"><strong>{{ row.displayName }}</strong><small>{{ row.departmentName || row.username || '企业微信用户' }}</small></template>
      </el-table-column>
      <el-table-column label="平台角色" width="120"><template #default="{ row }"><el-tag size="small" effect="plain">{{ row.platformRoleLabel }}</el-tag></template></el-table-column>
      <el-table-column label="体系权限" min-width="170">
        <template #default="{ row }">
          <el-tag v-if="row.globalAdmin" type="success">系统管理员（最高权限）</el-tag>
          <el-tag v-else-if="row.isCreator">创建者</el-tag>
          <el-select v-else v-model="row.systemRole" :aria-label="row.displayName + '-体系权限'" placeholder="未授权">
            <el-option v-for="option in roleOptions" :key="option.value" :label="option.label" :value="option.value" />
          </el-select>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="142" fixed="right">
        <template #default="{ row }">
          <el-tag v-if="row.globalAdmin || row.isCreator" type="success" size="small">全部权限</el-tag>
          <template v-else><el-button link type="primary" :icon="Select" :loading="savingUserId === row.userId" @click="save(row)">保存</el-button><el-button link type="danger" :disabled="savingUserId === row.userId || !row.permissions.canView" @click="revoke(row)">移除</el-button></template>
        </template>
      </el-table-column>
    </el-table>
    <el-dialog v-model="addOpen" title="添加用户" width="480px" append-to-body :close-on-click-modal="false" :close-on-press-escape="!adding" :show-close="!adding">
      <el-alert v-if="addError" :title="addError" type="error" :closable="false" />
      <el-form label-position="top" :disabled="adding">
        <el-form-item label="选择用户" required><el-select v-model="addUserId" filterable placeholder="搜索姓名或账号" no-data-text="没有待添加用户"><el-option v-for="user in candidates" :key="user.userId" :value="user.userId" :label="user.displayName + (user.username ? ' · ' + user.username : '')" /></el-select></el-form-item>
        <el-form-item label="体系权限" required><el-select v-model="addRole"><el-option v-for="option in roleOptions" :key="option.value" :value="option.value" :label="option.label" /></el-select></el-form-item>
      </el-form>
      <template #footer><el-button :disabled="adding" @click="addOpen = false">取消</el-button><el-button type="primary" :loading="adding" @click="addUser">添加并授权</el-button></template>
    </el-dialog>
    <template #footer><el-button @click="open = false">关闭</el-button></template>
  </el-dialog>
</template>

<style scoped>
.access-actions { display:flex; gap:8px; flex-shrink:0; }
.access-intro { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding-bottom: 14px; }
.access-intro strong, .access-intro span, .el-table strong, .el-table small { display: block; }
.access-intro span, .el-table small { margin-top: 3px; color: var(--el-text-color-secondary); font-size: 12px; }
.access-error { margin-bottom: 12px; }
</style>
