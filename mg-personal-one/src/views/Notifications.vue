<script setup lang="ts">
import { applicationPage } from '../application';
const pageConfig = applicationPage('notifications');
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { Bell, Refresh } from '@element-plus/icons-vue';
import { PageFrame, PageHeading, ContentPanel } from '@mg-inside/frontend';
import { request } from '../api/client';
import { desktop } from '../desktop';

interface NotificationItem { id: string; text: string; appId: string; appName: string; createdAt: string; read: boolean }
const items = ref<NotificationItem[]>([]), loading = ref(true), refreshing = ref(false), busy = ref(false), error = ref('');
const unread = computed(() => items.value.filter(item => !item.read).length);
let disposed = false, visible = true;
let timer: ReturnType<typeof setInterval> | undefined;
let observer: IntersectionObserver | undefined;
let controller: AbortController | undefined;
let revision = 0;

function isVisible() { return visible && document.visibilityState === 'visible'; }
async function load(automatic = false) {
  if (disposed || refreshing.value || busy.value || (automatic && !isVisible())) return;
  refreshing.value = true; controller = new AbortController(); const requestRevision = ++revision;
  try {
    const result = await request<{ items: NotificationItem[] }>('/api/notifications', { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) }, desktop.origin);
    if (!disposed && requestRevision === revision) { items.value = result.items; error.value = ''; }
  } catch (e) { if (!disposed && requestRevision === revision) error.value = (e as Error).message; }
  finally { if (!disposed && requestRevision === revision) { refreshing.value = false; loading.value = false; controller = undefined; } }
}
async function update(method: 'PATCH' | 'DELETE', id?: string) {
  if (busy.value) return;
  // 点击进入 iframe 会触发 focus 刷新；后台读取不能吞掉用户的标记/清除操作。
  revision++; controller?.abort(); controller = undefined; refreshing.value = false;
  busy.value = true; error.value = '';
  try {
    await request('/api/notifications', { method, body: JSON.stringify({ ...(id ? { id } : {}), ...(method === 'PATCH' ? { read: true } : {}) }) }, desktop.origin);
    if (!disposed) {
      if (method === 'DELETE') items.value = id ? items.value.filter(item => item.id !== id) : [];
      else items.value = items.value.map(item => !id || item.id === id ? { ...item, read: true } : item);
    }
  } catch (e) { if (!disposed) error.value = (e as Error).message; }
  finally { busy.value = false; }
  if (!disposed && !error.value) await load();
}
function refreshWhenVisible() { void load(true); }
function dateLabel(value: string) { const date = new Date(value); return Number.isNaN(date.valueOf()) ? '时间未知' : date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }
onMounted(() => {
  void load();
  window.addEventListener('focus', refreshWhenVisible);
  document.addEventListener('visibilitychange', refreshWhenVisible);
  observer = new IntersectionObserver(entries => { visible = entries.some(entry => entry.isIntersecting); if (visible) refreshWhenVisible(); });
  observer.observe(document.documentElement);
  timer = setInterval(refreshWhenVisible, 15000);
});
onUnmounted(() => { disposed = true; controller?.abort(); if (timer) clearInterval(timer); observer?.disconnect(); window.removeEventListener('focus', refreshWhenVisible); document.removeEventListener('visibilitychange', refreshWhenVisible); });
</script>

<template>
  <PageFrame>
    <template #header><PageHeading :title="pageConfig.title" :description="items.length ? `${unread} 条未读 · 共 ${items.length} 条通知` : pageConfig.description"><template #actions>
      <el-button :icon="Refresh" :loading="refreshing" :disabled="busy" @click="load()">刷新</el-button>
      <el-button :disabled="!unread || busy || loading" @click="update('PATCH')">全部已读</el-button>
      <el-popconfirm title="确定清空所有通知？" confirm-button-text="清空" cancel-button-text="取消" @confirm="update('DELETE')"><template #reference><el-button :disabled="!items.length || busy || loading">清空通知</el-button></template></el-popconfirm>
    </template></PageHeading></template>
    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
    <ContentPanel>
      <div v-if="loading" class="notification-state" role="status">正在读取通知…</div>
      <div v-else-if="!items.length && error" class="notification-state"><p>暂时无法读取通知</p><el-button :loading="refreshing" @click="load()">重试</el-button></div>
      <div v-else-if="!items.length" class="notification-state"><el-icon :size="36"><Bell /></el-icon><h2>暂无通知</h2><p>各应用的新消息会显示在这里。</p></div>
      <ul v-else class="notification-list" aria-label="通知列表" :aria-busy="refreshing || busy">
        <li v-for="item in items" :key="item.id" class="notification-item" :class="{ unread: !item.read }">
          <span class="notification-indicator" :aria-label="item.read ? '已读' : '未读'" />
          <div class="notification-content"><div class="notification-meta"><strong>{{ item.appName || '统一桌面' }}</strong><time :datetime="item.createdAt">{{ dateLabel(item.createdAt) }}</time></div><p>{{ item.text }}</p></div>
          <el-button v-if="!item.read" text type="primary" :disabled="busy || loading" :aria-label="`标记已读：${item.text}`" @click="update('PATCH', item.id)">标记已读</el-button>
          <span v-else class="notification-read">已读</span>
        </li>
      </ul>
    </ContentPanel>
  </PageFrame>
</template>

<style scoped>
.notification-state { display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:260px; gap:12px; color:var(--el-text-color-secondary); }
.notification-state h2 { margin:0; font-size:16px; font-weight:500; color:var(--el-text-color-primary); }
.notification-state p { margin:0; font-size:13px; }
.notification-list { list-style:none; margin:0; padding:0; }
.notification-item { display:flex; align-items:flex-start; gap:14px; padding:20px 0; border-bottom:1px solid var(--el-border-color-lighter); }
.notification-item:first-child { padding-top:0; }
.notification-item:last-child { border-bottom:0; padding-bottom:0; }
.notification-indicator { width:7px; height:7px; margin-top:7px; flex:none; border-radius:50%; background:transparent; }
.unread .notification-indicator { background:var(--el-color-primary); }
.notification-content { flex:1; min-width:0; }
.notification-meta { display:flex; flex-wrap:wrap; align-items:center; gap:12px; font-size:12px; color:var(--el-text-color-secondary); }
.notification-meta strong { font-size:13px; font-weight:500; color:var(--el-text-color-regular); }
.notification-content p { margin:8px 0 0; line-height:1.7; white-space:pre-wrap; overflow-wrap:anywhere; }
.notification-read { padding:7px 12px; flex:none; color:var(--el-text-color-secondary); font-size:13px; }
.notification-item > .el-button { flex:none; }
@media(max-width:540px) { .notification-item { flex-wrap:wrap; gap:10px; } .notification-content { flex-basis:calc(100% - 17px); } .notification-item > .el-button,.notification-read { margin-left:auto; } }
</style>
