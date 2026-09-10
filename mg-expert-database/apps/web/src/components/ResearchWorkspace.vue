<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import EvidenceContent from './EvidenceContent.vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Clock, Delete, DocumentAdd, Edit, MagicStick, Refresh, Search } from '@element-plus/icons-vue';
import type { EvidenceItem, FieldValue, ModuleDefinition, ModuleRecord, ResearchModuleKey, ResearchWorkspace as WorkspacePayload, UpdateModuleInput, UserRole } from '@/types/domain';

const props = withDefaults(defineProps<{
  workspace: WorkspacePayload;
  toolbarTarget?: string;
  selectedModuleKey: ResearchModuleKey;
  saveVersion: number;
  revisions: WorkspacePayload['recentRevisions'];
  revisionsLoading: boolean;
  readonly: boolean;
  userRole?: UserRole;
  canReviewAccess?: boolean;
  canEditEvidence?: boolean;
  evidence?: EvidenceItem[];
}>(), {
  userRole: 'researcher' as UserRole,
  evidence: () => [] as EvidenceItem[],
});

const emit = defineEmits<{
  selectModule: [moduleKey: ResearchModuleKey];
  save: [moduleKey: ResearchModuleKey, input: UpdateModuleInput];
  addEvidence: [moduleKey: ResearchModuleKey, fieldKey: string, input: Omit<EvidenceItem, 'id'>];
  loadRevisions: [];
  loadEvidence: [];
  updateEvidence: [item: EvidenceItem, input: Partial<EvidenceItem>];
  deleteEvidence: [item: EvidenceItem];
  saveSummary: [input: { expectedRevisionNo: number; summary: string }];
  dirtyChange: [dirty: boolean];
  closeStateChange: [state: { dirty: boolean; busy: boolean }];
  refreshTemplate: [];
}>();

const conflictMessage = ref('');
const retainedDraft = ref('');
function showConflict(message: string) { saveFailed(); conflictMessage.value = message; retainedDraft.value = JSON.stringify({ module: selectedDefinition.value?.name, fields: editingFields.value.map(f => ({ label: f.label, fieldId: f.fieldId, value: draftValues.value[f.fieldId], notApplicableReason: draftNaReasons.value[f.fieldId] })) }, null, 2); }
function reloadForComparison() { cancelEdit(); emit('refreshTemplate'); }
const editingKey = ref<ResearchModuleKey | null>(null);
const editingFieldKey = ref<string | null>(null);
const editingFields = ref<ModuleDefinition['fields']>([]);
const editingRevisionNo = ref(0);
const editingTemplateRevision = ref<number>();
const originalValues = ref<Record<string, unknown>>({});
const saving = ref(false);
const draftValues = ref<Record<string, unknown>>({});
const draftNaReasons = ref<Record<string, string>>({});
const draftNaEnabled = ref<Record<string, boolean>>({});
const dirty = ref(false);
const formRef = ref();
const revisionsOpen = ref(false);
const evidenceOpen = ref(false);
const editingEvidence = ref<EvidenceItem | null>(null);
const evidenceFieldKey = ref('');
const evidenceForm = ref({ title: '', sourceType: '政策文件', sourceUrl: '', status: 'pending_verification' as EvidenceItem['status'], excerpt: '' });
const evidenceFormRef = ref();
const activeAnchor = ref('');
type EditTarget = { moduleKey: ResearchModuleKey; fieldKey: string | null };
const pendingEditTarget = ref<EditTarget | null>(null);
const summaryOpen = ref(false);
const summaryDraft = ref('');
watch(() => props.workspace.summaryRevisionNo, () => { summaryOpen.value = false; });
const evidenceStatusOptions = [
  { label: '待核验', value: 'pending_verification' },
  { label: '已核验', value: 'verified' },
  { label: '无效', value: 'invalid' },
  { label: '已替代', value: 'superseded' },
];

const definitions = computed(() => [...props.workspace.moduleDefinitions].sort((a, b) => a.displayOrder - b.displayOrder));
const selectedDefinition = computed(() => definitions.value.find((item) => item.moduleKey === (editingKey.value || props.selectedModuleKey)) || definitions.value[0]);
const selectedRecord = computed(() => props.workspace.modules.find((item) => item.moduleKey === (editingKey.value || props.selectedModuleKey)));

