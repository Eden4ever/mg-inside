<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { ArrowLeft, Clock, Delete, Document, Plus, Refresh, Search } from '@element-plus/icons-vue';
import { api } from '@/api/client';
import type { IndicatorSystemSummary } from '@/types/domain';
const props = defineProps<{ systems: IndicatorSystemSummary[] }>();
const emit = defineEmits<{ openIndicator: [versionId: string, nodeId: string]; closeStateChange: [state: {dirty: boolean; busy: boolean}] }>();
type Build = { id: string; status: string; total: number; completed: number; reused: number; tokens: number; error: string | null; createdAt: string };
type Library = { id: string; name: string; systemName: string; versionId: string; version: string; canManage: boolean; activeBuildId: string | null; build: Build | null };
type Detail = { builds: Build[]; active: Build | null; pendingChanges: boolean; indicatorCount: number; chunkCount: number; preview: { path: string; label: string; text: string }[] };
type Match = { id: string; nodeId: string; path: string; label: string; text: string; score: number; metadata: { sourceUrl?: string; verificationStatus?: string } };
const libraries = ref<Library[]>([]); const selected = ref<Library | null>(null); const detail = ref<Detail | null>(null);
const configured = ref(false); const loading = ref(false); const busy = ref(false); const error = ref('');
const createOpen = ref(false); const versionId = ref(''); const name = ref(''); const query = ref(''); const consent = ref(false);
let closeConfirmation: Promise<boolean> | undefined;
watch([createOpen,busy],()=>emit('closeStateChange',{dirty:createOpen.value,busy:busy.value}),{immediate:true});
async function closeCreate(done?: () => void) {
  if (busy.value) return;
  if (versionId.value || name.value.trim()) {
    closeConfirmation ||= ElMessageBox.confirm('已填写的语义库信息尚未创建。','放弃新建语义库',{confirmButtonText:'放弃填写',cancelButtonText:'继续填写',type:'warning'}).then(()=>true).catch(()=>false).finally(()=>{closeConfirmation=undefined;});
    if (!await closeConfirmation || busy.value) return;
  }
  createOpen.value=false;versionId.value='';name.value='';done?.();
}
const matches = ref<Match[]>([]); const searched = ref(false); let timer: ReturnType<typeof setInterval> | undefined; let sequence = 0;
const listQuery = ref('');
const listStatus = ref('all');
const filteredLibraries = computed(() => {
  const q = listQuery.value.trim().toLocaleLowerCase();
  return libraries.value.filter(item => (!q || [item.name, item.systemName, item.version].some(value => (value || '').toLocaleLowerCase().includes(q))) && (listStatus.value === 'all' || (item.build?.status || 'unbuilt') === listStatus.value));
});
const listStatusType = (value?: string) => value === 'ready' ? 'success' : value === 'failed' ? 'danger' : value === 'queued' || value === 'running' ? 'warning' : 'info';
const candidates = computed(() => props.systems.filter(s => s.access.canManageCatalog && !libraries.value.some(l => l.versionId === s.versionId)));
const latest = computed(() => detail.value?.builds[0]);
const building = computed(() => ['queued', 'running'].includes(latest.value?.status || ''));
const status = (value?: string) => ({ queued: '排队中', running: '构建中', ready: '可检索', failed: '构建失败' }[value || ''] || '待构建');
const date = (value?: string) => value ? new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
const detailState = computed(() => building.value ? status(latest.value?.status) : detail.value?.active ? (detail.value.pendingChanges ? '待同步' : '可检索') : status(latest.value?.status));
const detailStateType = computed(() => building.value || detail.value?.pendingChanges ? 'warning' : detail.value?.active ? 'success' : latest.value?.status === 'failed' ? 'danger' : 'info');
function fail(e: unknown) { error.value = e instanceof Error ? e.message : '请求失败，请重试'; }
async function reload() {
  loading.value = true; error.value = '';
  try { const data = await api.semanticList(); libraries.value = data.libraries; configured.value = data.configured; }
  catch (e) { fail(e); } finally { loading.value = false; }
}
async function loadDetail() {
  if (!selected.value) return;
  const id = selected.value.id; const current = ++sequence;
  try { const result = await api.semanticDetail(id); if (sequence === current && selected.value?.id === id) detail.value = result; }
  catch (e) { if (sequence === current) { fail(e); detail.value = null; matches.value = []; } }
}
async function enter(item: Library) { selected.value = item; detail.value = null; matches.value = []; searched.value = false; error.value = ''; await loadDetail(); }
function back() { if(busy.value)return;sequence++; selected.value = null; detail.value = null; matches.value = []; void reload(); }
async function create() {
  if (busy.value) return;
  if (!versionId.value) return ElMessage.warning('请选择指标体系版本');
  busy.value = true; error.value = '';
  try { await api.semanticCreate({ versionId: versionId.value, ...(name.value.trim() ? { name: name.value.trim() } : {}) }); createOpen.value = false; await reload(); }
  catch (e) { fail(e); } finally { busy.value = false; }
}
async function build() {
  if (!selected.value) return;
  try { await ElMessageBox.confirm(`将所选版本的有效正文、摘要及依据摘录发送至智谱进行向量化，共 ${detail.value?.chunkCount || 0} 个片段。新增或变化内容会产生 API 费用，不上传附件原文件。`, '构建语义索引', { confirmButtonText: '确认并构建', cancelButtonText: '取消', type: 'warning' }); }
  catch { return; }
  busy.value = true; error.value = '';
  try { await api.semanticBuild(selected.value.id); await loadDetail(); }
  catch (e) { fail(e); } finally { busy.value = false; }
}
async function search() {
  if (!selected.value || !query.value.trim() || !consent.value) return;
  const id = selected.value.id; busy.value = true; error.value = ''; matches.value = []; searched.value = false;
  try { const result = await api.semanticSearch(id, query.value); if (selected.value?.id === id) { matches.value = result.matches; searched.value = true; if (detail.value) detail.value.pendingChanges = result.pendingChanges; } }
  catch (e) { fail(e); } finally { busy.value = false; }
}
async function remove() {
  if (!selected.value) return;
  try { await ElMessageBox.confirm('仅删除语义索引，不删除原体系及内容。', '删除语义库', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }); } catch { return; }
  busy.value = true;
  try { await api.semanticRemove(selected.value.id); busy.value = false; back(); } catch (e) { fail(e); } finally { busy.value = false; }
}
onMounted(() => { void reload(); timer = setInterval(() => { if (selected.value && building.value && !busy.value) void loadDetail(); }, 3000); });
onBeforeUnmount(() => { sequence++; if (timer) clearInterval(timer); });
</script>

