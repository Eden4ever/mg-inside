<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { observePageScrollGutter } from './scroll-gutter';
const content = ref<HTMLElement>();
let dispose: (() => void) | undefined;
onMounted(() => { if (content.value) dispose = observePageScrollGutter(content.value); });
onUnmounted(() => dispose?.());
</script>

<template>
  <section class="mg-page page">
    <header v-if="$slots.header" class="mg-page-heading"><slot name="header" /></header>
    <div ref="content" class="mg-page-content" tabindex="0" aria-label="页面内容"><slot /></div>
  </section>
</template>