watch(() => props.saveVersion, () => {
  const target = pendingEditTarget.value;
  saving.value = false;
  cancelEdit();
  if (target) beginEdit(target);
});

watch(dirty, (value) => emit('dirtyChange', value), { flush: 'sync' });
// 摘要、依据与冲突保留稿不属于当前模块保存流程，但同样不能被桌面静默丢弃。
watch([dirty, saving, summaryOpen, evidenceOpen, retainedDraft], () => emit('closeStateChange', {
  dirty: dirty.value || summaryOpen.value || evidenceOpen.value || Boolean(retainedDraft.value),
  busy: saving.value,
}), { immediate: true, flush: 'sync' });

watch(() => props.selectedModuleKey, () => {
  if (editingKey.value && editingKey.value !== props.selectedModuleKey) {
    cancelEdit();
  }
});
watch(() => props.workspace.indicator.id, () => { saving.value = false; cancelEdit(); conflictMessage.value = ''; retainedDraft.value = ''; });

function moduleStatusLabel(status: ModuleRecord['status']) { return status === 'not_started' || status === 'todo' ? '未记录' : '已记录'; }
function moduleStatusType(status: ModuleRecord['status']) { return status === 'not_started' || status === 'todo' ? 'info' : 'primary'; }

function fieldValue(record: ModuleRecord | undefined, fieldId: string): FieldValue | undefined {
  return record?.values.find((item) => item.fieldKey === fieldId);
}