<template>
  <main class="semantic-page" :class="{ 'is-detail': selected }" v-loading="loading">
    <header class="semantic-heading"><div class="heading-context"><el-button v-if="selected" :icon="ArrowLeft" :disabled="busy" @click="back">返回列表</el-button><h1 :title="selected?.name">{{ selected?.name || '智能语义库' }}</h1><el-tag v-if="selected && detail" :type="detailStateType" effect="light" size="small">{{ detailState }}</el-tag></div><div class="actions"><el-button :icon="Refresh" @click="selected ? loadDetail() : reload()">刷新</el-button><el-button v-if="!selected && candidates.length" type="primary" :icon="Plus" @click="createOpen = true; versionId = ''; name = ''">新建语义库</el-button><template v-if="selected?.canManage"><el-button :disabled="!configured || building || !detail" :loading="busy" :icon="Refresh" @click="build">{{ detail?.active ? '更新索引' : '构建索引' }}</el-button><el-button :icon="Delete" type="danger" plain :disabled="building || busy" @click="remove">删除</el-button></template></div></header>
    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
    <el-alert v-if="!configured && !loading" title="智谱尚未配置或已停用：请联系系统管理员在「模型管理」维护向量模型。" type="warning" :closable="false" show-icon />
    <section v-if="!selected" class="library-list" aria-label="语义库列表">
      <div class="list-toolbar"><div class="list-filters"><el-input v-model="listQuery" :prefix-icon="Search" clearable placeholder="搜索语义库、来源体系或版本" aria-label="搜索语义库" /><el-select v-model="listStatus" aria-label="构建状态"><el-option label="全部状态" value="all" /><el-option label="待构建" value="unbuilt" /><el-option label="排队中" value="queued" /><el-option label="构建中" value="running" /><el-option label="可检索" value="ready" /><el-option label="构建失败" value="failed" /></el-select></div><span class="list-count">共 {{ filteredLibraries.length }} 个语义库</span></div>
      <div v-if="filteredLibraries.length" class="library-grid">
        <article v-for="item in filteredLibraries" :key="item.id" class="library-card">
          <div class="library-card-heading"><h2 :title="item.name">{{ item.name }}</h2><el-tag size="small" :type="listStatusType(item.build?.status)" effect="light">{{ status(item.build?.status) }}</el-tag></div>
          <div class="library-source"><el-icon><Document /></el-icon><span :title="item.systemName">{{ item.systemName }}</span></div>
          <div class="library-version">{{ item.version }}</div>
          <div class="library-card-meta"><span>{{ item.build ? '最近构建 ' + item.build.completed + ' / ' + item.build.total + ' 片段' : '尚未构建索引' }}</span><span v-if="item.activeBuildId && item.build?.status !== 'ready'" class="available-note">旧索引可用</span></div>
          <el-progress v-if="item.build?.status === 'running' || item.build?.status === 'queued'" :percentage="item.build.total ? Math.floor(item.build.completed / item.build.total * 100) : 0" :stroke-width="3" :show-text="false" class="library-build-progress" />
          <footer class="library-card-footer"><span class="library-time"><el-icon><Clock /></el-icon><time>{{ date(item.build?.createdAt) }}</time></span><el-button link type="primary" @click="enter(item)">进入语义库</el-button></footer>
        </article>
      </div>
      <el-empty v-else-if="!loading && !error" :image-size="88" :description="listQuery || listStatus !== 'all' ? '未找到匹配的语义库' : '暂无语义库，选择维护好的指标体系开始构建'" />
    </section>
    <template v-else-if="detail">
      <div class="detail-body">
        <div class="source-strip">
          <div class="source-name"><el-icon><Document /></el-icon><span :title="selected.systemName">{{ selected.systemName }}</span><span class="source-version">{{ selected.version }}</span></div>
          <div class="source-meta"><span><b>{{ detail.indicatorCount }}</b> 个指标</span><span><b>{{ detail.chunkCount }}</b> 个片段</span><span>智谱 · 1024 维</span><span class="last-update"><el-icon><Clock /></el-icon>{{ date(detail.active?.createdAt) }}</span></div>
        </div>
        <el-alert v-if="detail.pendingChanges && detail.active" title="内容有更新，待同步索引；过期片段已从检索中排除。" type="warning" :closable="false" show-icon />
        <div v-if="building || latest?.error" class="build-notice">
          <div v-if="building" class="build-status"><span>{{ status(latest?.status) }}</span><span>{{ latest?.completed }} / {{ latest?.total }} 片段</span></div>
          <el-progress v-if="building" :stroke-width="4" :percentage="latest?.total ? Math.floor(latest.completed / latest.total * 100) : 0" />
          <el-alert v-if="latest?.error" :title="latest.error" type="error" :closable="false" show-icon />
          <p v-if="latest?.status === 'failed' && detail.active" class="muted">上一次成功索引仍可检索。</p>
        </div>

        <section class="search-panel" aria-label="语义检索">
          <div class="section-heading"><h2>语义检索</h2><span class="muted">检索指标原文与依据</span></div>
          <div class="search-row"><el-input v-model="query" :prefix-icon="Search" placeholder="输入问题，例如：信用修复的办理流程是什么？" maxlength="600" @keyup.enter="search" /><el-button type="primary" :loading="busy" :disabled="!configured || !detail.active || !consent || !query.trim()" @click="search">检索</el-button></div>
          <div class="search-consent"><el-checkbox v-model="consent">同意将问题发送至智谱生成向量</el-checkbox><span class="muted">仅检索，不生成回答</span></div>
          <div v-if="!searched && !busy" class="search-placeholder"><el-icon><Search /></el-icon><span>{{ detail.active ? '输入问题，查找相关指标内容' : '索引尚未构建' }}</span><small>{{ detail.active ? '结果保留原文及指标来源' : selected.canManage ? '点击右上角“构建索引”后即可检索' : '请联系体系管理者构建索引' }}</small></div>
          <div v-if="searched" class="result-heading"><span>检索结果 <b>{{ matches.length }}</b></span><span class="muted">按相关度排序 · 分数不代表可信度</span></div>
          <el-empty v-if="searched && !matches.length" :image-size="72" description="暂无可用结果，请更新索引或调整问题" />
          <article class="match" v-for="(item, index) in matches" :key="item.id">
            <div class="match-head"><div class="match-title"><span class="result-index">{{ String(index + 1).padStart(2, '0') }}</span><h3>{{ item.label }}</h3></div><span class="match-score">相关度 {{ item.score.toFixed(3) }}</span></div>
            <p class="match-path">{{ item.path }}</p>
            <p class="match-text">{{ item.text }}</p>
            <div class="match-footer"><el-tag v-if="item.metadata.verificationStatus === 'pending_verification'" type="warning" size="small">依据未核验</el-tag><el-button link type="primary" @click="emit('openIndicator', selected.versionId, item.nodeId)">查看原指标</el-button></div>
          </article>
        </section>

        <el-collapse class="detail-secondary">
          <el-collapse-item name="preview"><template #title><el-icon><Document /></el-icon><span>收录预览</span><span class="collapse-note">前 {{ detail.preview.length }} 个片段</span></template>
            <el-empty v-if="!detail.preview.length" :image-size="48" description="暂无可收录内容" />
            <article v-for="(item, i) in detail.preview" :key="i" class="preview-item"><div class="match-title"><span class="result-index">{{ String(i + 1).padStart(2, '0') }}</span><h3>{{ item.label }}</h3></div><p class="match-path">{{ item.path }}</p><p class="match-text">{{ item.text }}</p></article>
          </el-collapse-item>
          <el-collapse-item name="history"><template #title><el-icon><Clock /></el-icon><span>构建记录</span><span class="collapse-note">{{ detail.builds.length }} 次</span></template>
            <el-empty v-if="!detail.builds.length" :image-size="48" description="暂无构建记录" />
            <div v-for="item in detail.builds" :key="item.id" class="history-row"><time>{{ date(item.createdAt) }}</time><el-tag size="small" :type="item.status === 'failed' ? 'danger' : item.status === 'ready' ? 'success' : 'info'">{{ status(item.status) }}</el-tag><span>{{ item.completed }}/{{ item.total }} 片段</span><span>复用 {{ item.reused }}</span><span>{{ item.tokens }} tokens</span></div>
          </el-collapse-item>
        </el-collapse>
      </div>
    </template>
    <el-skeleton v-else-if="selected && !error" class="detail-skeleton" :rows="8" animated />
    <el-dialog v-model="createOpen" title="新建语义库" width="520px" :before-close="closeCreate" :close-on-click-modal="false" :close-on-press-escape="!busy" :show-close="!busy"><el-alert v-if="error" :title="error" type="error" :closable="false" show-icon /><el-form label-position="top" :disabled="busy"><el-form-item label="来源指标体系版本"><el-select v-model="versionId" style="width:100%" placeholder="选择维护好的体系版本"><el-option v-for="item in candidates" :key="item.versionId" :label="`${item.name} · ${item.year} ${item.version}`" :value="item.versionId" /></el-select></el-form-item><el-form-item label="语义库名称"><el-input v-model="name" maxlength="120" placeholder="默认使用指标体系名称" /></el-form-item></el-form><p class="muted">创建不调用模型；构建时才将内容发送至智谱。权限继承来源体系。</p><template #footer><el-button :disabled="busy" @click="closeCreate()">取消</el-button><el-button type="primary" :loading="busy" @click="create">创建</el-button></template></el-dialog>
  </main>
