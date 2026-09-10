<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Refresh } from '@element-plus/icons-vue';
import { api, request, send, type Application, type ManagedUser } from '../api/client';
import { user } from '../session';
import UserOrganizations from './UserOrganizations.vue';
import { useCloseProtection } from '../use-close-protection';
type Scope={id:string;divisionId:string|null;organizationId:string|null;division:{name:string;enabled:boolean}|null;organization:{name:string;enabled:boolean}|null;administrators:{userId:string}[];applications:{clientId:string;application:Application}[]};
type Member={id:string;displayName:string;username:string|null;status:string;scopeGrants:{clientId:string}[]};
const route=useRoute(),platform=computed(()=>user.value?.roles?.some(r=>r.key==='platform-admin'));
const scopes=ref<Scope[]>([]),targets=ref<{id:string;name:string;kind:string}[]>([]),users=ref<ManagedUser[]>([]),apps=ref<Application[]>([]),members=ref<Member[]>([]);
const selected=ref(''),clientIds=ref<string[]>([]),administratorIds=ref<string[]>([]),loading=ref(false),saving=ref(false),error=ref(''),query=ref('');
const target=computed(()=>targets.value.find(t=>`${t.kind}:${t.id}`===selected.value));
const current=computed(()=>scopes.value.find(s=>`${s.divisionId?'division':'organization'}:${s.divisionId||s.organizationId}`===selected.value));
const sameIds=(a:string[],b:string[])=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
useCloseProtection(computed(()=>!!platform.value&&!loading.value&&!!target.value&&(!sameIds(clientIds.value,current.value?.applications.map(a=>a.clientId)||[])||!sameIds(administratorIds.value,current.value?.administrators.map(a=>a.userId)||[]))),saving);
const roleKey=computed(()=>target.value?.kind==='division'?'division-admin':'organization-admin');
const administrators=computed(()=>users.value.filter(u=>u.status==='active'&&u.roles?.some(r=>r.key===roleKey.value)));
const visibleMembers=computed(()=>members.value.filter(m=>`${m.displayName} ${m.username||''}`.includes(query.value.trim())));
async function load(){loading.value=true;error.value='';try{scopes.value=await request<Scope[]>('/scopes');if(platform.value){const [divisions,organizations,allUsers,applications]=await Promise.all([api.divisions(),api.organizations(),api.users(),api.applications()]);targets.value=[...divisions.map(d=>({id:d.id,name:d.name,kind:'division'})),...organizations.map(o=>({id:o.id,name:o.name,kind:'organization'}))];users.value=allUsers;apps.value=applications.filter(a=>!a.foundation);}else targets.value=scopes.value.map(s=>({id:(s.divisionId||s.organizationId)!,name:(s.division||s.organization)!.name,kind:s.divisionId?'division':'organization'}));if(!targets.value.some(t=>`${t.kind}:${t.id}`===selected.value))selected.value=targets.value[0]?`${targets.value[0].kind}:${targets.value[0].id}`:'';await change();}catch(e){error.value=(e as Error).message;}finally{loading.value=false;}}
async function change(){members.value=[];clientIds.value=current.value?.applications.map(a=>a.clientId)||[];administratorIds.value=current.value?.administrators.map(a=>a.userId)||[];if(current.value){const id=current.value.id;try{const rows=await request<Member[]>(`/scopes/${id}/members`);if(current.value?.id===id)members.value=rows;}catch(e){error.value=(e as Error).message;}}}
async function configure(){if(!target.value||saving.value)return;saving.value=true;try{await send(`/scopes/${target.value.kind}/${target.value.id}`,{clientIds:clientIds.value,administratorIds:administratorIds.value},'PUT');await load();ElMessage.success('应用范围与管理员已保存');}catch(e){ElMessage.error((e as Error).message);}finally{saving.value=false;}}
async function grant(member:Member,clientId:string,enabled:boolean){if(!current.value||saving.value)return;saving.value=true;try{await send(`/scopes/${current.value.id}/applications/${encodeURIComponent(clientId)}/users/${member.id}`,{enabled},'PUT');await change();}catch(e){ElMessage.error((e as Error).message);}finally{saving.value=false;}}
onMounted(()=>{if(typeof route.query.kind==='string'&&typeof route.query.id==='string')selected.value=`${route.query.kind}:${route.query.id}`;void load();});
</script>
<template><div class="primary-page users-page">
  <div class="primary-page-heading"><h1>范围应用权限</h1><el-button :icon="Refresh" :disabled="loading||saving" @click="load">刷新</el-button></div>
  <el-alert v-if="error" :title="error" type="error" :closable="false"/>
  <el-form label-position="top" :disabled="loading||saving" class="scope-config">
    <el-form-item label="管理范围"><el-select v-model="selected" filterable aria-label="管理范围" class="full-width" @change="change"><el-option v-for="item in targets" :key="`${item.kind}:${item.id}`" :value="`${item.kind}:${item.id}`" :label="`${item.kind==='division'?'行政区划':'组织机构'} · ${item.name}`"/></el-select></el-form-item>
    <template v-if="platform&&target"><el-form-item label="可配置应用"><el-select v-model="clientIds" multiple filterable class="full-width" aria-label="可配置应用"><el-option v-for="app in apps" :key="app.clientId" :value="app.clientId" :label="app.name+(app.enabled?'':'（停用）')"/></el-select></el-form-item>
    <el-form-item :label="target.kind==='division'?'行政区划管理员':'组织机构管理员'"><el-select v-model="administratorIds" multiple filterable class="full-width" aria-label="范围管理员"><el-option v-for="person in administrators" :key="person.id" :value="person.id" :label="person.displayName"/></el-select></el-form-item><el-form-item><el-button type="primary" :loading="saving" @click="configure">保存范围配置</el-button></el-form-item></template>
  </el-form>
  <section v-if="current" class="table-wrap table-panel"><div class="table-toolbar users-list-toolbar"><strong>范围成员（{{members.length}}）</strong><el-input v-model="query" clearable placeholder="搜索成员" aria-label="搜索范围成员" style="max-width:280px"/></div>
    <el-table :data="visibleMembers" v-loading="loading" height="100%"><el-table-column label="成员" min-width="180"><template #default="{row}"><strong>{{row.displayName}}</strong><small class="subtext">{{row.username}}</small></template></el-table-column><el-table-column label="状态" width="90"><template #default="{row}">{{row.status==='active'?'启用':'停用'}}</template></el-table-column>
      <el-table-column v-for="item in current.applications" :key="item.clientId" :label="item.application.name" min-width="155"><template #default="{row}"><el-switch :model-value="row.scopeGrants.some((g:{clientId:string})=>g.clientId===item.clientId)" :disabled="saving||!item.application.enabled||!(current.division?.enabled??current.organization?.enabled)" :aria-label="`${row.displayName} ${item.application.name}`" @change="(value:string|number|boolean)=>grant(row,item.clientId,Boolean(value))"/></template></el-table-column>
      <el-table-column v-if="platform" label="组织归属" width="120"><template #default="{row}"><UserOrganizations :user="row" @saved="load"/></template></el-table-column>
      <template #empty><el-empty description="暂无范围成员"/></template>
    </el-table>
  </section><el-empty v-else :description="target?'尚未配置范围权限':'暂无可管理范围'"/>
</div></template>
<style scoped>.scope-config{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 20px}.scope-config .el-form-item{min-width:0}@media(max-width:700px){.scope-config{grid-template-columns:minmax(0,1fr)}}</style>
