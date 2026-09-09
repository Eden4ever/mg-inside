<script setup lang="ts">
import PlatformIcon from './PlatformIcon.vue';
defineProps<{ collapsed: boolean }>();
defineEmits<{ toggle: [] }>();
</script>
<template>
  <button class="mg-nav-toggle" type="button" :aria-label="collapsed ? '展开导航' : '收起导航'" :title="collapsed ? '展开导航' : '收起导航'" :aria-expanded="!collapsed" @click="$emit('toggle')">
    <PlatformIcon :name="collapsed ? 'panel-left-open' : 'panel-left-close'" />
    <span v-if="!collapsed">收起导航</span>
  </button>
</template>