</template>

<style scoped>
.semantic-page { display:flex; flex-direction:column; padding:24px; height:100%; min-height:0; overflow:hidden; background:#f8fafc; }
.semantic-page>.semantic-heading,.semantic-page>.el-alert { flex-shrink:0; }
.semantic-heading,.heading-context,.actions,.search-row,.match-head,footer { display:flex; align-items:center; gap:8px; }
.semantic-heading,.match-head,footer { justify-content:space-between; }
h1 { font-size:18px; font-weight:500; margin:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
h2 { font-size:16px; font-weight:500; margin:0; } h3 { font-size:14px; font-weight:500; margin:0; }
.semantic-heading { margin-bottom:20px; flex-wrap:wrap; gap:12px; }.heading-context { min-width:0; flex:1; }.heading-context>.el-button,.heading-context>.el-tag { flex-shrink:0; }
.semantic-page>.el-alert { margin-bottom:16px; }
.library-list { flex:1; min-height:0; overflow:auto; overscroll-behavior:contain; scrollbar-gutter:stable; border:1px solid var(--el-border-color-lighter); border-radius:6px; background:#fff; }
.list-toolbar { position:sticky; top:0; z-index:2; background:#fff; display:flex; align-items:center; justify-content:space-between; gap:16px; padding:16px 20px; border-bottom:1px solid var(--el-border-color-lighter); }
.list-filters { display:flex; align-items:center; gap:12px; min-width:0; }.list-filters>.el-input { width:300px; }.list-filters>.el-select { width:140px; }.list-count { font-size:12px; color:var(--el-text-color-secondary); white-space:nowrap; }
.library-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(min(340px,100%),1fr)); gap:16px; padding:20px; }
.library-card { position:relative; min-width:0; padding:18px 18px 0; border:1px solid var(--el-border-color-lighter); border-radius:6px; background:#fff; transition:border-color .2s; }.library-card:hover { border-color:var(--el-color-primary-light-5); }
.library-card-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; margin-bottom:16px; }.library-card-heading h2 { min-width:0; font-size:15px; font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; line-height:22px; }.library-card-heading .el-tag { flex-shrink:0; }
.library-source { display:flex; align-items:center; gap:6px; font-size:13px; color:var(--el-text-color-regular); }.library-source .el-icon { color:var(--el-text-color-placeholder); flex-shrink:0; }.library-source span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.library-version { font-size:12px; color:var(--el-text-color-secondary); margin:8px 0 20px 20px; }
.library-card-meta { display:flex; align-items:center; justify-content:space-between; gap:10px; font-size:12px; color:var(--el-text-color-secondary); margin-bottom:14px; }.available-note { color:var(--el-color-success); }.library-build-progress { position:absolute; bottom:46px; left:18px; right:18px; }
.library-card-footer { border-top:1px solid var(--el-border-color-lighter); min-height:46px; }.library-time { display:flex; align-items:center; gap:6px; font-size:12px; color:var(--el-text-color-placeholder); }.library-card-footer .el-button { font-size:13px; font-weight:400; }
@media(max-width:700px) { .list-toolbar { align-items:flex-start; flex-direction:column; gap:10px; padding:14px; }.list-filters { width:100%; gap:8px; }.list-filters>.el-input { width:auto; flex:1; min-width:0; }.list-filters>.el-select { width:112px; }.library-grid { padding:14px; gap:12px; } }
.muted,.library-grid p { color:var(--el-text-color-secondary); font-size:12px; }
.actions { flex-wrap:wrap; }.actions .el-button+.el-button { margin-left:0; }.actions .el-button,.heading-context>.el-button { height:32px; padding:8px 12px; font-size:13px; border-radius:4px; }
.is-detail { padding:0; }.is-detail>.semantic-heading { padding:14px 20px; min-height:62px; margin:0; background:#fff; border-bottom:1px solid var(--el-border-color-lighter); }
.is-detail>.el-alert { margin:16px 20px 0; width:auto; }
.detail-body { flex:1; min-height:0; overflow:auto; overscroll-behavior:contain; scrollbar-gutter:stable; padding:0 20px 24px; }.detail-body>.el-alert { margin:0 0 16px; }
.source-strip { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:16px 0; font-size:12px; color:var(--el-text-color-secondary); }
.source-name,.source-meta,.last-update { display:flex; align-items:center; gap:8px; min-width:0; }.source-name>span:first-of-type { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; max-width:340px; color:var(--el-text-color-regular); }.source-version { white-space:nowrap; }
.source-meta { gap:20px; flex-wrap:wrap; }.source-meta b { font-weight:500; color:var(--el-text-color-primary); }
.search-panel { background:#fff; border:1px solid var(--el-border-color-lighter); border-radius:6px; padding:20px; }
.section-heading { display:flex; align-items:center; gap:12px; margin-bottom:18px; }.search-row { gap:10px; }.search-row>.el-input { flex:1; }.search-row :deep(.el-input__wrapper) { min-height:40px; padding:0 12px; }.search-row>.el-button { height:40px; min-width:84px; border-radius:4px; }
.search-consent { display:flex; align-items:center; justify-content:space-between; gap:12px; padding-top:6px; }.search-consent :deep(.el-checkbox__label) { font-size:12px; color:var(--el-text-color-secondary); }
.search-placeholder { display:flex; flex-direction:column; align-items:center; gap:10px; padding:40px 16px; color:var(--el-text-color-secondary); font-size:13px; }.search-placeholder>.el-icon { font-size:28px; color:#b6c2d4; margin-bottom:4px; }.search-placeholder small { font-size:12px; color:var(--el-text-color-placeholder); }
.result-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; margin:20px 0 0; padding:12px 0; border-top:1px solid var(--el-border-color-lighter); font-size:13px; }.result-heading b { color:var(--el-color-primary); font-weight:500; margin-left:6px; }
.match { border-top:1px solid var(--el-border-color-lighter); padding:18px 0; }.match:last-child { padding-bottom:0; }.match-title { display:flex; align-items:center; gap:10px; min-width:0; }.result-index { color:var(--el-color-primary); background:var(--el-color-primary-light-9); border-radius:4px; font-size:11px; padding:4px 6px; flex-shrink:0; }.match-score { font-size:12px; color:var(--el-text-color-secondary); white-space:nowrap; }.match-path { color:var(--el-text-color-secondary); font-size:12px; margin:10px 0; overflow-wrap:anywhere; }.match-text { white-space:pre-wrap; overflow-wrap:anywhere; font-size:13px; line-height:1.8; color:var(--el-text-color-regular); margin:10px 0; }.match-footer { display:flex; align-items:center; justify-content:flex-end; gap:12px; }
.build-notice { background:#fff; border:1px solid var(--el-border-color-lighter); padding:12px 16px; border-radius:4px; margin-bottom:16px; }.build-status { display:flex; justify-content:space-between; font-size:12px; margin-bottom:8px; color:var(--el-text-color-secondary); }
.detail-secondary { margin-top:16px; border:1px solid var(--el-border-color-lighter); border-radius:6px; overflow:hidden; background:#fff; }.detail-secondary :deep(.el-collapse-item__header) { padding:0 16px; gap:8px; height:48px; font-weight:400; }.detail-secondary :deep(.el-collapse-item__content) { padding:0 16px 16px; }.detail-secondary :deep(.el-collapse-item:last-child .el-collapse-item__header:not(.is-active)) { border-bottom:0; }.collapse-note { color:var(--el-text-color-placeholder); font-size:12px; margin-left:4px; }.preview-item { padding:16px 0; border-top:1px solid var(--el-border-color-lighter); }.history-row { display:flex; align-items:center; gap:20px; padding:12px 0; border-top:1px solid var(--el-border-color-lighter); font-size:12px; color:var(--el-text-color-secondary); }.detail-skeleton { padding:24px; }
@media(max-width:1000px) { .source-strip { align-items:flex-start; flex-direction:column; gap:10px; }.source-meta { gap:16px; } }
@media(max-width:600px) { .semantic-page { padding:16px; }.is-detail { padding:0; }.is-detail>.semantic-heading { padding:12px; }.heading-context { flex-basis:100%; }.detail-body { padding:0 12px 16px; }.search-panel { padding:16px 12px; }.search-consent { align-items:flex-start; flex-direction:column; gap:0; }.history-row { gap:10px; flex-wrap:wrap; }.result-heading { align-items:flex-start; flex-direction:column; }.source-name { flex-wrap:wrap; }.source-name>span:first-of-type { max-width:240px; }.section-heading { flex-wrap:wrap; }.match-head { align-items:flex-start; } }
</style>
