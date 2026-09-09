<script setup lang="ts">
import { computed,onMounted,onUnmounted,ref,watch } from 'vue';
import { ElMessageBox } from 'element-plus';
import type { ApplicationDialogController } from '@mg-inside/frontend';
import { request,type FileEntry } from '../api';
const props=defineProps<{params:Record<string,unknown>;controller:ApplicationDialogController}>();
const item=ref<FileEntry>(), folders=ref<FileEntry[]>([]),target=ref(''),busy=ref(false),loading=ref(true),error=ref('');
const dirty=computed(()=>!!target.value&&target.value!==item.value?.parentId);
watch([dirty,busy],()=>props.controller.setState({dirty:dirty.value,busy:busy.value}));
const clear=props.controller.onBeforeClose(()=>busy.value?false:!dirty.value||ElMessageBox.confirm('移动操作尚未保存，确定放弃吗？','放弃修改',{confirmButtonText:'放弃',cancelButtonText:'继续选择'}).then(()=>true).catch(()=>false));onUnmounted(clear);
onMounted(async()=>{try {const [entry,data]=await Promise.all([request<FileEntry>(`/entries/${String(props.params.id)}`),request<{items:FileEntry[]}>('/folders')]);item.value=entry;target.value=entry.parentId||''; const excluded=new Set([entry.id]);let changed=true;while(changed){changed=false;for(const f of data.items)if(f.parentId&&excluded.has(f.parentId)&&!excluded.has(f.id)){excluded.add(f.id);changed=true;}}folders.value=data.items.filter(f=>!excluded.has(f.id));}catch(e){error.value=(e as Error).message;}finally{loading.value=false;}});
async function save(){if(!dirty.value||busy.value||!item.value)return;busy.value=true;error.value='';try{await request(`/entries/${item.value.id}/move`,{method:'POST',body:JSON.stringify({parentId:target.value,version:item.value.version})});props.controller.complete({id:item.value.id});}catch(e){error.value=(e as Error).message;}finally{busy.value=false;}}
</script>
<template><p>将「{{item?.name||'条目'}}」移动到：</p><el-select v-model="target" filterable :disabled="loading||busy" aria-label="目标文件夹" style="width:100%"><el-option v-for="folder in folders" :key="folder.id" :label="folder.label||folder.name" :value="folder.id"/></el-select><el-alert v-if="error" :title="error" type="error" :closable="false"/><footer class="dialog-actions"><el-button :disabled="busy" @click="controller.cancel()">取消</el-button><el-button type="primary" :loading="busy" :disabled="!dirty||loading" @click="save">移动</el-button></footer></template>
