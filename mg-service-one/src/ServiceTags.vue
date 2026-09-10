<script setup lang="ts">
import {computed,ref,watch,onUnmounted} from 'vue';
import {Plus,Search,Edit} from '@element-plus/icons-vue';
import {ElMessage,ElMessageBox} from 'element-plus';
import {client} from './api';
import {serviceRows,type Catalog,type Workspace,type ApiTag} from './models';
const props=defineProps<{data:Catalog;workspace:Workspace;environment:string}>();
const emit=defineEmits<{saved:[];state:[dirty:boolean,busy:boolean]}>();
const search=ref(''),target=ref<ApiTag|null>(null),initial=ref(''),saving=ref(false),apiSearch=ref('');
const filtered=computed(()=>props.workspace.tags.filter(t=>t.name.toLowerCase().includes(search.value.toLowerCase())));
const selectedKeys=ref<string[]>([]);
const apiRows=computed(()=>serviceRows(props.data.items).flatMap(p=>p.manifest.operations.map(o=>({key:p.manifest.serviceId+'/'+o.operationId,service:p.manifest.name,serviceId:p.manifest.serviceId,...o}))));
const shownApis=computed(()=>apiRows.value.filter(o=>[o.service,o.summary,o.operationId].join(' ').toLowerCase().includes(apiSearch.value.toLowerCase())));
const snapshot=()=>JSON.stringify([target.value,selectedKeys.value]);
const dirty=computed(()=>!!target.value&&snapshot()!==initial.value);
watch([dirty,saving],()=>emit('state',dirty.value,saving.value));onUnmounted(()=>emit('state',false,false));
function edit(tag?:ApiTag){target.value=tag?JSON.parse(JSON.stringify(tag)):{id:'',name:'',color:'primary',enabled:true,references:[]};selectedKeys.value=target.value!.references.map(r=>r.serviceId+'/'+r.operationId);apiSearch.value='';initial.value=snapshot();}
async function close(done?:()=>void){if(saving.value)return;if(dirty.value){try{await ElMessageBox.confirm('放弃尚未保存的标签更改？','未提交更改',{confirmButtonText:'放弃',cancelButtonText:'继续编辑'});}catch{return;}}target.value=null;done?.();}
async function save(){if(!target.value?.name.trim()||saving.value)return;saving.value=true;try{await client.request('/workspace?environment='+encodeURIComponent(props.environment),{method:'POST',body:JSON.stringify({kind:'tag',expectedRevision:props.workspace.revision,...target.value,references:selectedKeys.value.map(key=>{const split=key.indexOf('/');return {serviceId:key.slice(0,split),operationId:key.slice(split+1)};})})});target.value=null;ElMessage.success('标签已保存');emit('saved');}catch(error){ElMessage.error((error as Error).message);}finally{saving.value=false;}}
const colors=[{id:'primary',name:'蓝色'},{id:'success',name:'绿色'},{id:'warning',name:'黄色'},{id:'danger',name:'红色'},{id:'info',name:'灰色'}] as const;
</script>
<template>
 <div class="service-toolbar"><el-input v-model="search" aria-label="搜索标签" placeholder="标签名称" clearable :prefix-icon="Search" class="service-search"/><el-button v-if="data.canManage" type="primary" :icon="Plus" @click="edit()">新建标签</el-button></div>
 <el-table :data="filtered" empty-text="暂无标签">
  <el-table-column label="标签" min-width="180"><template #default="{row}"><el-tag :type="row.color">{{row.name}}</el-tag></template></el-table-column>
  <el-table-column label="关联 API" min-width="140"><template #default="{row}">{{row.references.length}}</template></el-table-column>
  <el-table-column label="状态" width="110"><template #default="{row}">{{row.enabled?'启用':'停用'}}</template></el-table-column>
  <el-table-column label="操作" width="150"><template #default="{row}"><el-button :icon="Edit" link type="primary" @click="edit(row)">{{data.canManage?'编辑与关联':'查看关联'}}</el-button></template></el-table-column>
 </el-table>
 <el-dialog :model-value="!!target" :title="target?.id?'标签详情':'新建标签'" width="min(800px,94vw)" :before-close="close" :close-on-click-modal="false">
  <template v-if="target"><el-form label-position="top" :disabled="saving||!data.canManage"><div class="form-grid"><el-form-item label="标签名称" required><el-input v-model="target.name" maxlength="40" aria-label="标签名称"/></el-form-item><el-form-item label="启用状态"><el-switch v-model="target.enabled" aria-label="启用标签"/></el-form-item></div><el-form-item label="颜色"><div class="color-swatches"><el-tooltip v-for="color in colors" :key="color.id" :content="color.name"><button type="button" :class="['color-swatch',color.id,{selected:target.color===color.id}]" :aria-label="color.name" :aria-pressed="target.color===color.id" :disabled="!data.canManage" @click="target.color=color.id"/></el-tooltip></div></el-form-item></el-form>
   <div class="service-toolbar"><h3>关联 API</h3><el-input v-model="apiSearch" placeholder="服务名称、API 名称" aria-label="搜索关联 API" :prefix-icon="Search" clearable class="service-search"/><span class="secondary">已选择 {{selectedKeys.length}} 项</span></div>
   <el-checkbox-group v-model="selectedKeys" :disabled="saving||!data.canManage" class="api-choices"><label v-for="api in shownApis" :key="api.key" class="api-choice"><el-checkbox :value="api.key" :label="api.summary"/><span class="secondary">{{api.service}} · {{api.method}} {{api.path}}</span></label><el-empty v-if="!shownApis.length" description="没有匹配的 API"/></el-checkbox-group>
  </template>
  <template #footer><el-button :disabled="saving" @click="close()">取消</el-button><el-button v-if="data.canManage" type="primary" :loading="saving" :disabled="!target?.name.trim()" @click="save">保存</el-button></template>
 </el-dialog>
</template>
