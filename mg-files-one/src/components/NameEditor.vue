<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { ElMessageBox } from 'element-plus';
import type { ApplicationDialogController } from '@mg-inside/frontend';
import { request, type FileEntry } from '../api';
const props = defineProps<{params: Record<string,unknown>; controller: ApplicationDialogController}>();
const id = typeof props.params.id === 'string' ? props.params.id : '', name = ref(''), original = ref(''), item = ref<FileEntry>(), busy = ref(false), loading = ref(!!id), error = ref('');
const dirty = computed(() => name.value !== original.value);
props.controller.setTitle(id ? '重命名' : '新建文件夹');
watch([dirty,busy], () => props.controller.setState({dirty:dirty.value,busy:busy.value}));
const clear = props.controller.onBeforeClose(() => busy.value ? false : !dirty.value || ElMessageBox.confirm('名称尚未保存，确定放弃吗？','放弃修改',{confirmButtonText:'放弃',cancelButtonText:'继续编辑'}).then(()=>true).catch(()=>false));
onUnmounted(clear);
onMounted(async () => { if (!id) return; try { item.value=await request<FileEntry>(`/entries/${id}`); name.value=original.value=item.value.name; } catch(e) { error.value=(e as Error).message; } finally { loading.value=false; } });
async function save() { if (busy.value || loading.value) return; if (!name.value.trim()) {error.value='请输入名称';return;} busy.value=true;error.value=''; try { const result=await request<FileEntry>(id?`/entries/${id}`:'/folders',{method:id?'PATCH':'POST',body:JSON.stringify(id?{name:name.value,version:item.value?.version}:{parentId:props.params.parentId,name:name.value})}); original.value=name.value;props.controller.complete({id:result.id}); } catch(e) {error.value=(e as Error).message;} finally {busy.value=false;} }
</script>
<template><el-form label-position="top" @submit.prevent="save"><el-form-item label="名称" required><el-input v-model="name" maxlength="180" :disabled="loading||busy" autofocus aria-label="名称"/></el-form-item><el-alert v-if="error" :title="error" type="error" :closable="false"/><footer class="dialog-actions"><el-button :disabled="busy" @click="controller.cancel()">取消</el-button><el-button type="primary" :loading="busy" :disabled="loading||!!id&&!item" @click="save">保存</el-button></footer></el-form></template>
