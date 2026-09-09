<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { FolderOpened, Plus, Search, Upload } from '@element-plus/icons-vue';
import type { CreateSystemInput, ImportPreview, IndicatorSystemSummary, UserRole } from '@/types/domain';

const props = defineProps<{
  systems: IndicatorSystemSummary[];
  loading: boolean;
  error: string;
  importPreview: ImportPreview | null;
  importBusy: boolean;
  canManage: boolean;
  currentRole: UserRole;
}>();

const emit = defineEmits<{
  templateSettings: [system: IndicatorSystemSummary];
  open: [system: IndicatorSystemSummary];
  retry: [];
  create: [input: CreateSystemInput, complete: (error?: string) => void];
  previewImport: [versionId: string, file: File];
  commitImport: [];
  clone: [system: IndicatorSystemSummary, input: { year: number; versionCode: string }];
}>();

const search = ref('');
const createOpen = ref(false);
const creating = ref(false);
const createError = ref('');
let closeConfirmation: Promise<boolean> | undefined;
const importOpen = ref(false);
const createForm = ref<CreateSystemInput>({ name: '', region: '', maxLevel: 3 });
const createFormRef = ref();
const selectedFile = ref<File | null>(null);
const selectedVersionId = ref('');


function formatUpdatedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

const filteredSystems = computed(() => props.systems.filter((system) => {
  const query = search.value.trim().toLowerCase();
  return !query || [system.name, system.code, system.region].some((item) => item.toLowerCase().includes(query));
}));

const canImport = computed(() => props.systems.some((item) => item.access.canManageCatalog));

function progressColor(value: number) {
  if (value >= 80) return '#67c23a';
  if (value >= 50) return '#409eff';
  return '#e6a23c';
}

async function closeCreate(done?: () => void) {
  if (creating.value) return;
  const changed = Boolean(createForm.value.name.trim() || createForm.value.region?.trim() || createForm.value.maxLevel !== 3);
  if (changed) {
    closeConfirmation ||= ElMessageBox.confirm('已填写的体系信息尚未创建。', '放弃新建指标体系', { confirmButtonText: '放弃填写', cancelButtonText: '继续填写', type: 'warning' }).then(() => true).catch(() => false).finally(() => { closeConfirmation = undefined; });
    if (!await closeConfirmation || creating.value) return;
  }
  createOpen.value = false;
  createForm.value = { name: '', region: '', maxLevel: 3 };
  createError.value = '';
  done?.();
}

function submitCreate() {
  if (creating.value) return;
  if (!createForm.value.name.trim()) { ElMessage.warning('请输入体系名称'); return; }
  creating.value = true; createError.value = '';
  createFormRef.value?.validate((valid: boolean) => {
    if (!valid) { creating.value = false; return; }
    emit('create', { name: createForm.value.name.trim(), region: createForm.value.region?.trim() || '', maxLevel: createForm.value.maxLevel }, error => {
      creating.value = false;
      if (error) { createError.value = error; return; }
      createOpen.value = false; createForm.value = { name: '', region: '', maxLevel: 3 };
    });
  });
}

function onFileChange(uploadFile: { raw?: File }) {
  selectedFile.value = uploadFile.raw || null;
}

function previewImport() {
  if (!selectedVersionId.value) {
    ElMessage.warning('请先选择目标指标体系');
    return;
  }
  if (!selectedFile.value) {
    ElMessage.warning('请先选择 Excel 文件');
    return;
  }
  emit('previewImport', selectedVersionId.value, selectedFile.value);
}

function openImport() {
  selectedVersionId.value = props.systems.find((item) => item.access.canManageCatalog)?.versionId || '';
  selectedFile.value = null;
  importOpen.value = true;
}

function commitImport() {
  if (props.importPreview?.valid) emit('commitImport');
}

</script>

