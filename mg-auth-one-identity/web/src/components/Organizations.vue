<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { Plus, Refresh, Search, Close } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api, type Division, type Organization } from '../api/client';
import { descendantIds, divisionTree, organizationTypes } from '../division-tree';
const rows=ref<Organization[]>([]), divisions=ref<Division[]>([]), query=ref(''), treeQuery=ref(''), selected=ref<string|null>(null), status=ref('all'), page=ref(1), pageSize=ref(12);
const loading=ref(false), error=ref(''), dialog=ref(false), editing=ref<Organization|null>(null), saving=ref(false);
const form=reactive({name:'',creditCode:'',type:'institution',divisionId:null as string|null,enabled:true,plaques:[] as string[]});
const selectedName=computed(()=>divisions.value.find(d=>d.id===selected.value)?.name||'全部机构');
const tree=computed(()=>divisionTree(divisions.value,treeQuery.value));
const choices=computed(()=>divisionTree(divisions.value).map(function mark(node): typeof node & {disabled:boolean} {return {...node,disabled:!node.enabled,children:node.children.map(mark)};}));
const filtered=computed(()=>{const ids=selected.value?descendantIds(divisions.value,selected.value):null;const term=query.value.trim().toLowerCase();return rows.value.filter(row=>(!ids||ids.has(row.divisionId||''))&&(status.value==='all'||row.enabled===(status.value==='enabled'))&&`${row.name} ${row.creditCode} ${row.plaques.map((p: {name:string})=>p.name).join(' ')}`.toLowerCase().includes(term));});
const paged=computed(()=>filtered.value.slice((page.value-1)*pageSize.value,page.value*pageSize.value));
watch([selected,query,status,pageSize],()=>{page.value=1;});
watch(()=>filtered.value.length,total=>{page.value=Math.min(page.value,Math.max(1,Math.ceil(total/pageSize.value)));});
async function load(){loading.value=true;error.value='';try{[rows.value,divisions.value]=await Promise.all([api.organizations(),api.divisions()]);if(selected.value&&!divisions.value.some(d=>d.id===selected.value))selected.value=null;}catch(e){error.value=(e as Error).message;}finally{loading.value=false;}}
function edit(row?:Organization){editing.value=row||null;Object.assign(form,row?{name:row.name,creditCode:row.creditCode,type:row.type,divisionId:row.divisionId,enabled:row.enabled,plaques:row.plaques.map((p: {name:string})=>p.name)}:{name:'',creditCode:'',type:'institution',divisionId:selected.value,enabled:true,plaques:[]});dialog.value=true;}
async function save(){if(saving.value)return;if(!form.name.trim()||!form.divisionId)return ElMessage.warning('请填写机构名称并选择所属区划');saving.value=true;try{const body={...form,plaques:form.plaques.map(name=>name.trim()).filter(Boolean)};if(editing.value)await api.updateOrganization(editing.value.id,body);else await api.createOrganization(body);dialog.value=false;await load();ElMessage.success('组织机构已保存');}catch(e){ElMessage.error((e as Error).message);}finally{saving.value=false;}}
async function toggle(row:Organization){if(saving.value||loading.value)return;saving.value=true;try{await ElMessageBox.confirm(`${row.enabled?'停用':'启用'}“${row.name}”？`,'调整机构状态',{type:'warning'});await api.updateOrganization(row.id,{enabled:!row.enabled});await load();}catch(e){if(e!=='cancel'&&e!=='close')ElMessage.error((e as Error).message);}finally{saving.value=false;}}
async function remove(row:Organization){if(saving.value||loading.value)return;saving.value=true;try{await ElMessageBox.confirm(`删除“${row.name}”及其挂牌名称？此操作不可恢复。`,'删除组织机构',{type:'warning'});await api.removeOrganization(row.id);await load();}catch(e){if(e!=='cancel'&&e!=='close')ElMessage.error((e as Error).message);}finally{saving.value=false;}}
onMounted(load);
</script>
<template>
  <div class="primary-page users-page geography-page"><div class="primary-page-heading"><h1>组织机构管理</h1><div class="primary-page-actions"><el-tooltip content="刷新"><el-button :icon="Refresh" aria-label="刷新机构" :disabled="loading||saving" @click="load"/></el-tooltip><el-button type="primary" :icon="Plus" :disabled="loading||saving||!!error" @click="edit()">新增机构</el-button></div></div>
    <el-alert v-if="error" :title="error" type="error" :closable="false"/>
    <div class="organization-layout">
      <aside class="organization-tree" aria-label="行政区划筛选"><h2>行政区划</h2><el-input v-model="treeQuery" :prefix-icon="Search" clearable placeholder="搜索区划" aria-label="搜索机构区划"/><el-button link type="primary" @click="selected=null">全部机构</el-button><el-tree :key="treeQuery" :data="tree" node-key="id" :current-node-key="selected||undefined" :default-expand-all="!!treeQuery" :props="{label:'name',children:'children'}" highlight-current @node-click="(node:Division)=>selected=node.id"><template #default="{data}"><span class="division-node" :title="data.name">{{data.name}}</span></template></el-tree><el-empty v-if="!loading&&!tree.length" description="暂无匹配区划" :image-size="50"/></aside>
      <section class="table-wrap table-panel"><div class="users-list-toolbar table-toolbar organization-toolbar"><strong>{{selectedName}}</strong><el-input v-model="query" :prefix-icon="Search" clearable placeholder="搜索名称、挂牌或信用代码" aria-label="搜索机构"/><el-select v-model="status" aria-label="机构状态"><el-option value="all" label="全部状态"/><el-option value="enabled" label="启用"/><el-option value="disabled" label="停用"/></el-select></div>
        <el-table v-loading="loading" :data="paged" height="100%" row-key="id"><el-table-column label="组织机构" min-width="260"><template #default="{row}"><strong>{{row.name}}</strong><div class="tags"><el-tag v-for="plaque in row.plaques" :key="plaque.id" size="small" type="info" effect="plain">{{plaque.name}}</el-tag></div></template></el-table-column>
          <el-table-column prop="creditCode" label="统一社会信用代码" min-width="195"/><el-table-column label="所属区划" min-width="140"><template #default="{row}">{{row.division?.name||'未设置'}}</template></el-table-column><el-table-column label="类型" width="110"><template #default="{row}">{{organizationTypes[row.type]}}</template></el-table-column>
          <el-table-column label="状态" width="90"><template #default="{row}"><el-switch :model-value="row.enabled" :disabled="saving||loading" :aria-label="`${row.name}状态`" @change="toggle(row)"/></template></el-table-column><el-table-column label="操作" width="310"><template #default="{row}"><el-button link type="primary" :disabled="saving||loading" @click="edit(row)">编辑</el-button><router-link :to="{path:'/admin',query:{organization:row.id}}" class="text-link">成员（{{row._count?.members||0}}）</router-link><router-link :to="{path:'/scopes',query:{kind:'organization',id:row.id}}" class="text-link">应用权限</router-link><el-button link type="danger" :disabled="saving||loading||row.enabled" @click="remove(row)">删除</el-button></template></el-table-column>
          <template #empty><el-empty :description="error?'机构加载失败':'没有符合条件的机构'" :image-size="70"/></template>
        </el-table><div class="pagination"><el-pagination v-model:current-page="page" v-model:page-size="pageSize" :page-sizes="[12,24,48]" :total="filtered.length" layout="total, sizes, prev, pager, next"/></div>
      </section>
    </div>
    <el-dialog v-model="dialog" :title="editing?'编辑机构':'新增机构'" width="600px" :close-on-click-modal="false" :close-on-press-escape="!saving" :show-close="!saving"><el-form label-position="top" :disabled="saving" @submit.prevent="save">
      <el-form-item label="机构主名称" required><el-input v-model="form.name" maxlength="160" aria-label="机构主名称"/></el-form-item>
      <el-form-item label="统一社会信用代码" required><el-input v-model="form.creditCode" maxlength="18" aria-label="统一社会信用代码"/></el-form-item>
      <el-form-item label="所属区划" required><el-tree-select v-model="form.divisionId" :data="choices" node-key="id" check-strictly filterable class="full-width" aria-label="所属区划"/></el-form-item>
      <el-form-item label="机构类型"><el-select v-model="form.type" class="full-width" aria-label="机构类型"><el-option v-for="(label,value) in organizationTypes" :key="value" :label="label" :value="value"/></el-select></el-form-item>
      <el-form-item label="加挂牌子"><div class="plaque-editor"><div v-for="(_,index) in form.plaques" :key="index" class="plaque-row"><el-input v-model="form.plaques[index]" maxlength="160" :aria-label="`挂牌名称${index+1}`"/><el-tooltip content="移除挂牌"><el-button :icon="Close" :aria-label="`移除挂牌${index+1}`" @click="form.plaques.splice(index,1)"/></el-tooltip></div><el-button :icon="Plus" :disabled="form.plaques.length>=100" @click="form.plaques.push('')">添加挂牌</el-button></div></el-form-item>
      <el-form-item label="状态"><el-switch v-model="form.enabled" active-text="启用" inactive-text="停用" aria-label="机构启用状态"/></el-form-item>
    </el-form><template #footer><el-button :disabled="saving" @click="dialog=false">取消</el-button><el-button type="primary" :loading="saving" @click="save">保存</el-button></template></el-dialog>
  </div>
</template>

