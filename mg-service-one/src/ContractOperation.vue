<script setup lang="ts">
import {computed} from 'vue';
import {contractOperation,contractReference,type ServiceContract,type ServiceOperation} from '@mg-inside/frontend';
const props=defineProps<{contract:ServiceContract;operation:ServiceOperation}>();
const details=computed(()=>contractOperation(props.contract,props.operation));
const parameters=computed(()=>(details.value?.parameters||[]).map((p:any)=>contractReference(props.contract,p)));
const request=computed(()=>contractReference(props.contract,details.value?.requestBody));
const responses=computed(()=>Object.entries(details.value?.responses||{}).map(([status,value])=>({status,...contractReference(props.contract,value)})));
const schemaText=(value:any)=>JSON.stringify(contractReference(props.contract,value),null,2);
</script>
<template>
 <section class="contract-document" v-if="details">
  <p v-if="details.description" class="service-note">{{details.description}}</p>
  <h4>请求参数</h4>
  <el-table :data="parameters" empty-text="无路径、查询或请求头参数">
   <el-table-column prop="name" label="名称" min-width="135"/>
   <el-table-column label="位置" width="80"><template #default="{row}">{{({path:'路径',query:'查询',header:'请求头',cookie:'Cookie'} as Record<string,string>)[row.in]}}</template></el-table-column>
   <el-table-column label="必填" width="65"><template #default="{row}">{{row.required?'是':'否'}}</template></el-table-column>
   <el-table-column label="类型与约束" min-width="220"><template #default="{row}"><span>{{row.description}}</span><pre>{{schemaText(row.schema||row.content)}}</pre></template></el-table-column>
  </el-table>
  <template v-if="request"><h4>请求正文 <span class="secondary">{{request.required?'必填':'可选'}}</span></h4><p class="service-note" v-if="request.description">{{request.description}}</p><div v-for="(media,type) in request.content" :key="type"><code>{{type}}</code><pre>{{schemaText(media.schema)}}</pre></div></template>
  <h4>响应与错误</h4>
  <el-collapse><el-collapse-item v-for="response in responses" :key="response.status" :name="response.status" :title="`${response.status} · ${response.description}`"><div v-for="(media,type) in response.content" :key="type"><code>{{type}}</code><pre>{{schemaText(media.schema)}}</pre></div><pre v-if="response.headers">{{JSON.stringify(response.headers,null,2)}}</pre></el-collapse-item></el-collapse>
 </section>
</template>