function normalizedValue(value: unknown): string | number | null {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.join('\n');
  if (value !== null && typeof value === 'object') return JSON.stringify(value, null, 2);
  return value as string | number | null;
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '未填写';
  if (Array.isArray(value)) return value.join('；');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function isMissing(definition: ModuleDefinition['fields'][number], record: ModuleRecord | undefined) {
  const field = fieldValue(record, definition.fieldId);
  return definition.requirement !== 'optional' && !field?.notApplicableReason && (field?.value === null || field?.value === undefined || field?.value === '');
}

function beginEdit(target: EditTarget) {
  if (props.readonly || saving.value) return;
  const definition = definitions.value.find(module => module.moduleKey === target.moduleKey);
  const record = props.workspace.modules.find(module => module.moduleKey === target.moduleKey);
  if (!definition || !record) return;
  const fields = target.fieldKey ? definition.fields.filter(field => field.fieldId === target.fieldKey) : definition.fields;
  if (target.fieldKey && !fields.length) return;
  editingKey.value = target.moduleKey;
  editingFieldKey.value = target.fieldKey;
  editingFields.value = JSON.parse(JSON.stringify(fields));
  editingRevisionNo.value = record.revisionNo || 0;
  editingTemplateRevision.value = props.workspace.templateRevision;
  originalValues.value = JSON.parse(JSON.stringify(Object.fromEntries(fields.map(field => [field.fieldId, fieldValue(record, field.fieldId)?.value ?? null]))));
  draftValues.value = Object.fromEntries(fields.map(field => [field.fieldId, normalizedValue(originalValues.value[field.fieldId])]));
  draftNaReasons.value = Object.fromEntries(fields.filter(field => field.allowNotApplicable).map(field => [field.fieldId, fieldValue(record, field.fieldId)?.notApplicableReason || '']));
  draftNaEnabled.value = Object.fromEntries(fields.filter(field => field.allowNotApplicable).map(field => [field.fieldId, Boolean(fieldValue(record, field.fieldId)?.notApplicableReason)]));
  dirty.value = false;
  if (props.selectedModuleKey !== target.moduleKey) emit('selectModule', target.moduleKey);
  nextTick(() => {
    if (typeof formRef.value?.clearValidate === 'function') formRef.value.clearValidate();
  });
}

async function requestEdit(target: EditTarget) {
  if (props.readonly || saving.value || (editingKey.value === target.moduleKey && editingFieldKey.value === target.fieldKey)) return;
  if (editingKey.value && dirty.value) {
    try {
      await ElMessageBox.confirm('当前内容有未保存修改。', '切换编辑内容', { confirmButtonText: '保存后切换', cancelButtonText: '放弃修改', distinguishCancelAndClose: true, type: 'warning' });
      pendingEditTarget.value = target;
      submitSave();
      return;
    } catch (action) {
      if (action !== 'cancel') return;
    }
  }
  beginEdit(target);
}

function cancelEdit() {
  if (saving.value) return;
  pendingEditTarget.value = null;
  editingKey.value = null;
  editingFieldKey.value = null;
  editingFields.value = [];
  dirty.value = false;
  draftValues.value = {};
  draftNaReasons.value = {};
  draftNaEnabled.value = {};
}

function saveCurrent() {
  return submitSave();
}

function discardCurrent() {
  cancelEdit();
}

function saveFailed() { saving.value = false; pendingEditTarget.value = null; }
function isSaving() { return saving.value; }
defineExpose({ saveCurrent, discardCurrent, showConflict, saveFailed, isSaving });

function submitSave() {
  if (props.readonly || saving.value || !editingKey.value || !selectedRecord.value || !selectedDefinition.value) return false;
  const missingReason = editingFields.value.find(field => draftNaEnabled.value[field.fieldId] && !draftNaReasons.value[field.fieldId]?.trim());
  if (missingReason) { pendingEditTarget.value = null; ElMessage.error(`请填写${missingReason.label}的不适用理由`); return false; }
  saving.value = true;
  emit('save', editingKey.value, {
    expectedTemplateRevision: editingTemplateRevision.value,
    expectedRevisionNo: editingRevisionNo.value,
    values: Object.entries(draftValues.value).map(([fieldKey, value]) => {
      const original = originalValues.value[fieldKey];
      return { fieldKey, value: JSON.stringify(value) === JSON.stringify(normalizedValue(original)) ? original ?? null : value };
    }),
    notApplicableReasons: Object.fromEntries(Object.entries(draftNaReasons.value).filter(([key, reason]) => draftNaEnabled.value[key] && reason.trim())),
  });
  return true;
}

function hasDraftValue(fieldKey: string) {
  const value = draftValues.value[fieldKey];
  return value !== null && value !== undefined && value !== '';
}

function toggleNotApplicable(fieldKey: string, enabled: boolean) {
  draftNaEnabled.value[fieldKey] = enabled;
  if (enabled) draftValues.value[fieldKey] = null;
  else draftNaReasons.value[fieldKey] = '';
  dirty.value = true;
}

function openEvidence(fieldKey: string) {
  if (!canEditEvidence() || !selectedRecord.value) return;
  evidenceFieldKey.value = fieldKey;
  editingEvidence.value = null;
  evidenceForm.value = { title: '', sourceType: '政策文件', sourceUrl: '', status: 'pending_verification', excerpt: '' };
  evidenceOpen.value = true;
}

function openEvidenceEdit(item: EvidenceItem) {
  if (!canEditEvidence()) return;
  editingEvidence.value = item;
  evidenceFieldKey.value = item.fieldIds?.[0] || '';
  evidenceForm.value = { title: item.title, sourceType: item.sourceType, sourceUrl: item.sourceUrl || '', status: item.status, excerpt: item.excerpt || '' };
  evidenceOpen.value = true;
}

function submitEvidence() {
  const submit = () => {
    if (!evidenceForm.value.title.trim()) {
      ElMessage.error('请输入材料标题');
      return;
    }
    if (editingEvidence.value) emit('updateEvidence', editingEvidence.value, { ...evidenceForm.value, fieldIds: editingEvidence.value.fieldIds || (evidenceFieldKey.value ? [evidenceFieldKey.value] : []) });
    else emit('addEvidence', props.selectedModuleKey, evidenceFieldKey.value, { ...evidenceForm.value, fieldIds: [evidenceFieldKey.value] });
    evidenceOpen.value = false;
  };
  if (typeof evidenceFormRef.value?.validate === 'function') evidenceFormRef.value.validate((valid: boolean) => { if (valid) submit(); });
  else submit();
}

function openRevisions() {
  revisionsOpen.value = true;
  emit('loadRevisions');
}

function canReview() {
  return props.canReviewAccess ?? (props.userRole === 'system_admin' || props.userRole === 'reviewer');
}

function canEditEvidence() {
  return props.canEditEvidence ?? !props.readonly;
}

function openSummary() {
  summaryDraft.value = props.workspace.summary || '';
  summaryOpen.value = true;
}

function submitSummary() {
  emit('saveSummary', { expectedRevisionNo: props.workspace.summaryRevisionNo || 0, summary: summaryDraft.value });
}

function evidenceStatusLabel(status: EvidenceItem['status']) {
  return evidenceStatusOptions.find((item) => item.value === status)?.label || status;
}

function updateEvidenceStatus(item: EvidenceItem, status: EvidenceItem['status']) {
  if (!canEditEvidence()) return;
  emit('updateEvidence', item, { status });
}

async function removeEvidence(item: EvidenceItem) {
  if (!canEditEvidence()) return;
  try { await ElMessageBox.confirm(`确定删除依据“${item.title}”？`, '删除依据', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }); emit('deleteEvidence', item); } catch { /* 用户取消 */ }
}

