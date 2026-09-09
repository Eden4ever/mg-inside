<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus, Refresh, Search } from '@element-plus/icons-vue';
import { PageFrame, PageHeading, ContentPanel, ApplicationIcon } from '@mg-inside/frontend';
import { application } from '../application';
import { request, type ManagedApplication } from '../api';
import { desktop } from '../desktop';
import { dialogs } from '../dialogs';

const pageConfig = application.pages[0];
const items = ref<ManagedApplication[]>([]), desktopName = ref('统一桌面');
const loading = ref(true), refreshing = ref(false), saving = ref(false), error = ref('');
const search = ref(''), category = ref('all');
const opening = ref(false);
const kindLabels = { system: '系统应用', default: '默认应用', internal: '内部应用', external: '外部应用' };
const filtered = computed(() => items.value.filter(item => (category.value === 'all' || item.kind === category.value) && `${item.name} ${item.description}`.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase())));
const editable = (item: ManagedApplication) => item.kind === 'external' && item.editable;
let revision = 0, disposed = false, controller: AbortController | undefined;
watch(saving, () => desktop.setState({ dirty: false, busy: saving.value }));

async function load() {
  if (disposed || refreshing.value || saving.value) return;
  const current = ++revision;
  refreshing.value = true;
  controller = new AbortController();
  try {
    const data = await request<{ items: ManagedApplication[]; desktop: { name: string } }>('/api/applications', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) });
    if (disposed || current !== revision) return;
    items.value = data.items; desktopName.value = data.desktop.name; error.value = '';
  } catch (e) { if (!disposed && current === revision) error.value = (e as Error).message; }
  finally { if (!disposed && current === revision) { loading.value = false; refreshing.value = false; controller = undefined; } }
}
function cancelRead() { revision++; controller?.abort(); controller = undefined; refreshing.value = false; }
function focusRefresh() { if (document.visibilityState === 'visible' && !dialogs.active.value) void load(); }
async function startEdit(item?: ManagedApplication) {
  if (saving.value || opening.value || (item && !editable(item))) return;
  opening.value = true;
  try {
    const result = await dialogs.open('external-application', item ? { applicationId: item.id } : {});
    if (result.outcome === 'completed') { cancelRead(); desktop.applicationsChanged(); ElMessage.success(item ? '外链应用已更新' : '外链应用已添加'); await load(); }
  } catch (value) { error.value = (value as Error).message; }
  finally { opening.value = false; }
}
onBeforeRouteLeave(() => dialogs.cancel());
async function remove(item: ManagedApplication) {
  if (!editable(item) || saving.value) return;
  try { await ElMessageBox.confirm(`确定从你的应用目录移除“${item.name}”？外部网站及其数据不会被删除。`, '移除外链应用', { confirmButtonText: '移除', cancelButtonText: '取消', type: 'warning' }); } catch { return; }
  cancelRead(); saving.value = true;
  try { await request(`/api/applications/${encodeURIComponent(item.id)}`, { method: 'DELETE' }); items.value = items.value.filter(value => value.id !== item.id); desktop.applicationsChanged(); ElMessage.success('外链应用已移除'); }
  catch (e) { error.value = (e as Error).message; }
  finally { saving.value = false; }
}
function open(item: ManagedApplication) {
  if (!item.available) return;
  if (desktop.enabled) desktop.openApplication(item.id);
  else window.open(`${desktop.origin}/open?app=${encodeURIComponent(item.id)}`, '_blank', 'noopener,noreferrer');
}
onMounted(() => { void load(); window.addEventListener('focus', focusRefresh); document.addEventListener('visibilitychange', focusRefresh); });
onUnmounted(() => { disposed = true; cancelRead(); window.removeEventListener('focus', focusRefresh); document.removeEventListener('visibilitychange', focusRefresh); });
</script>

