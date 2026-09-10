<script setup lang="ts">
import {computed,onUnmounted,ref,watch} from 'vue';
import {Download,Refresh,Search} from '@element-plus/icons-vue';
import {client} from './api';
import {dateTime} from './models';
interface Term {id:string;name:string}
interface Entry {id:string;provider:string;appIds:string[];category:string;domain:string;boundary:string;auth:string;summary:string;method:string;path:string;source:{file:string;line:number};note:string;registrations:Array<{serviceId:string;version:string;operationId:string;active:boolean;hasContract:boolean}>}
interface Inventory {revision:number;updatedAt?:string;updatedBy?:string;document:{categories:Term[];boundaries:Term[];entries:Entry[];gaps:Array<{provider:string;description:string}>}}
const props=defineProps<{environment:string}>();
const data=ref<Inventory|null>(null),loading=ref(false),error=ref(''),search=ref(''),category=ref(''),boundary=ref(''),provider=ref(''),domain=ref(''),status=ref(''),page=ref(1),selected=ref<Entry|null>(null);
let run=0,controller:AbortController|undefined;
const rows=computed(()=>data.value?.document.entries||[]);
const registeredEntries=computed(()=>rows.value.filter(r=>r.registrations?.length));
const registeredOperations=computed(()=>new Set(registeredEntries.value.flatMap(row=>row.registrations.map(r=>r.serviceId+'/'+r.operationId))).size);
const registeredServices=computed(()=>new Set(registeredEntries.value.flatMap(row=>row.registrations.map(r=>r.serviceId))).size);
const providers=computed(()=>[...new Set(rows.value.map(r=>r.provider))].sort());
const domains=computed(()=>[...new Set(rows.value.filter(r=>!provider.value||r.provider===provider.value).map(r=>r.domain))].sort());
function registration(row:Entry){return row.registrations.some(r=>r.active)?'已启用':row.registrations.length?'已登记':'未登记';}
function contract(row:Entry){return row.registrations.some(r=>r.hasContract)?'已提供':['business','management','self'].includes(row.boundary)?'待补充':'协议目录';}
const filtered=computed(()=>rows.value.filter(r=>(!category.value||r.category===category.value)&&(!boundary.value||r.boundary===boundary.value)&&(!provider.value||r.provider===provider.value)&&(!domain.value||r.domain===domain.value)&&(!status.value||registration(r)===status.value)&&[r.summary,r.path,r.method,r.provider,...r.appIds].join(' ').toLowerCase().includes(search.value.trim().toLowerCase())));
const categoryName=(id:string)=>data.value?.document.categories.find(c=>c.id===id)?.name||id;
const boundaryName=(id:string)=>data.value?.document.boundaries.find(c=>c.id===id)?.name||id;
watch([search,category,boundary,provider,domain,status],()=>page.value=1);
watch(provider,()=>domain.value='');watch(filtered,()=>page.value=Math.min(page.value,Math.max(1,Math.ceil(filtered.value.length/20))));
async function load(){const current=++run;controller?.abort();controller=new AbortController();loading.value=true;error.value='';selected.value=null;try{const result=await client.request<Inventory>('/api-inventory?'+new URLSearchParams({environment:props.environment}),{signal:controller.signal});if(current===run)data.value=result;}catch(e){if(current===run&&(e as Error).name!=='AbortError'){error.value=(e as Error).message;data.value=null;}}finally{if(current===run)loading.value=false;}}
function download(){if(!data.value)return;const url=URL.createObjectURL(new Blob([JSON.stringify(data.value,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='api-inventory-r'+data.value.revision+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
watch(()=>props.environment,load,{immediate:true});onUnmounted(()=>{run++;controller?.abort();});
</script>
<template>
 <section class="api-inventory" v-loading="loading">
  <div class="service-toolbar">
   <el-input v-model="search" aria-label="搜索全量 API" placeholder="路径、名称、应用" :prefix-icon="Search" clearable class="service-search"/>
   <el-select v-model="category" aria-label="API 类别" placeholder="全部类别" clearable class="service-status"><el-option v-for="term in data?.document.categories||[]" :key="term.id" :label="term.name" :value="term.id"/></el-select>
   <el-select v-model="boundary" aria-label="API 边界" placeholder="全部边界" clearable class="service-provider"><el-option v-for="term in data?.document.boundaries||[]" :key="term.id" :label="term.name" :value="term.id"/></el-select>
   <el-select v-model="provider" aria-label="API 提供方" placeholder="全部提供方" clearable class="service-provider"><el-option v-for="value in providers" :key="value" :label="value" :value="value"/></el-select>
   <el-select v-model="domain" aria-label="API 领域" placeholder="全部领域" clearable class="service-status"><el-option v-for="value in domains" :key="value" :label="value" :value="value"/></el-select>
   <el-select v-model="status" aria-label="API 登记状态" placeholder="全部登记状态" clearable class="service-provider"><el-option v-for="value in ['已启用','已登记','未登记']" :key="value" :label="value" :value="value"/></el-select>
   <el-tooltip content="刷新台账"><el-button :icon="Refresh" circle aria-label="刷新台账" :loading="loading" @click="load"/></el-tooltip>
   <el-tooltip content="导出台账"><el-button :icon="Download" circle aria-label="导出台账" :disabled="!data" @click="download"/></el-tooltip>
  </div>
  <el-alert v-if="error" type="error" :title="error" show-icon :closable="false"/>
  <template v-if="data">
   <div class="observation-caption"><span>已登记服务 {{registeredServices}} 个 · 已登记操作 {{registeredOperations}} 个 · 全量台账 {{rows.length}} 条 · 当前 {{filtered.length}} 条</span><span>台账修订 {{data.revision}} · {{dateTime(data.updatedAt)}}</span></div>
   <el-table :data="filtered.slice((page-1)*20,page*20)" row-key="id" empty-text="暂无符合条件的登记 API">
    <el-table-column label="API" min-width="300"><template #default="{row}"><el-button link type="primary" class="inventory-entry" @click="selected=row">{{row.summary}}</el-button><div class="secondary">{{row.provider}} · {{row.appIds.join('、')}}</div></template></el-table-column>
    <el-table-column label="类别 / 领域" min-width="150"><template #default="{row}">{{categoryName(row.category)}}<div class="secondary">{{row.domain}}</div></template></el-table-column>
    <el-table-column label="边界" min-width="120"><template #default="{row}">{{boundaryName(row.boundary)}}</template></el-table-column>
    <el-table-column prop="method" label="方法" width="85"/>
    <el-table-column prop="path" label="路径" min-width="240" show-overflow-tooltip/>
    <el-table-column label="登记状态" min-width="125"><template #default="{row}"><el-tag :type="registration(row)==='未登记'?'warning':'success'">{{registration(row)}}</el-tag></template></el-table-column>
    <el-table-column label="OpenAPI 契约" min-width="120"><template #default="{row}">{{contract(row)}}</template></el-table-column>
   </el-table>
   <div class="service-pagination"><el-pagination v-model:current-page="page" :total="filtered.length" :page-size="20" layout="total, prev, pager, next"/></div>
   <el-collapse class="inventory-gaps"><el-collapse-item title="覆盖范围" name="scope"><p v-for="gap in data.document.gaps" :key="gap.provider">{{gap.provider}}：{{gap.description}}</p></el-collapse-item></el-collapse>
  </template>
  <el-drawer :model-value="!!selected" title="API 登记详情" size="min(760px,96vw)" @close="selected=null">
   <el-descriptions v-if="selected" :column="1" border>
    <el-descriptions-item label="名称">{{selected.summary}}</el-descriptions-item><el-descriptions-item label="方法与路径">{{selected.method}} {{selected.path}}</el-descriptions-item>
    <el-descriptions-item label="提供方">{{selected.provider}}</el-descriptions-item><el-descriptions-item label="所属应用">{{selected.appIds.join('、')}}</el-descriptions-item>
    <el-descriptions-item label="分类">{{categoryName(selected.category)}} / {{selected.domain}} / {{boundaryName(selected.boundary)}}</el-descriptions-item>
    <el-descriptions-item label="认证与授权">{{selected.auth}}</el-descriptions-item><el-descriptions-item label="来源">{{selected.source.file}}:{{selected.source.line}}</el-descriptions-item>
    <el-descriptions-item label="接入说明">{{selected.note}}</el-descriptions-item><el-descriptions-item label="登记状态">{{registration(selected)}}</el-descriptions-item><el-descriptions-item label="OpenAPI 契约">{{contract(selected)}}</el-descriptions-item>
    <el-descriptions-item label="服务版本"><div v-for="item in selected.registrations" :key="item.serviceId+item.version">{{item.serviceId}} · {{item.version}} · {{item.operationId}} · {{item.active?'已启用':'未启用'}}</div><span v-if="!selected.registrations.length">尚无服务版本</span></el-descriptions-item>
   </el-descriptions>
  </el-drawer>
 </section>
</template>
<style scoped>
.api-inventory{min-width:0}.inventory-entry{white-space:normal;text-align:left;height:auto;line-height:1.5;overflow-wrap:anywhere}.inventory-gaps{margin-top:24px}
</style>
