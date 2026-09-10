<script setup lang="ts">
import ApplicationIcon from '../../../../mg-platform/packages/frontend/ApplicationIcon.vue';
defineProps<{ app: { id: string; icon: string } }>();
</script>
<template><ApplicationIcon :app="app" /></template>
