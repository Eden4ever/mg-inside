<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '@/api/client';
const enabled = ref(true); const hasKey = ref(false); const apiKey = ref(''); const revision = ref(0); const busy = ref(false); const loaded = ref(false); const error = ref(''); const result = ref('');
const savedEnabled = ref(true);
const emit = defineEmits<{ closeStateChange: [state: { dirty: boolean; busy: boolean }] }>();
watch([enabled, savedEnabled, apiKey, loaded, busy], () => emit('closeStateChange', { dirty: Boolean(apiKey.value) || (loaded.value && enabled.value !== savedEnabled.value), busy: busy.value }), { immediate: true, flush: 'sync' });
async function load() { try { const config = await api.modelConfig(); savedEnabled.value = config.enabled; enabled.value = config.enabled; hasKey.value = config.hasKey; revision.value = config.revision; error.value = config.error || ''; loaded.value = true; } catch (e) { error.value = e instanceof Error ? e.message : '读取配置失败'; } }
async function save() { busy.value = true; error.value = ''; result.value = ''; try { await api.saveModelConfig({ enabled: enabled.value, revision: revision.value, ...(apiKey.value ? { apiKey: apiKey.value } : {}) }); apiKey.value = ''; await load(); ElMessage.success('模型配置已保存'); } catch (e) { error.value = e instanceof Error ? e.message : '保存失败'; } finally { busy.value = false; } }
async function test() { busy.value = true; error.value = ''; result.value = ''; try { const r = await api.testModelConfig(); result.value = `连接成功 · ${r.dimensions} 维 · ${r.tokens} tokens · ${r.elapsedMs}ms`; } catch (e) { error.value = e instanceof Error ? e.message : '连接测试失败'; } finally { busy.value = false; } }
onMounted(load);
</script>
<template>
  <main class="model-page primary-page">
    <header class="model-header primary-page-heading"><h1>模型管理</h1></header>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <div class="model-body primary-page-scroll" tabindex="0" role="region" aria-label="向量模型配置">
      <el-card shadow="never">
        <template #header>向量模型</template>
        <el-form label-width="100px" @submit.prevent="save">
          <el-form-item label="服务商"><span>智谱</span></el-form-item>
          <el-form-item label="模型"><span>embedding-3</span></el-form-item>
          <el-form-item label="向量维度"><span>1024</span></el-form-item>
          <el-form-item label="API Key"><el-input v-model="apiKey" type="password" show-password autocomplete="new-password" :placeholder="hasKey ? '已配置，留空保留原密钥' : '请输入智谱 API Key'" maxlength="2048" /></el-form-item>
          <el-form-item label="启用"><el-switch v-model="enabled" /></el-form-item>
          <el-form-item><div class="primary-page-actions"><el-button type="primary" :loading="busy" :disabled="!loaded" @click="save">保存</el-button><el-button :disabled="!loaded || !hasKey || !enabled || Boolean(apiKey) || busy" @click="test">测试连接</el-button></div></el-form-item>
        </el-form>
        <el-alert v-if="result" :title="result" type="success" :closable="false" />
        <p class="muted">知识写入和问题检索共用此模型。模型与维度固定，避免已有索引不兼容。密钥加密保存，不回显。</p>
        <p class="muted">测试连接仅发送固定测试短句，会产生少量 API 费用；修改后请先保存。</p>
      </el-card>
    </div>
  </main>
</template>
<style scoped>
.model-body > .el-card { width: 100%; border-radius: 6px; }
.model-body :deep(.el-card__header) { font-size: 16px; font-weight: 500; }
.el-form { width: 100%; }
.muted { font-size: 13px; color: var(--el-text-color-secondary); line-height: 1.7; }
</style>
