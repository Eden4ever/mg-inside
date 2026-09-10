<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { Plus, Refresh, Search } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api, type Division } from '../api/client';
import { descendantIds, divisionTree, divisionTypes } from '../division-tree';
const rows = ref<Division[]>([]), query = ref(''), loading = ref(false), error = ref(''), dialog = ref(false), editing = ref<Division|null>(null), saving = ref(false);
const form = reactive({ name:'', code:'', type:'province', parentId:null as string|null, standard:true, enabled:true, officialIds:[] as string[] });
const tree = computed(() => divisionTree(rows.value, query.value));
const excluded = computed(() => editing.value ? descendantIds(rows.value, editing.value.id) : new Set<string>());
const parents = computed(() => divisionTree(rows.value).map(function mark(node): typeof node & { disabled:boolean } { return { ...node, disabled:excluded.value.has(node.id) || !node.enabled || node.level >= 6, children:node.children.map(mark) }; }));
const officialChoices = computed(() => rows.value.filter(row => row.standard && row.type !== 'functional_zone' && row.id !== editing.value?.id));
watch(() => form.type, value => { if (value === 'functional_zone') form.standard = false; else form.officialIds = []; });
async function load() { loading.value = true; error.value = ''; try { rows.value = await api.divisions(); } catch (e) { error.value = (e as Error).message; } finally { loading.value = false; } }
function edit(row?:Division, parent?:Division) {
  editing.value = row || null;
  Object.assign(form, row ? { name:row.name, code:row.code, type:row.type, parentId:row.parentId, standard:row.standard, enabled:row.enabled, officialIds:row.managedDivisions.map(item => item.officialId) }
    : { name:'', code:'', type:parent ? ({1:'city',2:'district',3:'town',4:'village'}[parent.level] || 'village') : 'province', parentId:parent?.id || null, standard:true, enabled:true, officialIds:[] });
  dialog.value = true;
}
async function save() {
  if (saving.value) return;
  if (!form.name.trim() || !form.code.trim()) return ElMessage.warning('请填写区划名称和编码');
  saving.value = true;
  try { if (editing.value) await api.updateDivision(editing.value.id, {...form}); else await api.createDivision({...form}); dialog.value = false; await load(); ElMessage.success('行政区划已保存'); }
  catch (e) { ElMessage.error((e as Error).message); } finally { saving.value = false; }
}
async function toggle(row:Division) {
  if (saving.value || loading.value) return;
  saving.value = true;
  try { await ElMessageBox.confirm(`${row.enabled?'停用':'启用'}“${row.name}”？`, '调整区划状态', {type:'warning'}); await api.updateDivision(row.id,{enabled:!row.enabled}); await load(); }
  catch (e) { if (e !== 'cancel' && e !== 'close') ElMessage.error((e as Error).message); } finally { saving.value = false; }
}
async function remove(row:Division) {
  if (saving.value || loading.value) return;
  saving.value = true;
  try { await ElMessageBox.confirm(`删除“${row.name}”？此操作不可恢复。`, '删除行政区划', {type:'warning'}); await api.removeDivision(row.id); await load(); }
  catch (e) { if (e !== 'cancel' && e !== 'close') ElMessage.error((e as Error).message); } finally { saving.value = false; }
}
function mappingNames(row:Division) { return row.managedDivisions.map(item => rows.value.find(d => d.id === item.officialId)?.name || item.officialId).join('、'); }
onMounted(load);
</script>
<template>
  <div class="primary-page users-page geography-page">
    <div class="primary-page-heading"><h1>行政区划管理</h1><div class="primary-page-actions"><el-tooltip content="刷新"><el-button :icon="Refresh" aria-label="刷新区划" :disabled="loading||saving" @click="load"/></el-tooltip><el-button type="primary" :icon="Plus" :disabled="loading||saving||!!error" @click="edit()">新增区划</el-button></div></div>
    <el-alert v-if="error" :title="error" type="error" :closable="false"/>
    <section class="table-wrap table-panel"><div class="users-list-toolbar table-toolbar"><el-input v-model="query" :prefix-icon="Search" clearable placeholder="搜索区划名称或编码" aria-label="搜索区划"/><span class="count">共 {{rows.length}} 个区划</span></div>
      <el-table :key="query.trim()" v-loading="loading" :data="tree" height="100%" row-key="id" :default-expand-all="!!query.trim()">
        <el-table-column label="区划名称" min-width="240"><template #default="{row}"><span>{{row.name}}</span><div v-if="row.type==='functional_zone'" class="subtext">托管：{{mappingNames(row)||'未关联'}}</div></template></el-table-column>
        <el-table-column prop="code" label="区划编码" min-width="150"/><el-table-column label="类型" width="100"><template #default="{row}">{{divisionTypes[row.type]}}</template></el-table-column>
        <el-table-column label="编码来源" width="115"><template #default="{row}"><el-tag :type="row.standard?'success':'warning'" effect="plain">{{row.standard?'国家标准':'自定义扩展'}}</el-tag></template></el-table-column>
        <el-table-column prop="level" label="层级" width="65"/><el-table-column label="状态" width="90"><template #default="{row}"><el-switch :model-value="row.enabled" :disabled="loading||saving" :aria-label="`${row.name}状态`" @change="toggle(row)"/></template></el-table-column>
        <el-table-column label="操作" width="310"><template #default="{row}"><el-button link type="primary" :disabled="loading||saving||!row.enabled||row.level>=6" @click="edit(undefined,row)">新增下级</el-button><el-button link type="primary" :disabled="loading||saving" @click="edit(row)">编辑</el-button><router-link :to="{path:'/scopes',query:{kind:'division',id:row.id}}" class="text-link">应用权限</router-link><el-button link type="danger" :disabled="loading||saving||!!(row._count?.children||row._count?.organizations||row._count?.hostingZones)" @click="remove(row)">删除</el-button></template></el-table-column>
        <template #empty><el-empty :description="error?'区划加载失败':query?'没有匹配的区划':'暂无行政区划'" :image-size="70"/></template>
      </el-table>
    </section>
    <el-dialog v-model="dialog" :title="editing?'编辑区划':'新增区划'" width="600px" :close-on-click-modal="false" :close-on-press-escape="!saving" :show-close="!saving">
      <el-form label-position="top" :disabled="saving" @submit.prevent="save">
        <el-form-item label="上级区划"><el-tree-select v-model="form.parentId" :data="parents" node-key="id" check-strictly filterable clearable :value-on-clear="null" placeholder="无（根区划）" aria-label="上级区划" class="full-width"/></el-form-item>
        <div class="form-grid"><el-form-item label="区划名称" required><el-input v-model="form.name" maxlength="100" aria-label="区划名称"/></el-form-item><el-form-item label="区划编码" required><el-input v-model="form.code" maxlength="32" aria-label="区划编码"/></el-form-item></div>
        <el-form-item label="区划类型" required><el-select v-model="form.type" aria-label="区划类型" class="full-width"><el-option v-for="(label,value) in divisionTypes" :key="value" :label="label" :value="value"/></el-select></el-form-item>
        <el-form-item v-if="form.type==='functional_zone'" label="托管国标区划"><el-select v-model="form.officialIds" multiple filterable clearable aria-label="托管国标区划" class="full-width"><el-option v-for="item in officialChoices" :key="item.id" :label="`${item.name}（${item.code}）`" :value="item.id" :disabled="!item.enabled"/></el-select></el-form-item>
        <el-form-item label="编码来源"><el-radio-group v-model="form.standard" :disabled="form.type==='functional_zone'"><el-radio-button :value="true">国家标准</el-radio-button><el-radio-button :value="false">自定义扩展</el-radio-button></el-radio-group></el-form-item>
        <el-form-item label="状态"><el-switch v-model="form.enabled" active-text="启用" inactive-text="停用" aria-label="区划启用状态"/></el-form-item>
      </el-form><template #footer><el-button :disabled="saving" @click="dialog=false">取消</el-button><el-button type="primary" :loading="saving" @click="save">保存</el-button></template>
    </el-dialog>
  </div>
</template>
