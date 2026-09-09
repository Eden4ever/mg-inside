<script setup lang="ts">
defineProps<{ title: string; description?: string }>();
</script>

<template>
  <div class="mg-page-heading-row">
    <div class="mg-page-heading-copy"><h1>{{ title }}</h1><p v-if="description">{{ description }}</p><slot /></div>
    <div v-if="$slots.actions" class="mg-page-actions"><slot name="actions" /></div>
  </div>
</template>