async function editModule(moduleKey: ResearchModuleKey) {
  await requestEdit({ moduleKey, fieldKey: null });
}
async function editField(moduleKey: ResearchModuleKey, fieldKey: string) { await requestEdit({ moduleKey, fieldKey }); }
</script>

<template>
  <section class="workspace-detail">
    <Teleport :to="toolbarTarget || 'body'" :disabled="!toolbarTarget">
    <div class="detail-heading">
      <div class="heading-actions"><el-button :icon="Clock" @click="openRevisions">修订记录</el-button><el-button :icon="Refresh" @click="$emit('loadRevisions')">刷新</el-button></div>
    </div>
    </Teleport>

    <div class="module-layout">
      <div class="module-scroll">
        <el-alert v-if="conflictMessage" type="warning" :closable="false" :title="conflictMessage"><el-button @click="reloadForComparison">加载最新模板和内容</el-button><details><summary>查看保留的未保存输入</summary><el-input :model-value="retainedDraft" type="textarea" :rows="8" readonly /></details><el-button link @click="conflictMessage = ''; retainedDraft = ''">核对完成</el-button></el-alert>
        <el-card shadow="never" class="summary-card">
          <div class="summary-head"><h2>摘要</h2><div class="summary-actions"><el-button v-if="!readonly" :icon="Edit" @click="openSummary">{{ workspace.summary ? '编辑摘要' : '填写摘要' }}</el-button></div></div>
          <p v-if="workspace.summary">{{ workspace.summary }}</p><el-empty v-else description="暂无摘要" :image-size="60" />
          <div v-if="workspace.summarySourceRevisionIds?.length" class="summary-sources">来源修订：{{ workspace.summarySourceRevisionIds.length }} 条</div>
        </el-card>

        <section v-for="definition in definitions" :id="`module-${definition.moduleKey}`" :key="definition.moduleKey" class="module-section" :class="{ 'is-active': activeAnchor === definition.moduleKey }">
          <div class="module-section-head">
            <div class="module-title"><span class="module-number">{{ String(definition.displayOrder).padStart(2, '0') }}</span><div><h2>{{ definition.name }}</h2><p>{{ definition.researchQuestion }}</p></div></div>
            <div class="module-actions"><el-tag v-if="workspace.modules.find((record) => record.moduleKey === definition.moduleKey)" :type="moduleStatusType(workspace.modules.find((record) => record.moduleKey === definition.moduleKey)!.status)" effect="light">{{ moduleStatusLabel(workspace.modules.find((record) => record.moduleKey === definition.moduleKey)!.status) }}</el-tag><el-button v-if="(editingKey !== definition.moduleKey || editingFieldKey) && !readonly" :icon="Edit" :disabled="saving" @click="editModule(definition.moduleKey)">编辑模块</el-button><template v-if="editingKey === definition.moduleKey && !editingFieldKey"><el-button :disabled="saving" @click="cancelEdit">取消</el-button><el-button type="primary" :loading="saving" @click="submitSave()">保存</el-button></template></div>
          </div>

          <el-form v-if="editingKey === definition.moduleKey && !editingFieldKey" ref="formRef" :model="draftValues" :disabled="saving" label-position="top" class="module-form">
            <el-row :gutter="16">
              <el-col v-for="field in definition.fields" :key="field.fieldId" :span="24">
                <el-form-item :prop="field.fieldId" :label="field.label">
                  <template #label><span>{{ field.label }}</span></template>
                  <el-select v-if="field.fieldType === 'enum'" v-model="draftValues[field.fieldId]" class="full-width" :disabled="draftNaEnabled[field.fieldId]" @change="dirty = true"><el-option v-for="option in field.enumValues || []" :key="option" :label="option" :value="option" /><el-option v-for="option in (field.inactiveEnumValues || []).filter(v => v === draftValues[field.fieldId])" :key="option" :label="option + '（已停用）'" :value="option" disabled /></el-select>
                  <el-input-number v-else-if="['number', 'decimal', 'percentage'].includes(field.fieldType)" v-model="draftValues[field.fieldId]" class="full-width" :disabled="draftNaEnabled[field.fieldId]" :min="field.fieldType === 'percentage' ? 0 : undefined" :max="field.fieldType === 'percentage' ? 100 : undefined" controls-position="right" @change="dirty = true" />
                  <el-date-picker v-else-if="field.fieldType === 'date'" v-model="draftValues[field.fieldId]" type="date" value-format="YYYY-MM-DD" class="full-width" :disabled="draftNaEnabled[field.fieldId]" @change="dirty = true" />
                  <el-input v-else-if="['long_text', 'rich_text', 'reference_list', 'object_list', 'organization_contact_list'].includes(field.fieldType)" v-model="draftValues[field.fieldId]" type="textarea" :rows="field.fieldType === 'rich_text' ? 5 : 4" :disabled="draftNaEnabled[field.fieldId]" :placeholder="field.description || `请输入${field.label}`" @input="dirty = true" />
                  <el-input v-else v-model="draftValues[field.fieldId]" :disabled="draftNaEnabled[field.fieldId]" :placeholder="field.description || `请输入${field.label}`" @input="dirty = true" />
                  <div v-if="field.allowNotApplicable" class="na-control"><el-checkbox v-model="draftNaEnabled[field.fieldId]" @change="toggleNotApplicable(field.fieldId, Boolean($event))">不适用</el-checkbox><el-input v-if="draftNaEnabled[field.fieldId]" v-model="draftNaReasons[field.fieldId]" placeholder="填写不适用理由" @input="dirty = true" /></div>
                </el-form-item>
              </el-col>
            </el-row>
          </el-form>

          <el-descriptions v-else :column="1" border class="module-values" :class="{ 'has-missing': definition.fields.some((field) => isMissing(field, workspace.modules.find((record) => record.moduleKey === definition.moduleKey))) }">
            <el-descriptions-item v-for="field in definition.fields" :key="field.fieldId" :label="field.label">
              <template #label><span>{{ field.label }}</span></template>
              <el-form v-if="editingKey === definition.moduleKey && editingFieldKey === field.fieldId" :model="draftValues" :disabled="saving" class="field-inline-form" :data-field-id="field.fieldId" label-position="top" @submit.prevent="submitSave">
                <el-form-item :prop="field.fieldId">
                  <el-select v-if="field.fieldType === 'enum'" v-model="draftValues[field.fieldId]" class="full-width" :aria-label="field.label" :disabled="draftNaEnabled[field.fieldId]" @change="dirty = true"><el-option v-for="option in field.enumValues || []" :key="option" :label="option" :value="option" /><el-option v-for="option in (field.inactiveEnumValues || []).filter(v => v === draftValues[field.fieldId])" :key="option" :label="option + '（已停用）'" :value="option" disabled /></el-select>
                  <el-input-number v-else-if="['number', 'decimal', 'percentage'].includes(field.fieldType)" v-model="draftValues[field.fieldId]" class="full-width" :aria-label="field.label" :disabled="draftNaEnabled[field.fieldId]" :min="field.fieldType === 'percentage' ? 0 : undefined" :max="field.fieldType === 'percentage' ? 100 : undefined" controls-position="right" @change="dirty = true" />
                  <el-date-picker v-else-if="field.fieldType === 'date'" v-model="draftValues[field.fieldId]" type="date" value-format="YYYY-MM-DD" class="full-width" :aria-label="field.label" :disabled="draftNaEnabled[field.fieldId]" @change="dirty = true" />
                  <el-input v-else-if="['long_text', 'rich_text', 'reference_list', 'object_list', 'organization_contact_list'].includes(field.fieldType)" v-model="draftValues[field.fieldId]" type="textarea" :rows="field.fieldType === 'rich_text' ? 5 : 3" :aria-label="field.label" :disabled="draftNaEnabled[field.fieldId]" :placeholder="field.description || `请输入${field.label}`" @input="dirty = true" />
                  <el-input v-else v-model="draftValues[field.fieldId]" :aria-label="field.label" :disabled="draftNaEnabled[field.fieldId]" :placeholder="field.description || `请输入${field.label}`" @input="dirty = true" />
                  <div v-if="field.allowNotApplicable" class="na-control"><el-checkbox v-model="draftNaEnabled[field.fieldId]" @change="toggleNotApplicable(field.fieldId, Boolean($event))">不适用</el-checkbox><el-input v-if="draftNaEnabled[field.fieldId]" v-model="draftNaReasons[field.fieldId]" placeholder="填写不适用理由" @input="dirty = true" /></div>
                </el-form-item>
                <div class="field-inline-actions"><el-button :disabled="saving" :aria-label="`取消编辑${field.label}`" @click="cancelEdit">取消</el-button><el-button type="primary" :loading="saving" :aria-label="`保存${field.label}`" @click="submitSave">保存</el-button></div>
              </el-form>
              <div v-else class="field-display"><span v-if="fieldValue(workspace.modules.find((record) => record.moduleKey === definition.moduleKey), field.fieldId)?.notApplicableReason"><el-tag size="small" type="info">不适用</el-tag> {{ fieldValue(workspace.modules.find((record) => record.moduleKey === definition.moduleKey), field.fieldId)?.notApplicableReason }}</span><span v-else :class="{ 'missing-value': isMissing(field, workspace.modules.find((record) => record.moduleKey === definition.moduleKey)) }">{{ displayValue(fieldValue(workspace.modules.find((record) => record.moduleKey === definition.moduleKey), field.fieldId)?.value) }}</span><div class="field-actions"><el-tag v-if="fieldValue(workspace.modules.find((record) => record.moduleKey === definition.moduleKey), field.fieldId)?.evidence?.length" size="small" type="success" effect="plain">{{ fieldValue(workspace.modules.find((record) => record.moduleKey === definition.moduleKey), field.fieldId)?.evidence.length }} 条依据</el-tag><el-button v-if="selectedModuleKey === definition.moduleKey && canEditEvidence()" link type="primary" :icon="DocumentAdd" @click="openEvidence(field.fieldId)">关联依据</el-button><el-button v-if="!readonly" class="field-edit-button" text :icon="Edit" :disabled="saving" :aria-label="`编辑${field.label}`" :title="`编辑${field.label}`" @click="editField(definition.moduleKey, field.fieldId)" /></div></div>
              <div v-if="fieldValue(workspace.modules.find((record) => record.moduleKey === definition.moduleKey), field.fieldId)?.evidence?.length" class="field-evidence-list">
                <EvidenceContent v-for="item in fieldValue(workspace.modules.find((record) => record.moduleKey === definition.moduleKey), field.fieldId)?.evidence || []" :key="item.id" :item="item">
                  <template #actions><div v-if="canEditEvidence()" class="evidence-material-actions"><el-button link type="primary" :icon="Edit" aria-label="编辑或替换依据" @click="openEvidenceEdit(evidence.find(e => e.id === item.id) || item)">编辑</el-button><el-button link type="danger" :icon="Delete" aria-label="删除依据" @click="removeEvidence(item)">删除</el-button></div></template>
                </EvidenceContent>
              </div>
            </el-descriptions-item>
          </el-descriptions>
        </section>
      </div>
    </div>

    <el-dialog v-model="evidenceOpen" :title="editingEvidence ? '编辑或替换依据材料' : '新增依据材料'" width="520px" destroy-on-close>
      <el-form ref="evidenceFormRef" :model="evidenceForm" label-width="86px">
        <el-form-item label="材料标题" prop="title" :rules="[{ required: true, message: '请输入材料标题', trigger: 'blur' }]" ><el-input v-model="evidenceForm.title" /></el-form-item>
        <el-form-item label="材料类型"><el-select v-model="evidenceForm.sourceType"><el-option label="政策文件" value="政策文件" /><el-option label="数据来源" value="数据来源" /><el-option label="典型案例" value="典型案例" /><el-option label="其他依据" value="其他依据" /></el-select></el-form-item>
        <el-form-item label="来源链接"><el-input v-model="evidenceForm.sourceUrl" placeholder="可选" /></el-form-item>
        <el-form-item label="核验状态"><el-select v-model="evidenceForm.status"><el-option v-for="item in evidenceStatusOptions" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-form-item>
        <el-form-item label="摘要摘录"><el-input v-model="evidenceForm.excerpt" type="textarea" :rows="3" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="evidenceOpen = false">取消</el-button><el-button type="primary" @click="submitEvidence">{{ editingEvidence ? '保存变更' : '关联依据' }}</el-button></template>
    </el-dialog>

    <el-dialog v-model="summaryOpen" title="编辑研究结论摘要" width="620px" destroy-on-close>
      <el-form label-position="top">
        <el-form-item label="摘要内容"><el-input v-model="summaryDraft" type="textarea" :rows="9" placeholder="填写知识摘要" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="summaryOpen = false">取消</el-button><el-button type="primary" @click="submitSummary">保存摘要</el-button></template>
    </el-dialog>



    <el-drawer v-model="revisionsOpen" title="修订记录" size="min(520px, 92vw)">
      <el-skeleton v-if="revisionsLoading" :rows="5" animated />
      <el-empty v-else-if="!revisions.length" description="暂无修订记录" />
      <el-timeline v-else>
        <el-timeline-item v-for="item in revisions" :key="item.id" :timestamp="item.createdAt" placement="top">
          <div class="revision-item"><strong>{{ item.action === 'saved' ? '保存模块' : item.action === 'confirmed' ? '提交确认' : item.action === 'published' ? '发布版本' : '创建记录' }}</strong><span>{{ item.actorName }} · {{ item.snapshot?.template?.find(m => m.moduleKey === item.moduleKey)?.name || item.moduleKey }} · 修订 {{ item.revision }}</span>
          <details v-if="item.snapshot"><summary>查看当时内容</summary><template v-for="m in item.snapshot.template?.filter(m => m.moduleKey === item.moduleKey)" :key="m.moduleKey"><p v-for="f in m.fields" :key="f.fieldId"><strong>{{ f.label }}</strong>{{ item.snapshot.naReasons?.[f.fieldId] || displayValue(item.snapshot.values?.[f.fieldId]) }}</p></template><pre v-if="!item.snapshot.template">{{ JSON.stringify(item.snapshot.values, null, 2) }}</pre><p v-for="e in item.snapshot.evidence" :key="e.id">{{ e.title }}：{{ e.excerpt }}</p></details></div>
        </el-timeline-item>
      </el-timeline>
    </el-drawer>
  </section>
