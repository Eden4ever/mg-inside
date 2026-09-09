<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { observeLegacyPageScrollGutters } from './scroll-gutter';
withDefaults(defineProps<{ collapsed?: boolean }>(), { collapsed: true });
const shell = ref<HTMLElement>();
let dispose: (() => void) | undefined;
onMounted(() => { if (shell.value) dispose = observeLegacyPageScrollGutters(shell.value); });
onUnmounted(() => dispose?.());
</script>

<template>
  <div ref="shell" class="app-shell mg-application-shell" :class="{ 'is-sidebar-collapsed': collapsed }">
    <slot name="chrome" />
    <slot name="navigation" />
    <main class="app-content"><slot /></main>
  </div>
</template>
