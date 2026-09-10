<script setup lang="ts">
export interface RuntimeConfiguration {
  entryUrl: string; upstream: string; defaultPath: string; allowedPaths: string[]; allowedApiPaths: string[] | null;
  icon: string; kind: string; authorizationAppId?: string | null; requiredRole?: string | null;
  minWidth: number; minHeight: number; defaultMaximized: boolean; expectedRevision?: number;
  runtimePolicy: { apiMode: string; launchMode?: string; allowedApiMethods?: string[]; [key: string]: unknown };
}
defineProps<{ value: RuntimeConfiguration }>();
const lines = (text: string) => text.split('\n').map(s => s.trim()).filter(Boolean);
</script>
<template>
  <el-form-item label="应用入口" required><el-input v-model="value.entryUrl" placeholder="https://app.example.com" aria-label="应用入口" /></el-form-item>
  <el-form-item label="默认路径" required><el-input v-model="value.defaultPath" aria-label="默认路径" /></el-form-item>
  <el-form-item label="允许页面路径" required><el-input :model-value="value.allowedPaths.join('\n')" type="textarea" :rows="2" aria-label="允许页面路径" @update:model-value="value.allowedPaths = lines($event)" /></el-form-item>
  <el-form-item label="打开方式"><el-radio-group v-model="value.runtimePolicy.launchMode"><el-radio-button value="tab">新标签页</el-radio-button><el-radio-button value="embedded">桌面窗口</el-radio-button></el-radio-group></el-form-item>
  <el-form-item label="API 上游"><el-input v-model="value.upstream" placeholder="https://app.example.com/api" aria-label="API 上游" /></el-form-item>
  <el-form-item label="网关允许的 API 路径"><el-input :model-value="value.allowedApiPaths?.join('\n') || ''" type="textarea" :rows="3" aria-label="网关允许的 API 路径" @update:model-value="value.allowedApiPaths = lines($event)" /></el-form-item>
  <el-form-item label="API 策略"><el-tag :type="value.runtimePolicy.apiMode === 'registered' ? 'success' : 'warning'">{{ value.runtimePolicy.apiMode === 'registered' ? '仅已发布契约' : '历史兼容' }}</el-tag></el-form-item>
  <el-form-item label="最小宽度"><el-input-number v-model="value.minWidth" :min="320" :max="4000" :precision="0" aria-label="最小宽度" /></el-form-item>
  <el-form-item label="最小高度"><el-input-number v-model="value.minHeight" :min="240" :max="4000" :precision="0" aria-label="最小高度" /></el-form-item>
  <el-form-item label="默认最大化"><el-switch v-model="value.defaultMaximized" aria-label="默认最大化" /></el-form-item>
</template>