<template>
  <main class="systems-page primary-page">
    <div class="systems-content primary-page-layout">
      <div class="page-heading primary-page-heading">
        <div class="page-title">
          <h1>指标体系</h1>
        </div>
        <div v-if="canManage || canImport" class="heading-actions primary-page-actions">
          <el-button v-if="canImport" :icon="Upload" @click="openImport">导入 Excel</el-button>
          <el-button v-if="canManage" type="primary" :icon="Plus" @click="createOpen = true">新建指标体系</el-button>
        </div>
      </div>

      <el-alert v-if="error" type="error" :closable="false" show-icon class="page-error">
        <template #title>{{ error }}</template>
        <el-button link type="primary" @click="emit('retry')">重新连接</el-button>
      </el-alert>

      <el-card shadow="never" class="table-card" tabindex="0" role="region" aria-label="指标体系列表">
      <template #header>
        <div class="table-toolbar">
          <div class="filter-row">
            <el-input v-model="search" clearable :prefix-icon="Search" placeholder="搜索体系名称或地区" class="system-search" />
          </div>
          <span class="table-count">共 {{ filteredSystems.length }} 个体系</span>
        </div>
      </template>
      <div v-loading="loading" class="system-card-list">
        <div v-if="filteredSystems.length" class="system-card-grid">
          <article v-for="system in filteredSystems" :key="system.id" class="system-card">
            <button class="system-card-title" type="button" @click="emit('open', system)">{{ system.name }}</button>
            <div class="system-card-meta"><span v-if="system.region">{{ system.region }}</span><span>最多 {{ system.maxLevel ?? 3 }} 级</span></div>
            <div class="system-card-stats"><span>{{ system.indicatorCount }} 个指标</span><span>记录覆盖率 {{ system.progress }}%</span></div>
            <el-progress :percentage="system.progress" :stroke-width="4" :show-text="false" :color="progressColor(system.progress)" />
            <div class="system-card-footer">
              <time>{{ formatUpdatedAt(system.updatedAt) }}</time>
              <div class="system-card-actions">
                <el-button link type="primary" @click="emit('open', system)">进入体系</el-button>
              </div>
            </div>
          </article>
        </div>
        <el-empty v-else-if="!loading" :description="search ? '未找到匹配体系' : '暂无指标体系'" />
      </div>
      </el-card>
    </div>

    <el-dialog v-model="createOpen" title="新建指标体系" width="520px" destroy-on-close :before-close="closeCreate" :close-on-click-modal="false" :close-on-press-escape="!creating" :show-close="!creating">
      <el-alert v-if="createError" :title="createError" type="error" :closable="false" show-icon />
      <el-form ref="createFormRef" :model="createForm" label-width="90px" :disabled="creating">
        <el-form-item label="体系名称" prop="name" :rules="[{ required: true, whitespace: true, message: '请输入体系名称', trigger: 'blur' }]"><el-input v-model="createForm.name" /></el-form-item>
        <el-form-item label="最大层级"><el-select v-model="createForm.maxLevel"><el-option v-for="n in 6" :key="n" :label="n + ' 级'" :value="n" /></el-select></el-form-item>
        <el-form-item label="适用地区"><el-input v-model="createForm.region" placeholder="选填" /></el-form-item>
      </el-form>
      <template #footer><el-button :disabled="creating" @click="closeCreate()">取消</el-button><el-button type="primary" :loading="creating" @click="submitCreate">创建</el-button></template>
    </el-dialog>

    <el-dialog v-model="importOpen" title="导入指标目录" width="760px" destroy-on-close>
      <el-alert type="info" :closable="false" show-icon title="先预检再导入。预检会展示行号、字段和错误原因，只有通过后才会写入当前版本。" />
      <el-select v-model="selectedVersionId" class="import-target" placeholder="选择目标指标体系">
        <el-option v-for="system in systems.filter((item) => item.access.canManageCatalog)" :key="system.versionId" :label="system.name" :value="system.versionId" />
      </el-select>
      <el-upload class="import-upload" :auto-upload="false" :limit="1" accept=".xlsx,.xls,.csv" :on-change="onFileChange" :on-exceed="() => ElMessage.warning('一次只能预检一个文件')">
        <el-button :icon="FolderOpened">选择 Excel 文件</el-button>
      </el-upload>
      <div v-if="importPreview" class="preview-panel">
        <div class="preview-heading"><strong>预检结果</strong><el-tag :type="importPreview.valid ? 'success' : 'danger'">{{ importPreview.valid ? '可导入' : '存在错误' }}</el-tag></div>
        <el-table v-if="!importPreview.valid" :data="importPreview.errors" max-height="320" size="small">
          <el-table-column prop="row" label="行号" width="70" />
          <el-table-column prop="field" label="字段" width="180" />
          <el-table-column label="错误原因"><template #default="{ row }"><span class="error-text">{{ row.reason }}</span></template></el-table-column>
        </el-table>
        <div v-else class="ok-text">共识别 {{ importPreview.rows?.length || 0 }} 个目录节点，可确认导入。</div>
      </div>
      <template #footer><el-button @click="importOpen = false">关闭</el-button><el-button :loading="importBusy" type="primary" @click="previewImport">开始预检</el-button><el-button :disabled="!importPreview?.valid" :loading="importBusy" type="success" @click="commitImport">确认导入</el-button></template>
    </el-dialog>

  </main>
