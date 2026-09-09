<script setup lang="ts">
import { ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Delete } from '@element-plus/icons-vue';
import { api } from '@/api/client';
import type { IndicatorSystemSummary } from '@/types/domain';

const props = defineProps<{ system: IndicatorSystemSummary }>();
const emit = defineEmits<{ close: []; saved: [input: { name: string; region: string }]; removed: [] }>();
const name = ref(props.system.name);
const region = ref(props.system.region);
const busy = ref(false);
async function save() {
  if (busy.value) return;
  if (!name.value.trim()) { ElMessage.warning('请输入体系名称'); return; }
  busy.value = true;
  try {
    const input = { name: name.value.trim(), region: region.value.trim() };
    await api.updateSystem(props.system.id, input);
    ElMessage.success('指标体系已保存');
    emit('saved', input);
  } catch (error) { ElMessage.error(error instanceof Error ? error.message : '保存失败'); }
  finally { busy.value = false; }
}
async function remove() {
  if (busy.value) return;
  busy.value = true;
  try {
    const { value } = await ElMessageBox.prompt(`将永久删除“${props.system.name}”及其所有版本、指标内容、依据和模板，无法撤销。请输入完整体系名称确认。`, '删除指标体系', {
      type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消',
      inputPlaceholder: '请输入完整体系名称',
      inputValidator: value => value === props.system.name || '体系名称不一致',
    });
    await api.deleteSystem(props.system.id, value);
    ElMessage.success('指标体系已删除'); emit('removed');
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '删除失败');
  } finally { busy.value = false; }
}
</script>

<template>
  <el-dialog :model-value="true" title="编辑指标体系" width="520px" :close-on-click-modal="!busy" :close-on-press-escape="!busy" :show-close="!busy" @close="!busy && emit('close')">
    <el-form label-position="top" @submit.prevent="save">
      <el-form-item label="体系名称" required><el-input v-model="name" maxlength="200" :disabled="busy" placeholder="请输入体系名称" /></el-form-item>
      <el-form-item label="地区"><el-input v-model="region" maxlength="200" :disabled="busy" placeholder="选填" /></el-form-item>
    </el-form>
    <template #footer>
      <div class="system-edit-footer">
        <el-button type="danger" plain :icon="Delete" :disabled="busy" @click="remove">删除体系</el-button>
        <div><el-button :disabled="busy" @click="emit('close')">取消</el-button><el-button type="primary" :loading="busy" @click="save">保存</el-button></div>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.system-edit-footer { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; }
</style>
