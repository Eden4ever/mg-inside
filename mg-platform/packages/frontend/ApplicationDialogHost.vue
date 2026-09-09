<script setup lang="ts">
import { computed, resolveComponent } from 'vue';
import type { ApplicationDialogs } from './dialogs/application-dialogs';
const props = defineProps<{ service: ApplicationDialogs }>();
const ElDialog = resolveComponent('ElDialog');
const current = computed(() => props.service.active.value);
const error = computed(() => props.service.error.value);
async function beforeClose(done: () => void) { if (await props.service.cancel()) done(); }
</script>
<template>
  <main v-if="service.isDialogWindow" class="mg-dialog-window">
    <div class="mg-dialog-window-body">
      <p v-if="error" class="mg-dialog-status" role="alert">{{ error }}</p>
      <component v-else-if="current" :is="current.definition.component" :params="current.params" :controller="current.controller" />
      <p v-else class="mg-dialog-status" role="status">正在打开…</p>
    </div>
  </main>
  <ElDialog v-else :model-value="Boolean(current)" :title="current?.definition.title" :width="current?.definition.width || 560" class="mg-application-dialog" :before-close="beforeClose" :show-close="!current?.busy" :close-on-press-escape="!current?.busy" :close-on-click-modal="false" destroy-on-close>
    <component v-if="current" :is="current.definition.component" :params="current.params" :controller="current.controller" />
  </ElDialog>
</template>
<style>
.mg-dialog-window { display:flex; flex-direction:column; width:100%; height:100dvh; min-height:0; padding-block-start:42px; overflow:hidden; background:var(--el-bg-color, #fff); color:var(--el-text-color-primary); --inside-window-surface:var(--el-bg-color, #fff); }
.mg-dialog-window-body { flex:1; min-height:0; overflow:auto; padding:24px; }
.mg-dialog-status { margin:0; padding:24px 0; font-size:14px; color:var(--el-text-color-secondary); }
.mg-application-dialog { max-height:calc(100dvh - 48px); display:flex; flex-direction:column; margin-block:24px; }
.mg-application-dialog > .el-dialog__body { min-height:0; overflow:auto; }
@media(max-width:600px) { .mg-dialog-window-body { padding:16px; } }
</style>
