<script setup lang="ts">
import {computed,ref,watch} from 'vue';
import {Search,Edit,Document,Collection} from '@element-plus/icons-vue';
import ApiInventory from './ApiInventory.vue';
import {categories,categoryName,serviceRows,statusName,type Catalog,type Workspace,type Publication} from './models';
const props=defineProps<{data:Catalog;workspace:Workspace|null;loading:boolean;environment:string}>();
const emit=defineEmits<{select:[value:Publication,operationId?:string];metadata:[value:Publication];register:[]}>();
const search=ref(''),category=ref(''),provider=ref(''),status=ref(''),page=ref(1),view=ref('services');
const rows=computed(()=>serviceRows(props.data.items));
const filtered=computed(()=>rows.value.filter(p=>(!category.value||(props.workspace?.services[p.manifest.serviceId]?.category||'uncategorized')===category.value)&&(!provider.value||p.manifest.appId===provider.value)&&(!status.value||statusName(p)===status.value)&&[p.manifest.name,p.manifest.serviceId,p.manifest.description].join(' ').toLowerCase().includes(search.value.toLowerCase())));
const apis=computed(()=>filtered.value.flatMap(p=>p.manifest.operations.map(operation=>({p,...operation,tags:props.workspace?.tags.filter(t=>t.enabled&&t.references.some(r=>r.serviceId===p.manifest.serviceId&&r.operationId===operation.operationId))||[]}))));
const total=computed(()=>view.value==='services'?filtered.value.length:apis.value.length);
watch([search,category,provider,status,view],()=>page.value=1);watch(total,()=>page.value=Math.min(page.value,Math.max(1,Math.ceil(total.value/15))));
const count=(id?:string)=>rows.value.filter(p=>!id||(props.workspace?.services[p.manifest.serviceId]?.category||'uncategorized')===id).reduce((sum,p)=>sum+(view.value==='apis'?p.manifest.operations.length:1),0);
const providerName=(id:string)=>props.data.providers?.find(p=>p.id===id)?.name||id;
</script>
<template>
 <el-tabs v-model="view"><el-tab-pane name="services" label="服务目录"/><el-tab-pane name="apis" label="已登记服务 API"/><el-tab-pane v-if="data.canManage" name="inventory" label="全量 API 台账"/></el-tabs>
 <ApiInventory v-if="view==='inventory'&&data.canManage" :environment="environment"/>
 <div v-else class="service-workspace">
  <aside class="service-categories" :aria-label="view==='apis'?'API 分类':'服务分类'">
   <button :class="{active:!category}" @click="category=''" :aria-pressed="!category"><el-icon><Collection/></el-icon><span>{{view==='apis'?'全部 API':'全部服务'}}</span><b>{{count()}}</b></button>
   <button v-for="item in categories" :key="item.id" :class="{active:category===item.id}" @click="category=item.id" :aria-pressed="category===item.id"><span>{{item.name}}</span><b>{{count(item.id)}}</b></button>
  </aside>
  <section class="service-list" v-loading="loading">
   <div class="service-toolbar">
    <el-input v-model="search" aria-label="搜索服务" placeholder="服务名称、标识" clearable :prefix-icon="Search" class="service-search"/>
    <el-select v-model="provider" aria-label="提供应用" placeholder="全部提供应用" clearable class="service-provider"><el-option v-for="item in data.providers||[]" :key="item.id" :value="item.id" :label="item.name"/></el-select>
    <el-select v-model="status" aria-label="服务状态" placeholder="全部状态" clearable class="service-status"><el-option v-for="item in ['已启用','已停用','未发布','目录登记']" :key="item" :label="item" :value="item"/></el-select>
   </div>
   <el-table v-if="view==='services'" :data="filtered.slice((page-1)*15,page*15)" row-key="manifest.serviceId" empty-text="没有符合条件的服务">
    <el-table-column label="服务名称" min-width="210"><template #default="{row}"><el-button link type="primary" @click="emit('select',row)">{{row.manifest.name}}</el-button><div class="secondary">{{row.manifest.serviceId}}</div></template></el-table-column>
    <el-table-column label="分类" min-width="105"><template #default="{row}">{{categoryName(workspace?.services[row.manifest.serviceId]?.category)}}</template></el-table-column>
    <el-table-column label="提供应用" min-width="130"><template #default="{row}">{{providerName(row.manifest.appId)}}</template></el-table-column>
    <el-table-column label="版本" width="90"><template #default="{row}">{{row.manifest.version}}</template></el-table-column>
    <el-table-column label="API 数" width="80"><template #default="{row}">{{row.manifest.operations.length}}</template></el-table-column>
    <el-table-column label="状态" width="100"><template #default="{row}"><el-tag :type="row.active?'success':'info'" size="small">{{statusName(row)}}</el-tag></template></el-table-column>
    <el-table-column label="负责人" min-width="100"><template #default="{row}">{{workspace?.services[row.manifest.serviceId]?.owner||'--'}}</template></el-table-column>
    <el-table-column label="操作" width="115" fixed="right"><template #default="{row}"><el-tooltip content="服务详情"><el-button :icon="Document" circle text aria-label="服务详情" @click="emit('select',row)"/></el-tooltip><el-tooltip v-if="data.canManage" content="分类与负责人"><el-button :icon="Edit" circle text aria-label="分类与负责人" :disabled="!workspace" @click="emit('metadata',row)"/></el-tooltip></template></el-table-column>
   </el-table>
   <el-table v-else :data="apis.slice((page-1)*15,page*15)" empty-text="没有符合条件的 API">
    <el-table-column label="API" min-width="230"><template #default="{row}"><el-button type="primary" link @click="emit('select',row.p,row.operationId)">{{row.summary}}</el-button><div class="secondary">{{row.operationId}}</div></template></el-table-column>
    <el-table-column label="所属服务" min-width="140"><template #default="{row}">{{row.p.manifest.name}}</template></el-table-column>
    <el-table-column label="方法" width="90"><template #default="{row}"><el-tag size="small" :type="row.method==='GET'?'success':'warning'">{{row.method}}</el-tag></template></el-table-column>
    <el-table-column prop="path" label="路径" min-width="190" show-overflow-tooltip/>
    <el-table-column label="标签" min-width="150"><template #default="{row}"><div class="tag-list"><el-tag v-for="tag in row.tags" :key="tag.id" :type="tag.color" size="small">{{tag.name}}</el-tag><span v-if="!row.tags.length" class="secondary">--</span></div></template></el-table-column>
   </el-table>
   <div class="service-pagination"><el-pagination v-model:current-page="page" :page-size="15" :total="total" layout="total, prev, pager, next"/></div>
  </section>
 </div>
</template>