</template>

<style scoped>
.field-evidence-list { display: grid; gap: 8px; margin-top: 12px; }
.evidence-material-actions { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.workspace-detail { min-width: 0; min-height: 0; height: 100%; display: flex; flex-direction: column; background: var(--el-fill-color-lighter); }
.detail-heading { min-height: 86px; padding: 15px 20px; background: #fff; border-bottom: 1px solid var(--el-border-color-lighter); display: flex; align-items: center; justify-content: space-between; gap: 14px; }
.detail-back { margin: 0 0 5px -4px; }
.indicator-context { min-width: 0; }
.context-path { color: var(--el-text-color-secondary); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.indicator-context h1 { margin: 5px 0 5px; font-size: 19px; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.indicator-meta { display: flex; align-items: center; gap: 12px; color: var(--el-text-color-secondary); font-size: 12px; }
.module-layout { flex: 1; min-height: 0; display: grid; grid-template-columns: 190px minmax(0, 1fr); }
.module-nav { background: #fff; border-right: 1px solid var(--el-border-color-lighter); padding: 12px 8px; overflow-y: auto; }
.nav-title { padding: 3px 8px 10px; color: var(--el-text-color-secondary); font-size: 12px; font-weight: 600; }
.nav-title span { margin-left: 4px; color: var(--el-color-primary); }
.module-nav-item { width: 100%; min-height: 42px; border: 0; border-left: 3px solid transparent; background: transparent; display: grid; grid-template-columns: 24px minmax(0, 1fr); grid-template-rows: auto auto; align-items: center; gap: 0 5px; padding: 6px 5px; text-align: left; color: var(--el-text-color-regular); cursor: pointer; border-radius: 2px; }
.module-nav-item:hover { background: var(--el-fill-color-light); }
.module-nav-item.active { border-left-color: var(--el-color-primary); background: var(--el-color-primary-light-9); color: var(--el-color-primary); }
.nav-index { grid-row: span 2; color: var(--el-text-color-placeholder); font-size: 10px; align-self: center; }
.nav-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.module-nav-item .el-tag { justify-self: start; margin-top: 3px; transform: scale(.86); transform-origin: left center; }
.module-scroll { min-width: 0; padding: 16px 18px 48px; overflow: auto; scroll-behavior: smooth; }
.summary-card { border-color: var(--el-border-color-lighter); margin-bottom: 14px; }
.summary-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.summary-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
.eyebrow { color: var(--el-color-primary); font-size: 12px; font-weight: 600; }
.summary-head h2 { margin: 3px 0 0; font-size: 15px; }
.summary-card p { margin: 14px 0 0; color: var(--el-text-color-regular); line-height: 1.7; }
.summary-sources { margin-top: 10px; color: var(--el-text-color-secondary); font-size: 12px; }
.summary-card :deep(.el-empty) { padding: 8px 0 0; }
.module-section { background: #fff; border: 1px solid var(--el-border-color-lighter); margin-bottom: 14px; scroll-margin-top: 12px; transition: border-color .2s ease; }
.module-section.is-active { border-color: var(--el-color-primary-light-5); }
.module-section-head { min-height: 68px; padding: 11px 15px; display: flex; align-items: center; justify-content: space-between; gap: 12px; border-bottom: 1px solid var(--el-border-color-lighter); }
.module-title { display: flex; align-items: center; gap: 10px; min-width: 0; }
.module-number { width: 30px; height: 30px; border-radius: 4px; background: var(--el-color-primary-light-9); color: var(--el-color-primary); display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; flex: 0 0 auto; }
.module-title h2 { margin: 0; font-size: 15px; }
.module-title p { margin: 3px 0 0; color: var(--el-text-color-secondary); font-size: 12px; }
.module-actions { display: flex; align-items: center; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.module-values { border: 0; }
.module-values :deep(.el-descriptions__label) { width: 145px; color: var(--el-text-color-secondary); background: var(--el-fill-color-lighter); }
.module-values :deep(.el-descriptions__content) { vertical-align: top; }
.module-values :deep(.el-tag) { margin-left: 5px; transform: scale(.82); transform-origin: left center; }
.field-display { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; min-height: 24px; white-space: pre-wrap; word-break: break-word; }
.field-actions { display: flex; align-items: center; gap: 2px; flex: 0 0 auto; }
.field-edit-button { width: 28px; height: 28px; padding: 5px; color: var(--el-text-color-secondary); }
.field-edit-button:hover { color: var(--el-color-primary); }
.field-inline-form { width: 100%; min-width: 0; }
.field-inline-form :deep(.el-form-item) { margin-bottom: 10px; }
.field-inline-actions { display: flex; justify-content: flex-end; gap: 8px; }
.field-inline-actions .el-button + .el-button { margin-left: 0; }
.missing-value { color: var(--el-text-color-placeholder); }
.module-form { padding: 18px 16px 4px; }
.module-form :deep(.el-form-item__label) { display: flex; align-items: center; gap: 5px; color: var(--el-text-color-regular); }
.module-form :deep(.el-form-item__label .el-tag) { transform: scale(.78); transform-origin: left center; margin-right: -10px; }
.full-width { width: 100%; }
.na-control { width: 100%; margin-top: 7px; display: flex; align-items: center; gap: 10px; }
.na-control .el-input { flex: 1; }
.return-alert { margin: 12px 15px 15px; }
.revision-item strong, .revision-item span { display: block; }
.revision-item span { color: var(--el-text-color-secondary); font-size: 12px; margin-top: 4px; }

@media (max-width: 900px) {
  .detail-heading { padding: 13px 12px; align-items: flex-start; }
  .detail-heading .heading-actions .el-button:not(:first-child) { display: none; }
  .module-layout { display: block; }
  .module-nav { border-right: 0; border-bottom: 1px solid var(--el-border-color-lighter); display: flex; overflow-x: auto; padding: 8px; gap: 4px; }
  .nav-title { display: none; }
  .module-nav-item { min-width: 128px; grid-template-columns: 20px minmax(0, 1fr); }
  .module-scroll { padding: 10px 10px 36px; }
  .module-section-head { align-items: flex-start; flex-direction: column; }
  .module-actions { width: 100%; justify-content: flex-start; }
}

@media (max-width: 560px) {
  .detail-heading { display: block; }
  .detail-heading .heading-actions { margin-top: 10px; }
  .summary-head { align-items: flex-start; flex-direction: column; }
  .module-values :deep(.el-descriptions__label) { width: 105px; }
  .module-values :deep(.el-descriptions__body) { table-layout: fixed; }
}
</style>
