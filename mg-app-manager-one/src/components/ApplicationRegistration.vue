<script setup lang="ts">
import {computed,onUnmounted,reactive,ref,watch} from 'vue';
import {ElMessageBox} from 'element-plus';
import {Check,Close} from '@element-plus/icons-vue';
import type {ApplicationDialogController} from '@mg-inside/frontend';
import {request} from '../api';
const props=defineProps<{params:Record<string,unknown>;controller:ApplicationDialogController}>();
const form=reactive({id:'',name:'',description:'',developer:'郑州元引信息科技有限公司',registeredVersion:''});
const initial=JSON.stringify(form),saving=ref(false),error=ref('');
const dirty=computed(()=>JSON.stringify(form)!==initial);
watch([dirty,saving],()=>props.controller.setState({dirty:dirty.value,busy:saving.value}),{immediate:true});
const clear=props.controller.onBeforeClose(async()=>{
 if(saving.value)return false;
 if(!dirty.value)return true;
 return ElMessageBox.confirm('应用注册信息尚未保存，确定放弃吗？','放弃修改',{confirmButtonText:'放弃修改',cancelButtonText:'继续编辑'}).then(()=>true).catch(()=>false);
});
onUnmounted(clear);
async function save(){
 if(saving.value)return;
 error.value='';saving.value=true;
 try{await request('/api/application-registry',{method:'POST',body:JSON.stringify(form)});props.controller.setState({dirty:false,busy:false});props.controller.complete({changed:true,applicationId:form.id});}
 catch(e){error.value=(e as Error).message;}finally{saving.value=false;}
}
</script>
<template>
 <el-alert v-if="error" :title="error" type="error" :closable="false" />
 <el-form label-position="top" :disabled="saving" @submit.prevent="save">
  <el-form-item label="应用标识" required><el-input v-model="form.id" maxlength="64" aria-label="应用标识" /></el-form-item>
  <el-form-item label="应用名称" required><el-input v-model="form.name" maxlength="80" aria-label="应用名称" /></el-form-item>
  <el-form-item label="开发者"><el-input v-model="form.developer" maxlength="120" aria-label="开发者" /></el-form-item>
  <el-form-item label="当前版本"><el-input v-model="form.registeredVersion" maxlength="64" aria-label="当前版本" /></el-form-item>
  <el-form-item label="说明"><el-input v-model="form.description" type="textarea" maxlength="200" aria-label="说明" /></el-form-item>
 </el-form>
 <footer><el-button :icon="Close" :disabled="saving" @click="controller.cancel()">取消</el-button><el-button :icon="Check" type="primary" :loading="saving" @click="save">注册应用</el-button></footer>
</template>
<style scoped>footer{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}</style>
