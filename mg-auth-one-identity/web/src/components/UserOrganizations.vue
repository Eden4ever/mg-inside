<script setup lang="ts">
import { ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { api, send, type Organization } from '../api/client';
const props=defineProps<{user:{id:string;displayName:string;organizations?:Array<{id:string;name:string;isPrimary:boolean}>}}>();
const emit=defineEmits<{saved:[]}>();
const open=ref(false),loading=ref(false),saving=ref(false),error=ref(''),options=ref<Organization[]>([]),selected=ref<string[]>([]),primary=ref('');
watch(selected,()=>{if(!selected.value.includes(primary.value))primary.value=selected.value[0]||'';});
async function show(){open.value=true;loading.value=true;error.value='';try{const [organizations,memberships]=await Promise.all([api.organizations(),api.userOrganizations(props.user.id)]);options.value=organizations;selected.value=memberships.map(m=>m.organizationId);primary.value=memberships.find(m=>m.isPrimary)?.organizationId||'';}catch(e){error.value=(e as Error).message;}finally{loading.value=false;}}
async function save(){if(saving.value)return;saving.value=true;try{await send(`/users/${encodeURIComponent(props.user.id)}/organizations`,{organizations:selected.value.map(organizationId=>({organizationId,isPrimary:organizationId===primary.value}))},'PUT');open.value=false;emit('saved');ElMessage.success('所属机构已保存');}catch(e){ElMessage.error((e as Error).message);}finally{saving.value=false;}}
</script>
<template>
  <el-button link type="primary" @click="show">所属机构</el-button>
  <el-dialog v-model="open" :title="`${user.displayName} · 所属机构`" width="560px" :close-on-click-modal="false" :show-close="!saving">
    <el-alert v-if="error" :title="error" type="error" :closable="false"/>
    <el-form v-loading="loading" label-position="top" :disabled="saving||!!error">
      <el-form-item label="所属组织机构"><el-select v-model="selected" multiple filterable class="full-width" aria-label="所属组织机构"><el-option v-for="org in options" :key="org.id" :value="org.id" :label="org.name+(org.enabled?'':'（停用）')" :disabled="!org.enabled&&!selected.includes(org.id)"/></el-select></el-form-item>
      <el-form-item v-if="selected.length" label="主机构" required><el-select v-model="primary" class="full-width" aria-label="主机构"><el-option v-for="org in options.filter(o=>selected.includes(o.id))" :key="org.id" :value="org.id" :label="org.name"/></el-select></el-form-item>
    </el-form>
    <template #footer><el-button :disabled="saving" @click="open=false">取消</el-button><el-button type="primary" :loading="saving" :disabled="loading||!!error" @click="save">保存机构</el-button></template>
  </el-dialog>
</template>
