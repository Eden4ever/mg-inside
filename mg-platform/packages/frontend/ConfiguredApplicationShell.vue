<script setup lang="ts">
import { ref } from 'vue';
import type { ApplicationConfig } from './config/application';
import ApplicationShell from './ApplicationShell.vue';
import ConfiguredApplicationHeader from './ConfiguredApplicationHeader.vue';
import ApplicationNavigation from './ApplicationNavigation.vue';
import NavigationFooter from './NavigationFooter.vue';
// 标准壳只接收数据；导航结构、折叠按钮和尺寸没有业务插槽。
defineOptions({ inheritAttrs: false });
const props = defineProps<{ config: ApplicationConfig; activePath: string; title?: string; assets?: Record<string, string> }>();
const emit = defineEmits<{ navigate: [path: string] }>();
const collapsed = ref(props.config.layout === 'standard' ? props.config.navigation.defaultCollapsed : true);
function navigate(path: string) {
  if (typeof matchMedia === 'function' && matchMedia('(max-width:980px)').matches) collapsed.value = true;
  emit('navigate', path);
}
</script>
<template>
  <ApplicationShell :collapsed="collapsed" class="mg-configured-shell" :class="{ 'mg-reading-shell': config.layout === 'reading' }" @keydown.esc="collapsed = true">
    <template #chrome><ConfiguredApplicationHeader :config="config" :assets="assets" :title="title" @navigate="navigate">
      <template v-if="$slots.actions" #actions><slot name="actions" /></template>
    </ConfiguredApplicationHeader></template>
    <template v-if="config.layout === 'standard'" #navigation>
      <button v-if="!collapsed" class="mg-navigation-backdrop" type="button" aria-label="关闭导航遮罩" @click="collapsed = true" />
      <aside class="app-sidebar" :class="{ 'is-collapsed': collapsed }" :aria-label="`${config.name}导航`">
        <ApplicationNavigation :navigation="config.navigation" :pages="config.pages" :active-path="activePath" :collapsed="collapsed" @navigate="navigate" @expand="collapsed = false" />
        <NavigationFooter :collapsed="collapsed" @toggle="collapsed = !collapsed" />
      </aside>
    </template>
    <slot />
  </ApplicationShell>
</template>
<style scoped>
.mg-configured-shell {
  --shell-surface:var(--mg-bg-surface,var(--el-bg-color,#fff));
  --shell-background:linear-gradient(270deg,color-mix(in srgb,#67c23a 9%,var(--shell-surface)) 0,color-mix(in srgb,#67c23a 4%,var(--shell-surface)) 180px,transparent 440px),linear-gradient(28deg,rgb(103 93 171 / 9%) 0,transparent 38%),linear-gradient(332deg,rgb(103 194 58 / 8%) 0,transparent 34%),radial-gradient(circle at var(--shell-gradient-origin-x,38px) 28px,color-mix(in srgb,#0052d9 14%,var(--shell-surface)) 0,color-mix(in srgb,#0052d9 8%,var(--shell-surface)) 120px,color-mix(in srgb,#0052d9 3%,var(--shell-surface)) 260px,var(--shell-surface) 440px);
  --inside-nav-text:var(--mg-text-regular,var(--el-text-color-regular,#586474));
  --inside-nav-icon:var(--mg-text-secondary,var(--el-text-color-secondary,#8390a2));
  --inside-nav-hover:color-mix(in srgb,var(--shell-surface) 58%,transparent);
  --inside-nav-hover-text:var(--mg-text-primary,var(--el-text-color-primary,#2d4d79));
  color:var(--mg-text-primary,var(--el-text-color-primary,#303133));
}
.mg-configured-shell :deep(.app-content) { background:var(--shell-surface); }
.mg-configured-shell :deep(.app-header),.mg-configured-shell :deep(.app-sidebar) { background-color:var(--shell-surface); }
.mg-configured-shell :deep(.app-content) { overflow:auto; }
.mg-configured-shell :deep(.app-sidebar) { display:flex; flex-direction:column; min-height:0; overflow:hidden; }
.mg-configured-shell :deep(.app-sidebar.is-collapsed .nav-item) { justify-content:center; padding:0; gap:0; }
.mg-navigation-backdrop { display:none; }
@media (max-width:980px) {
  .mg-navigation-backdrop { display:block; position:absolute; z-index:29; inset:var(--shell-header-height) 0 0 64px; border:0; background:rgb(20 35 55 / 12%); }
  :global(.desktop-embedded .mg-navigation-backdrop) { top:var(--inside-titlebar-height,42px); }
}
.mg-reading-shell { grid-template-columns:minmax(0,1fr); }
.mg-reading-shell :deep(.app-content) { grid-column:1; }
</style>
