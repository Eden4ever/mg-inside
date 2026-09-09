<script setup lang="ts">
defineProps<{ title?: string }>();
</script>

<template>
  <section class="mg-content-panel">
    <header v-if="title || $slots.header" class="mg-content-panel-heading"><slot name="header"><h2>{{ title }}</h2></slot></header>
    <div v-if="$slots.toolbar" class="mg-content-panel-toolbar"><slot name="toolbar" /></div>
    <div class="mg-content-panel-body"><slot /></div>
    <footer v-if="$slots.footer" class="mg-content-panel-footer"><slot name="footer" /></footer>
  </section>
</template>
