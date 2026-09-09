<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed } from 'vue';
import { getPlatformOrigin } from './auth/platform-origin';
const user = ref<{ name: string; avatarUrl?: string | null }>();
const failed = ref(false);
const controller = new AbortController();
const embedded = document.documentElement.classList.contains('desktop-embedded');
const avatar = computed(() => {
  if (failed.value || !user.value?.avatarUrl) return '';
  try { const u = new URL(user.value.avatarUrl, getPlatformOrigin()); return u.protocol === 'https:' || (u.origin === location.origin && u.protocol === 'http:') ? u.href : ''; } catch { return ''; }
});
onMounted(async () => {
  if (embedded) return;
  try {
    const response = await fetch(`${getPlatformOrigin()}/api/session`, { credentials: 'include', cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
    if (!response.ok) return;
    const data = await response.json();
    if (typeof data.user?.name === 'string') user.value = data.user;
  } catch { /* 账号入口可离线使用，身份失败由业务登录流程处理。 */ }
});
onUnmounted(() => controller.abort());
const target = `${getPlatformOrigin()}/auth/start?app=personal-center&path=%2Fprofile&display=standalone`;
</script>
<template>
  <a v-if="!embedded" class="mg-platform-account" :href="target" target="_blank" rel="noopener noreferrer" aria-label="进入个人中心" title="个人中心">
    <span class="mg-platform-avatar"><img v-if="avatar" :src="avatar" alt="" referrerpolicy="no-referrer" @error="failed = true"/><span v-else>{{user?.name?.slice(0,1) || '我'}}</span></span>
    <span class="mg-platform-account-name">{{user?.name || '个人中心'}}</span>
  </a>
</template>
<style scoped>
.mg-platform-account{display:flex;align-items:center;gap:8px;padding:4px 8px;border:1px solid var(--el-border-color-lighter);border-radius:20px;background:color-mix(in srgb,var(--el-bg-color,#fff) 58%,transparent);color:inherit;text-decoration:none;font-size:13px;max-width:200px;white-space:nowrap}
.mg-platform-avatar{display:grid;place-items:center;width:28px;height:28px;flex:none;border-radius:50%;overflow:hidden;background:var(--el-color-primary-light-9);color:var(--el-color-primary)}
.mg-platform-avatar img{width:100%;height:100%;object-fit:cover}.mg-platform-account-name{overflow:hidden;text-overflow:ellipsis}.mg-platform-account:focus-visible{outline:2px solid var(--el-color-primary);outline-offset:2px}
@media(max-width:640px){.mg-platform-account-name{display:none}.mg-platform-account{padding:3px}}
</style>
