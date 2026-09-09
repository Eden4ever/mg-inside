<script setup lang="ts">
import NavigationToggle from './NavigationToggle.vue';
defineProps<{ collapsed: boolean }>();
defineEmits<{ toggle: [] }>();
</script>

<template>
  <div class="mg-nav-footer">
    <slot />
    <NavigationToggle :collapsed="collapsed" @toggle="$emit('toggle')" />
  </div>
</template>
