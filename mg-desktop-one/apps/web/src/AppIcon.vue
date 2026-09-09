<script setup lang="ts">
import ApplicationIcon from '../../../../mg-platform/packages/frontend/ApplicationIcon.vue';
defineProps<{ app: { id: string; icon: 'knowledge' | 'token' | 'identity' | 'personal' } }>();
</script>
<template><ApplicationIcon :app="app" /></template>
