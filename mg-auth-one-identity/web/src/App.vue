<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ConfiguredApplicationShell } from '@mg-inside/frontend';
import { user, clearSession } from './session';
import enterpriseLogo from './assets/logo.svg';
import { application } from './application';
const route = useRoute(), router = useRouter();
// 导航显示仍由当前管理权限决定；实际访问继续由路由和服务端保护。
const config = computed(() => application.layout === 'standard' ? { ...application, navigation: { mode: 'flat' as const, defaultCollapsed: true, pageIds: user.value?.identityAuthorized && user.value.roles?.some(role => role.key === 'platform-admin') ? application.pages.map(page => page.id) : user.value?.identityAuthorized && user.value.roles?.some(role=>['division-admin','organization-admin'].includes(role.key||'')) ? ['scopes'] : [] } } : application);
function expired() { clearSession(); void router.replace({ path: '/login', query: { expired: '1' } }); }
onMounted(() => window.addEventListener('identity-expired', expired));
onUnmounted(() => window.removeEventListener('identity-expired', expired));
</script>
<template>
  <router-view v-if="route.meta.public" />
  <ConfiguredApplicationShell v-else :config="config" :assets="{ enterpriseLogo }" :active-path="route.path" :title="String(route.meta.title || '')" @navigate="router.push($event)">
    <router-view />
  </ConfiguredApplicationShell>
</template>