<template>
  <PageFrame>
    <template #header><PageHeading :title="pageConfig.title" :description="pageConfig.description"><template #actions><el-button :icon="Refresh" :loading="refreshing" :disabled="saving" @click="load">刷新</el-button><el-button type="primary" :icon="Plus" :disabled="loading || saving" @click="startEdit()">添加外链应用</el-button></template></PageHeading></template>
    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
    <ContentPanel>
      <template #toolbar><el-input v-model="search" class="application-search" placeholder="搜索应用名称或说明" aria-label="搜索应用" :prefix-icon="Search" clearable data-desktop-search /><el-select v-model="category" class="application-category" aria-label="应用分类" data-desktop-search><el-option label="全部应用" value="all" /><el-option label="系统应用" value="system" /><el-option label="默认应用" value="default" /><el-option label="内部应用" value="internal" /><el-option label="外部应用" value="external" /></el-select><span class="application-count">{{ desktopName }} · 共 {{ filtered.length }} 个应用</span></template>
      <div v-if="loading" class="directory-state" role="status">正在读取应用目录…</div>
      <div v-else-if="!items.length && error" class="directory-state"><p>应用目录暂时不可用</p><el-button :loading="refreshing" @click="load">重试</el-button></div>
      <div v-else-if="!filtered.length" class="directory-state"><h2>{{ search || category !== 'all' ? '没有匹配的应用' : '暂无应用' }}</h2><p>{{ search || category !== 'all' ? '试试其他关键词或分类。' : '可以添加自己常用的外链应用。' }}</p></div>
      <div v-else class="application-grid">
        <article v-for="item in filtered" :key="item.id" class="application-card" :aria-label="item.name">
          <div class="application-card-head"><ApplicationIcon :app="item" class="directory-app-icon" /><div class="application-name"><h2>{{ item.name }}</h2><span>{{ kindLabels[item.kind] }}</span></div><el-tag v-if="!item.available" type="info" size="small">无访问权限</el-tag></div>
          <p class="application-description">{{ item.description || '暂无说明' }}</p>
          <p class="application-version">当前版本 <span>{{item.kind==='external'?'外部网站':item.version||'未登记'}}</span></p>
          <p v-if="item.kind === 'external'" class="application-url" :title="item.entryUrl">{{ item.entryUrl }}</p>
          <div class="application-card-footer"><span class="readonly-note">{{ item.kind === 'default' ? '默认可用，无需授权' : item.kind === 'external' ? '我的外链 · 仅自己可见' : '由平台管理 · 需授权' }}</span><div class="application-card-actions"><template v-if="editable(item)"><el-button text :disabled="saving" :aria-label="`编辑${item.name}`" @click="startEdit(item)">编辑</el-button><el-button text type="danger" :disabled="saving" :aria-label="`移除${item.name}`" @click="remove(item)">移除</el-button></template><el-button plain :disabled="!item.available" :aria-label="`打开${item.name}`" @click="open(item)">打开</el-button></div></div>
        </article>
      </div>
      <p class="directory-note">系统应用与内部应用需经授权访问；个人中心等默认应用自动可用，不参与授权。外部应用是你添加的个人外链，仅自己可见。平台应用由平台维护，个人外链可以编辑和移除；外部网站的登录缓存和桌面嵌入能力取决于浏览器政策及网站设置。</p>
    </ContentPanel>

  </PageFrame>
</template>

<style scoped>
.application-search { width:300px; max-width:100%; }
.application-category { width:140px; }
.application-count { margin-left:auto; font-size:12px; color:var(--el-text-color-secondary); }
.application-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(min(300px,100%),1fr)); gap:16px; }
.application-card { display:flex; flex-direction:column; min-width:0; padding:20px; border:1px solid var(--el-border-color-lighter); border-radius:8px; }
.application-card-head { display:flex; align-items:center; gap:12px; min-width:0; }
.directory-app-icon { width:44px; height:44px; }
.application-name { flex:1; min-width:0; }.application-name h2 { margin:0 0 5px; font-size:15px; font-weight:500; overflow-wrap:anywhere; }.application-name span { font-size:12px; color:var(--el-text-color-secondary); }
.application-description { flex:1; min-height:40px; margin:18px 0 10px; color:var(--el-text-color-regular); font-size:13px; line-height:1.7; overflow-wrap:anywhere; }
.application-url { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin:0 0 16px; font-size:12px; color:var(--el-text-color-secondary); }
.application-version { display:flex; align-items:baseline; gap:8px; margin:0 0 14px; color:var(--el-text-color-secondary); font-size:12px; }.application-version span { color:var(--el-text-color-regular); overflow-wrap:anywhere; }
.application-card-footer { display:flex; justify-content:space-between; align-items:center; gap:8px; border-top:1px solid var(--el-border-color-lighter); padding-top:14px; }
.application-card-actions { display:flex; align-items:center; justify-content:flex-end; gap:4px; margin-left:auto; }.application-card-actions .el-button + .el-button { margin-left:0; }
.readonly-note { color:var(--el-text-color-secondary); font-size:12px; }
.directory-note,.dialog-note { margin:20px 0 0; color:var(--el-text-color-secondary); font-size:12px; line-height:1.7; }
.directory-state { min-height:220px; display:flex; flex-direction:column; justify-content:center; align-items:center; gap:12px; color:var(--el-text-color-secondary); }.directory-state h2 { margin:0; font-weight:500; font-size:16px; }.directory-state p { margin:0; font-size:13px; }
@media(max-width:600px) { .application-search { width:100%; }.application-count { width:100%; margin-left:0; }.application-card { padding:16px; } }
</style>

