<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ConfiguredApplicationShell } from '@mg-inside/frontend';
import { loadSession } from './session';
import { application } from './application';
import { assets } from './registry';
const loading = ref(true), error = ref('');
const route = useRoute(), router = useRouter();
async function load() { loading.value = true; error.value = ''; try { await loadSession(); } catch (e) { error.value = (e as Error).message; } finally { loading.value = false; } }
onMounted(load);
</script>
<template>
  <ConfiguredApplicationShell :config="application" :assets="assets" :active-path="route.path" :title="String(route.meta.title || '')" @navigate="router.push($event)">
    
    
    <div v-if="loading" class="status-message">正在读取个人信息…</div>
    <div v-else-if="error" class="status-message"><el-alert :title="error" type="error" :closable="false" /><el-button @click="load">重试</el-button></div>
    <RouterView v-else />
  </ConfiguredApplicationShell>
</template>
