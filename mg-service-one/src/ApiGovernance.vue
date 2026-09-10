<script setup lang="ts">
import {computed,onUnmounted,ref,watch} from 'vue';
import {Refresh,Search} from '@element-plus/icons-vue';
import {client} from './api';
import {dateTime,type Catalog} from './models';
const props=defineProps<{environment:string}>();
const events=ref<any[]>([]),providers=ref<Catalog['providers']>([]),query=ref(''),loading=ref(false),error=ref('');
let run=0,controller:AbortController|undefined;
const rows=computed(()=>events.value.filter(row=>`${row.appId} ${row.method} ${row.path} ${row.requestId}`.toLowerCase().includes(query.value.trim().toLowerCase())));
async function load(){const current=++run;controller?.abort();controller=new AbortController();loading.value=true;error.value='';try{
 const data=await client.request<Catalog>('?'+new URLSearchParams({environment:props.environment}),{signal:controller.signal});
 if(current===run){events.value=data.audit.filter(row=>row.action==='api-route');providers.value=data.providers;}
}catch(e){if(current===run&&(e as Error).name!=='AbortError'){error.value=(e as Error).message;events.value=[];}}finally{if(current===run)loading.value=false;}}
watch(()=>props.environment,load,{immediate:true});onUnmounted(()=>{run++;controller?.abort();});
</script>
<template>
 <div class="service-toolbar"><el-input v-model="query" placeholder="应用、路径或请求标识" aria-label="筛选 API 治理记录" :prefix-icon="Search" clearable class="service-search"/><el-tooltip content="刷新记录"><el-button :icon="Refresh" circle aria-label="刷新治理记录" :loading="loading" @click="load"/></el-tooltip><span class="secondary">最近 500 条治理及变更记录中的 API 请求</span></div>
 <el-alert v-if="error" type="error" :title="error" :closable="false" show-icon/>
 <el-table :data="rows" empty-text="暂无 API 治理记录" v-loading="loading">
  <el-table-column label="时间" width="180"><template #default="{row}">{{dateTime(row.at)}}</template></el-table-column>
  <el-table-column label="应用" min-width="130"><template #default="{row}">{{providers?.find(p=>p.id===row.appId)?.name||row.appId||'未解析'}}</template></el-table-column>
  <el-table-column prop="method" label="方法" width="85"/>
  <el-table-column prop="path" label="请求路径" min-width="270" show-overflow-tooltip/>
  <el-table-column label="结果" width="120"><template #default="{row}"><el-tag :type="row.status<400?'warning':'danger'">{{row.forwarded?'未登记兼容':'路由拒绝'}}</el-tag></template></el-table-column>
  <el-table-column prop="status" label="HTTP" width="80"/>
  <el-table-column prop="actor" label="操作人" min-width="130" show-overflow-tooltip/>
  <el-table-column prop="requestId" label="请求标识" min-width="200" show-overflow-tooltip/>
 </el-table>
</template>