</template>

<style scoped>
.system-card-list { min-height: 160px; }
.system-card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(340px, 100%), 1fr)); gap: 16px; }
.system-card { min-width: 0; padding: 18px 18px 0; border: 1px solid var(--el-border-color-lighter); border-radius: 6px; background: #fff; transition: border-color .15s; }
.system-card:hover { border-color: var(--el-color-primary-light-5); }
.system-card-title { display: block; padding: 0; border: 0; background: transparent; text-align: left; font-size: 15px; font-weight: 500; line-height: 1.5; color: var(--el-text-color-primary); cursor: pointer; overflow-wrap: anywhere; }
.system-card-title:hover { color: var(--el-color-primary); }
.system-card-title:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 3px; }
.system-card-meta { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-top: 16px; font-size: 13px; color: var(--el-text-color-regular); }
.system-card-stats { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin: 20px 0 8px; font-size: 12px; color: var(--el-text-color-secondary); }
.system-card-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; min-height: 46px; margin-top: 16px; border-top: 1px solid var(--el-border-color-lighter); }
.system-card-footer .el-button { font-size: 13px; font-weight: 400; }
.system-card-footer time { font-size: 12px; color: var(--el-text-color-secondary); }
.system-card-actions { display: flex; align-items: center; gap: 12px; margin-left: auto; }
.system-card-actions .el-button + .el-button { margin-left: 0; }

.systems-page { height: 100%; min-height: 0; overflow-y: auto; padding: var(--app-space-5) var(--app-space-5) var(--app-space-7); }
.systems-content { width: 100%; max-width: 1480px; margin: 0 auto; display: flex; flex-direction: column; gap: var(--app-space-4); }
.page-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--app-space-4); }
.page-title { display: flex; flex-direction: column; gap: var(--app-space-1); }
.page-heading h1 { margin: 0; padding-top: var(--app-space-2); font-size: 20px; }
.page-heading p { margin: 0; color: var(--el-text-color-secondary); }
.heading-actions, .filter-row { display: flex; gap: var(--app-space-2); align-items: center; flex-wrap: wrap; }
.page-error, .stat-row { margin: 0; }
.stat-card { border-color: var(--el-border-color-lighter); }
.stat-card span { display: block; font-size: 12px; color: var(--el-text-color-secondary); }
.stat-card strong { display: block; font-size: 24px; padding-top: var(--app-space-1); color: var(--el-text-color-primary); }
.table-card { border-color: var(--el-border-color-lighter); }
.table-card:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
.table-toolbar { display: flex; justify-content: space-between; gap: var(--app-space-3); align-items: center; }
.system-search { width: min(320px, 62vw); }
.table-count { color: var(--el-text-color-secondary); font-size: 12px; white-space: nowrap; }
.table-card strong, .table-card small { display: block; }
.table-card small { color: var(--el-text-color-secondary); font-size: 12px; }
.progress-cell { width: 140px; }
.progress-caption { text-align: right; font-size: 12px; color: var(--el-text-color-secondary); padding-bottom: var(--app-space-1); }
.import-upload { padding: var(--app-space-4) 0; }
.import-target { width: 100%; padding-top: var(--app-space-4); }
.preview-panel { border-top: 1px solid var(--el-border-color-lighter); padding-top: var(--app-space-3); }
.preview-heading { display: flex; align-items: center; justify-content: space-between; padding-bottom: var(--app-space-2); }
.error-text { color: var(--el-color-danger); }
.ok-text { color: var(--el-color-success); }
.clone-form { padding-top: var(--app-space-4); }

@media (max-width: 700px) {
  .systems-page { padding: var(--app-space-4) var(--app-space-3) var(--app-space-6); }
  .page-heading { flex-direction: column; }
  .table-toolbar { align-items: flex-start; flex-direction: column; }
  .filter-row { width: 100%; }
  .system-search { width: 100%; }
  .table-card { overflow-x: auto; }
}
</style>
